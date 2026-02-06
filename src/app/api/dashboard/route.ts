import { computeDashboard } from "@/domain/calculations";
import { jsonError, jsonOk } from "@/lib/http";
import {
  readCalendarioAnual,
  readContasFixas,
  readLegacyMonthRealBalance,
  readLancamentos,
  readReceitasRegras
} from "@/lib/sheets/sheetsClient";
import { parseNumber } from "@/lib/utils";
import { reportQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cacheKey = searchParams.toString();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return jsonOk({ data: cached.data });
    }

    const query = reportQuerySchema.parse({ mes: searchParams.get("mes") ?? "" });
    const saldoBancoRaw = searchParams.get("saldoBanco");
    const saldoCarteiraRaw = searchParams.get("saldoCarteira");
    const hasSaldoBanco = saldoBancoRaw !== null && saldoBancoRaw.trim() !== "";
    const hasSaldoCarteira = saldoCarteiraRaw !== null && saldoCarteiraRaw.trim() !== "";

    let saldoBanco = hasSaldoBanco ? parseNumber(saldoBancoRaw, 0) : 0;
    let saldoCarteira = hasSaldoCarteira ? parseNumber(saldoCarteiraRaw, 0) : 0;
    let fonteSaldoReal: "manual" | "legacy" | "mixed" = "manual";

    if (!hasSaldoBanco || !hasSaldoCarteira) {
      const legacy = await readLegacyMonthRealBalance(query.mes);
      if (legacy) {
        if (!hasSaldoBanco) {
          saldoBanco = legacy.saldoBanco;
        }
        if (!hasSaldoCarteira) {
          saldoCarteira = legacy.saldoCarteira;
        }
        fonteSaldoReal = hasSaldoBanco || hasSaldoCarteira ? "mixed" : "legacy";
      } else if (hasSaldoBanco || hasSaldoCarteira) {
        fonteSaldoReal = "mixed";
      }
    }

    const [lancamentos, contasFixas, calendarioAnual, receitasRegras] = await Promise.all([
      readLancamentos(),
      readContasFixas(),
      readCalendarioAnual(),
      readReceitasRegras()
    ]);

    const dashboard = computeDashboard({
      month: query.mes,
      lancamentos,
      contasFixas,
      calendarioAnual,
      receitasRegras,
      saldoBanco,
      saldoCarteira,
      fonteSaldoReal
    });

    cache.set(cacheKey, { at: Date.now(), data: dashboard });
    return jsonOk({ data: dashboard });
  } catch (error) {
    return jsonError(error);
  }
}
