import { AppError } from "@/lib/errors";
import { computeCartaoTotalizadores, totalizadoresToLancamentos } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import { syncLancamentosCacheFromSheets } from "@/lib/sheets/lancamentosCacheClient";
import {
  buildCartaoTxKey,
  deleteCartaoMovimento,
  ensureCartoesDb,
  readCartaoMovimentosComAlocacoes,
  saveCartaoMovimento
} from "@/lib/sheets/cartoesClient";
import {
  appendLegacyLancamento,
  appendRow,
  deleteRowById,
  ensureSchemaSheets,
  readLancamentos,
  removeLegacyLancamento,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import type { BancoCartao, CartaoMovimentoComAlocacoes, Lancamento, PessoaPagadora } from "@/lib/types";
import { cartaoMovimentoSchema } from "@/lib/validation/schemas";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

type LegacySyncResult = {
  status: string;
  message?: string;
  range?: string;
};

type TotalizerTarget = {
  mes: string;
  banco: BancoCartao;
};

const TOTALIZER_SUFFIXES = ["WALKER", "AMBOS", "DEA"] as const;

function withLegacyStatusTag(observacaoBase: string, legacy: LegacySyncResult): string {
  const clean = observacaoBase
    .replace(/\s*\[LEGADO:[A-Z_]+\](?:\s*\([^)]+\))?(?:\s*\(range [^)]+\))?/g, "")
    .trim();
  const tag = `[LEGADO:${legacy.status.toUpperCase()}]`;
  const detail = legacy.message ? `(${legacy.message})` : "";
  const where = legacy.range ? `(range ${legacy.range})` : "";
  const suffix = [tag, detail, where].filter(Boolean).join(" ");
  return clean ? `${clean} ${suffix}` : suffix;
}

function withCartaoTag(observacaoBase: string, tag: string): string {
  const clean = observacaoBase.trim();
  return clean.includes(tag) ? clean : clean ? `${clean} ${tag}` : tag;
}

function sortMostRecent(rows: Lancamento[]): Lancamento[] {
  return [...rows].sort((a, b) => {
    const byUpdated = b.updated_at.localeCompare(a.updated_at);
    if (byUpdated !== 0) return byUpdated;
    return b.created_at.localeCompare(a.created_at);
  });
}

function isManagedTotalizerDescricao(descricao: string, banco: BancoCartao): boolean {
  return TOTALIZER_SUFFIXES.some((suffix) => descricao === `${banco}_${suffix}`);
}

function movementTarget(movimento: CartaoMovimentoComAlocacoes | null): TotalizerTarget | null {
  if (!movimento?.cartao) return null;
  return {
    mes: movimento.mes_ref,
    banco: movimento.cartao.banco
  };
}

function dedupeTargets(targets: Array<TotalizerTarget | null>): TotalizerTarget[] {
  const uniq = new Map<string, TotalizerTarget>();
  for (const item of targets) {
    if (!item) continue;
    const key = `${item.mes}|${item.banco}`;
    uniq.set(key, item);
  }
  return [...uniq.values()];
}

async function syncLegacyTotalizersIfMonthAlreadyClosed(targetsRaw: Array<TotalizerTarget | null>): Promise<void> {
  const targets = dedupeTargets(targetsRaw);
  if (targets.length === 0) return;

  await ensureCartoesDb();
  await ensureSchemaSheets();

  const movimentos = await readCartaoMovimentosComAlocacoes();
  let touchedLancamentos = false;

  for (const target of targets) {
    const tag = `[CARTAO_TOTALIZADOR:${target.banco}:${target.mes}]`;
    const lancamentos = await readLancamentos();
    const existingTagged = lancamentos.filter(
      (item) => item.observacao?.includes(tag) && isManagedTotalizerDescricao(item.descricao, target.banco)
    );

    // Regra solicitada: so sincroniza se o mes ja tiver sido fechado/lancado.
    if (existingTagged.length === 0) {
      continue;
    }

    const template = sortMostRecent(existingTagged)[0];
    const totalizadores = computeCartaoTotalizadores({
      movimentos,
      mes: target.mes,
      banco: target.banco
    });

    const planned = totalizadoresToLancamentos({
      totalizadores,
      categoria: template.categoria || "CARTAO_CREDITO",
      quem_pagou: (template.quem_pagou || "WALKER") as PessoaPagadora
    }).map((item) => ({ ...item, observacao: withCartaoTag(item.observacao ?? "", tag) }));

    const plannedByDescricao = new Map(planned.map((item) => [item.descricao, item]));
    const existingByDescricao = new Map<string, Lancamento[]>();
    for (const row of existingTagged) {
      const list = existingByDescricao.get(row.descricao) ?? [];
      list.push(row);
      existingByDescricao.set(row.descricao, list);
    }

    for (const [descricao, plannedRow] of plannedByDescricao.entries()) {
      const currentRows = sortMostRecent(existingByDescricao.get(descricao) ?? []);
      if (currentRows.length === 0) {
        await appendRow("LANCAMENTOS", plannedRow);
        let legacy: LegacySyncResult = { status: "error", message: "Falha ao espelhar totalizador no legado." };
        try {
          legacy = await appendLegacyLancamento(plannedRow);
        } catch {
          // Mantem status de erro.
        }
        const finalized: Lancamento = {
          ...plannedRow,
          observacao: withLegacyStatusTag(plannedRow.observacao ?? "", legacy),
          updated_at: toIsoNow()
        };
        await updateRowById("LANCAMENTOS", plannedRow.id, finalized);
        touchedLancamentos = true;
        continue;
      }

      const [primary, ...duplicates] = currentRows;
      const baseObservacao = withCartaoTag(primary.observacao ?? plannedRow.observacao ?? "", tag);
      const changed =
        primary.data !== plannedRow.data ||
        primary.categoria !== plannedRow.categoria ||
        primary.valor !== plannedRow.valor ||
        primary.atribuicao !== plannedRow.atribuicao ||
        primary.quem_pagou !== plannedRow.quem_pagou ||
        (primary.observacao ?? "") !== baseObservacao;

      if (changed) {
        const nextRow: Lancamento = {
          ...primary,
          ...plannedRow,
          id: primary.id,
          created_at: primary.created_at,
          updated_at: toIsoNow(),
          observacao: baseObservacao
        };

        let legacy: LegacySyncResult = { status: "skipped", message: "Sincronizacao legado nao executada." };
        try {
          const removed = await removeLegacyLancamento(primary);
          if (removed.status === "error") {
            legacy = {
              status: "error",
              message: removed.message ?? "Falha ao remover totalizador anterior no legado."
            };
          } else {
            legacy = await appendLegacyLancamento(nextRow);
          }
        } catch {
          legacy = { status: "error", message: "Falha ao atualizar totalizador no legado." };
        }

        nextRow.observacao = withLegacyStatusTag(nextRow.observacao ?? "", legacy);
        nextRow.updated_at = toIsoNow();
        await updateRowById("LANCAMENTOS", nextRow.id, nextRow);
        touchedLancamentos = true;
      }

      for (const duplicate of duplicates) {
        await deleteRowById("LANCAMENTOS", duplicate.id);
        try {
          await removeLegacyLancamento(duplicate);
        } catch {
          // Mantem limpeza no LANCAMENTOS mesmo que o espelho legado falhe.
        }
        touchedLancamentos = true;
      }
    }

    // Remove totalizadores obsoletos (ex.: atribuicao ficou zerada apos edicao/exclusao).
    for (const [descricao, rows] of existingByDescricao.entries()) {
      if (plannedByDescricao.has(descricao)) continue;
      for (const row of rows) {
        await deleteRowById("LANCAMENTOS", row.id);
        try {
          await removeLegacyLancamento(row);
        } catch {
          // Mantem limpeza no LANCAMENTOS mesmo que o espelho legado falhe.
        }
        touchedLancamentos = true;
      }
    }
  }

  if (touchedLancamentos) {
    try {
      await syncLancamentosCacheFromSheets();
    } catch {
      // Nao bloqueia operacao principal por falha de cache.
    }
  }
}

