import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { defaultAtribuicaoForCard, reconcileImportLines } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import {
  alignCartaoMovimentosMesRef,
  buildCartaoTxKey,
  ensureCartoesDb,
  readCartaoMovimentosComAlocacoes,
  readCartoes,
  saveCartaoMovimento
} from "@/lib/sheets/cartoesClient";
import { cartaoImportRunSchema } from "@/lib/validation/schemas";
import { toIsoNow, ymFromDate } from "@/lib/utils";

export const runtime = "nodejs";

function normalizeCardFinal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed.toUpperCase();
}

function filterLinesByCardFinal<
  T extends {
    final_cartao?: string;
  }
>(lines: T[], cardFinal: string): { lines: T[]; ignored: number } {
  const target = normalizeCardFinal(cardFinal);
  if (!target) {
    return { lines, ignored: 0 };
  }

  const filtered = lines.filter((line) => {
    const lineFinal = normalizeCardFinal(line.final_cartao ?? "");
    if (!lineFinal) return true;
    return lineFinal === target;
  });

  return {
    lines: filtered,
    ignored: lines.length - filtered.length
  };
}

export async function POST(request: Request) {
  try {
    await ensureCartoesDb();
    const body = await request.json();
    const parsed = cartaoImportRunSchema.parse(body);

    const [cartoes, movimentos] = await Promise.all([readCartoes(), readCartaoMovimentosComAlocacoes()]);
    const cartao = cartoes.find((item) => item.id === parsed.cartao_id);
    if (!cartao) {
      throw new AppError("Cartao nao encontrado", 404, "CARD_NOT_FOUND");
    }

    const filtered = filterLinesByCardFinal(parsed.lines, cartao.final_cartao);

    const preview = reconcileImportLines({
      cartao,
      lines: filtered.lines,
      existing: movimentos
    });
    const mesRefFatura = parsed.mes_ref?.trim() || null;

    const novos = preview.preview.filter((item) => item.status === "novo");
    const jaLancados = preview.preview.filter((item) => item.status === "ja_lancado" && item.movimentoId);
    const atribuicaoDefault = defaultAtribuicaoForCard(cartao);
    const statusDefault = "pendente";
    const now = toIsoNow();
    let realinhadosMesRef = 0;

    if (!parsed.dryRun) {
      if (mesRefFatura && jaLancados.length > 0) {
        const ids = new Set(jaLancados.map((item) => item.movimentoId as string));
        realinhadosMesRef = await alignCartaoMovimentosMesRef({
          ids: [...ids],
          mes_ref: mesRefFatura,
          updated_at: now
        });
      }

      for (const item of novos) {
        const tx_key =
          item.tx_key ||
          buildCartaoTxKey({
            cartao_id: cartao.id,
            data: item.data,
            descricao: item.descricao,
            valor: item.valor,
            parcela_total: item.parcela_total,
            parcela_numero: item.parcela_numero
          });
        await saveCartaoMovimento({
          cartao_id: cartao.id,
          data: item.data,
          descricao: item.descricao,
          valor: item.valor,
          parcela_total: item.parcela_total ?? null,
          parcela_numero: item.parcela_numero ?? null,
          tx_key,
          origem: "fatura",
          status: statusDefault,
          mes_ref: mesRefFatura ?? ymFromDate(item.data),
          observacao: item.observacao
            ? `${item.observacao} [IMPORT_FATURA]`
            : "[IMPORT_FATURA]",
          alocacoes: [
            {
              id: randomUUID(),
              atribuicao: atribuicaoDefault,
              valor: item.valor
            }
          ]
        });
      }
    }

    return jsonOk({
      data: {
        cartao,
        total: preview.total,
        conciliados: preview.conciliados,
        novos: preview.novos,
        filtradosPorFinalCartao: filtered.ignored,
        realinhadosMesRef: parsed.dryRun ? 0 : realinhadosMesRef,
        importados: parsed.dryRun ? 0 : novos.length,
        pendentesClassificacao: parsed.dryRun ? novos.length : novos.length,
        statusDefault,
        atribuicaoDefault
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
