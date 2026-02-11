import { AppError } from "@/lib/errors";
import { computeCartaoTotalizadores, totalizadoresToLancamentos } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes } from "@/lib/sheets/cartoesClient";
import { syncLancamentosCacheFromSheets } from "@/lib/sheets/lancamentosCacheClient";
import {
  appendLegacyLancamento,
  appendRows,
  deleteRowById,
  ensureSchemaSheets,
  readLancamentos,
  removeLegacyLancamento,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import type { Lancamento } from "@/lib/types";
import { cartaoGerarLancamentosSchema } from "@/lib/validation/schemas";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

type LegacySyncResult = {
  status: string;
  message?: string;
  range?: string;
};

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

export async function POST(request: Request) {
  try {
    await ensureCartoesDb();
    const body = await request.json();
    const parsed = cartaoGerarLancamentosSchema.parse(body);

    const movimentos = await readCartaoMovimentosComAlocacoes();
    const totalizadores = computeCartaoTotalizadores({
      movimentos,
      mes: parsed.mes,
      banco: parsed.banco
    });

    if (totalizadores.pendentes > 0) {
      throw new AppError(
        `Existem ${totalizadores.pendentes} compra(s) pendente(s) de classificacao para ${parsed.banco} em ${parsed.mes}`,
        409,
        "PENDING_CLASSIFICATION"
      );
    }

    const planned = totalizadoresToLancamentos({
      totalizadores,
      quem_pagou: parsed.quem_pagou,
      categoria: parsed.categoria
    });

    await ensureSchemaSheets();
    const tag = `[CARTAO_TOTALIZADOR:${parsed.banco}:${parsed.mes}]`;
    const existing = await readLancamentos();
    const existingTagged = existing.filter((item) => item.observacao?.includes(tag));
    const existingByDescricao = new Map<string, Lancamento[]>();
    for (const row of existingTagged) {
      const list = existingByDescricao.get(row.descricao) ?? [];
      list.push(row);
      existingByDescricao.set(row.descricao, list);
    }

    const plannedByDescricao = new Map(planned.map((row) => [row.descricao, row]));

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let unchanged = 0;
    const legacyResults: Array<{
      id: string;
      action: "created" | "updated" | "deleted";
      status: string;
      message?: string;
      range?: string;
    }> = [];

    // Dry-run: apenas calcula impacto sem escrita.
    if (parsed.dryRun) {
      for (const [descricao, plannedRow] of plannedByDescricao.entries()) {
        const currentRows = existingByDescricao.get(descricao) ?? [];
        if (currentRows.length === 0) {
          created += 1;
          continue;
        }
        const primary = sortMostRecent(currentRows)[0];
        const changed =
          primary.data !== plannedRow.data ||
          primary.categoria !== plannedRow.categoria ||
          primary.valor !== plannedRow.valor ||
          primary.atribuicao !== plannedRow.atribuicao ||
          primary.quem_pagou !== plannedRow.quem_pagou;
        if (changed) {
          updated += 1;
        } else {
          unchanged += 1;
        }
        deleted += Math.max(currentRows.length - 1, 0);
      }

      for (const [descricao, currentRows] of existingByDescricao.entries()) {
        if (!plannedByDescricao.has(descricao)) {
          deleted += currentRows.length;
        }
      }
    } else {
      const toInsert: Lancamento[] = [];

      for (const [descricao, plannedRow] of plannedByDescricao.entries()) {
        const currentRows = sortMostRecent(existingByDescricao.get(descricao) ?? []);
        if (currentRows.length === 0) {
          toInsert.push(plannedRow);
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
            legacy = { status: "error", message: "Falha ao sincronizar atualizacao no legado." };
          }

          nextRow.observacao = withLegacyStatusTag(nextRow.observacao ?? "", legacy);
          nextRow.updated_at = toIsoNow();
          await updateRowById("LANCAMENTOS", nextRow.id, nextRow);
          updated += 1;
          legacyResults.push({
            id: nextRow.id,
            action: "updated",
            status: legacy.status,
            message: legacy.message,
            range: legacy.range
          });
        } else {
          unchanged += 1;
        }

        for (const duplicate of duplicates) {
          await deleteRowById("LANCAMENTOS", duplicate.id);
          let legacy: LegacySyncResult = { status: "skipped", message: "Sem espelho legado para remover." };
          try {
            legacy = await removeLegacyLancamento(duplicate);
          } catch {
            legacy = { status: "error", message: "Falha ao remover duplicata no legado." };
          }
          deleted += 1;
          legacyResults.push({
            id: duplicate.id,
            action: "deleted",
            status: legacy.status,
            message: legacy.message,
            range: legacy.range
          });
        }
      }

      for (const [descricao, rows] of existingByDescricao.entries()) {
        if (plannedByDescricao.has(descricao)) continue;
        for (const current of rows) {
          await deleteRowById("LANCAMENTOS", current.id);
          let legacy: LegacySyncResult = { status: "skipped", message: "Sem espelho legado para remover." };
          try {
            legacy = await removeLegacyLancamento(current);
          } catch {
            legacy = { status: "error", message: "Falha ao remover totalizador obsoleto no legado." };
          }
          deleted += 1;
          legacyResults.push({
            id: current.id,
            action: "deleted",
            status: legacy.status,
            message: legacy.message,
            range: legacy.range
          });
        }
      }

      if (toInsert.length > 0) {
        await appendRows("LANCAMENTOS", toInsert);
      }
      for (const item of toInsert) {
        let legacy: LegacySyncResult = { status: "error", message: "Falha ao espelhar criacao no legado." };
        try {
          legacy = await appendLegacyLancamento(item);
        } catch {
          // Mantem status padrao de erro.
        }
        const nextRow = {
          ...item,
          observacao: withLegacyStatusTag(withCartaoTag(item.observacao ?? "", tag), legacy),
          updated_at: toIsoNow()
        };
        await updateRowById("LANCAMENTOS", item.id, nextRow);
        created += 1;
        legacyResults.push({
          id: item.id,
          action: "created",
          status: legacy.status,
          message: legacy.message,
          range: legacy.range
        });
      }

      try {
        await syncLancamentosCacheFromSheets();
      } catch {
        // Mantem sucesso do fechamento no Sheets mesmo se cache local falhar.
      }
    }

    const processed = created + updated + deleted;
    return jsonOk({
      data: {
        mes: parsed.mes,
        banco: parsed.banco,
        totalizadores: totalizadores.porAtribuicao,
        generated: created,
        updated,
        deleted,
        unchanged,
        processed,
        skippedExisting: unchanged,
        legacy: parsed.dryRun ? [] : legacyResults,
        dryRun: parsed.dryRun
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