export async function GET(request: Request) {
  try {
    await ensureCartoesDb();
    const { searchParams } = new URL(request.url);
    const mes = searchParams.get("mes")?.trim();
    const cartaoId = searchParams.get("cartaoId")?.trim();
    const status = searchParams.get("status")?.trim();

    const rows = await readCartaoMovimentosComAlocacoes();
    const filtered = rows.filter((item) => {
      if (mes && item.mes_ref !== mes) return false;
      if (cartaoId && item.cartao_id !== cartaoId) return false;
      if (status && item.status !== status) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (a.data !== b.data) return b.data.localeCompare(a.data);
      return b.created_at.localeCompare(a.created_at);
    });

    return jsonOk({ data: filtered });
  } catch (error) {
    return jsonError(error);
  }
}

async function saveFromPayload(body: unknown, idMode: "create" | "update") {
  await ensureCartoesDb();
  const parsed = cartaoMovimentoSchema.parse(body);
  if (idMode === "update" && !parsed.id) {
    throw new AppError("id obrigatorio para atualizar movimento", 400, "MISSING_ID");
  }
  if (idMode === "create" && parsed.id) {
    throw new AppError("id nao deve ser informado na criacao", 400, "INVALID_ID");
  }

  const tx_key =
    parsed.tx_key?.trim() ||
    buildCartaoTxKey({
      cartao_id: parsed.cartao_id,
      data: parsed.data,
      descricao: parsed.descricao,
      valor: parsed.valor,
      parcela_total: parsed.parcela_total,
      parcela_numero: parsed.parcela_numero
    });

  return saveCartaoMovimento({
    id: parsed.id,
    cartao_id: parsed.cartao_id,
    data: parsed.data,
    descricao: parsed.descricao,
    valor: parsed.valor,
    parcela_total: parsed.parcela_total,
    parcela_numero: parsed.parcela_numero,
    tx_key,
    origem: parsed.origem,
    status: parsed.status,
    mes_ref: parsed.mes_ref,
    observacao: parsed.observacao,
    alocacoes: parsed.alocacoes
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const row = await saveFromPayload(body, "create");
    return jsonOk({ data: row }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const currentId = typeof (body as { id?: unknown })?.id === "string" ? (body as { id: string }).id : null;

    let before: CartaoMovimentoComAlocacoes | null = null;
    if (currentId) {
      await ensureCartoesDb();
      const rows = await readCartaoMovimentosComAlocacoes();
      before = rows.find((item) => item.id === currentId) ?? null;
    }

    const row = await saveFromPayload(body, "update");
    await syncLegacyTotalizersIfMonthAlreadyClosed([movementTarget(before), movementTarget(row)]);

    return jsonOk({ data: row });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      throw new AppError("id obrigatorio para exclusao", 400, "MISSING_ID");
    }

    await ensureCartoesDb();
    const rows = await readCartaoMovimentosComAlocacoes();
    const current = rows.find((item) => item.id === id) ?? null;

    await deleteCartaoMovimento(id);
    await syncLegacyTotalizersIfMonthAlreadyClosed([movementTarget(current)]);

    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
