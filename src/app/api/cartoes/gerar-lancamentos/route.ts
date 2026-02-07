import { AppError } from "@/lib/errors";
import { computeCartaoTotalizadores, totalizadoresToLancamentos } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes } from "@/lib/sheets/cartoesClient";
import {
  appendLegacyLancamento,
  appendRows,
  ensureSchemaSheets,
  readLancamentos,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import { cartaoGerarLancamentosSchema } from "@/lib/validation/schemas";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

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
    const existingKeys = new Set(
      existing
        .filter((item) => item.data.startsWith(parsed.mes))
        .filter((item) => item.observacao?.includes(tag))
        .map((item) => `${item.descricao}|${item.valor.toFixed(2)}`)
    );

    const toInsert = planned.filter((item) => !existingKeys.has(`${item.descricao}|${item.valor.toFixed(2)}`));
    const skipped = planned.length - toInsert.length;
    const legacyResults: Array<{ id: string; status: string; message?: string; range?: string }> = [];

    if (!parsed.dryRun && toInsert.length > 0) {
      await appendRows("LANCAMENTOS", toInsert);
      for (const item of toInsert) {
        const legacy = await appendLegacyLancamento(item);
        legacyResults.push({
          id: item.id,
          status: legacy.status,
          message: legacy.message,
          range: legacy.range
        });

        const status = legacy.status.toUpperCase();
        const tag = `[LEGADO:${status}]`;
        const detail = legacy.message ? `(${legacy.message})` : "";
        const where = legacy.range ? `(range ${legacy.range})` : "";
        const tagFull = [tag, detail, where].filter(Boolean).join(" ");
        const observacao = item.observacao?.includes("[LEGADO:")
          ? item.observacao
          : item.observacao
            ? `${item.observacao} ${tagFull}`
            : tagFull;

        if (observacao !== item.observacao) {
          await updateRowById("LANCAMENTOS", item.id, {
            ...item,
            observacao,
            updated_at: toIsoNow()
          });
          item.observacao = observacao;
        }
      }
    }

    return jsonOk({
      data: {
        mes: parsed.mes,
        banco: parsed.banco,
        totalizadores: totalizadores.porAtribuicao,
        generated: parsed.dryRun ? planned.length : toInsert.length,
        skippedExisting: skipped,
        legacy: parsed.dryRun ? [] : legacyResults,
        dryRun: parsed.dryRun
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
