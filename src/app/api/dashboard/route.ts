import { computeDashboard } from "@/domain/calculations";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes } from "@/lib/sheets/cartoesClient";
import { readLancamentosCached } from "@/lib/sheets/lancamentosCacheClient";
import {
  readCalendarioAnual,
  readContasFixas,
  readLegacyMonthRealBalance,
  readReceitasRegras
} from "@/lib/sheets/sheetsClient";
import type { CartaoMovimentoComAlocacoes } from "@/lib/types";
import { reportQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = reportQuerySchema.parse({ mes: searchParams.get("mes") ?? "" });
    const legacy = await readLegacyMonthRealBalance(query.mes);
    const saldoBanco = legacy?.saldoBanco ?? 0;
    const saldoCarteira = legacy?.saldoCarteira ?? 0;
    const fonteSaldoReal: "legacy" = "legacy";

    const [lancamentos, contasFixas, calendarioAnual, receitasRegras] = await Promise.all([
      readLancamentosCached(),
      readContasFixas(),
      readCalendarioAnual(),
      readReceitasRegras()
    ]);
    let cartaoMovimentos: CartaoMovimentoComAlocacoes[] = [];
    try {
      await ensureCartoesDb();
      cartaoMovimentos = await readCartaoMovimentosComAlocacoes();
    } catch {
      cartaoMovimentos = [];
    }

    const dashboard = computeDashboard({
      month: query.mes,
      lancamentos,
      cartaoMovimentos,
      contasFixas,
      calendarioAnual,
      receitasRegras,
      saldoBanco,
      saldoCarteira,
      fonteSaldoReal
    });

    return jsonOk({ data: dashboard });
  } catch (error) {
    return jsonError(error);
  }
}
