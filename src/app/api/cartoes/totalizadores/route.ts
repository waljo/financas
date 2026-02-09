import { computeCartaoTotalizadores } from "@/domain/cartoes";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes } from "@/lib/sheets/cartoesClient";
import { cartaoTotalizadoresQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await ensureCartoesDb();
    const { searchParams } = new URL(request.url);
    const parsed = cartaoTotalizadoresQuerySchema.parse({
      mes: searchParams.get("mes"),
      banco: searchParams.get("banco"),
      cartaoId: searchParams.get("cartaoId") ?? undefined
    });

    const movimentos = await readCartaoMovimentosComAlocacoes();
    const totalizadores = computeCartaoTotalizadores({
      movimentos,
      mes: parsed.mes,
      banco: parsed.banco,
      cartaoId: parsed.cartaoId
    });

    return jsonOk({ data: totalizadores });
  } catch (error) {
    return jsonError(error);
  }
}
