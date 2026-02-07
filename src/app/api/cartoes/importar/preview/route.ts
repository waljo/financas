import { AppError } from "@/lib/errors";
import { reconcileImportLines } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes, readCartoes } from "@/lib/sheets/cartoesClient";
import { cartaoImportPreviewSchema } from "@/lib/validation/schemas";

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
    const parsed = cartaoImportPreviewSchema.parse(body);

    const [cartoes, movimentos] = await Promise.all([readCartoes(), readCartaoMovimentosComAlocacoes()]);
    const cartao = cartoes.find((item) => item.id === parsed.cartao_id);
    if (!cartao) {
      throw new AppError("Cartao nao encontrado", 404, "CARD_NOT_FOUND");
    }

    const filtered = filterLinesByCardFinal(parsed.lines, cartao.final_cartao);

    const result = reconcileImportLines({
      cartao,
      lines: filtered.lines,
      existing: movimentos
    });

    return jsonOk({
      data: {
        cartao,
        filtradosPorFinalCartao: filtered.ignored,
        ...result
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
