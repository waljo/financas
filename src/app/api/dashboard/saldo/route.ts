import { jsonError, jsonOk } from "@/lib/http";
import { writeLegacyMonthRealBalance } from "@/lib/sheets/sheetsClient";
import { dashboardSaldoSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = dashboardSaldoSchema.parse(body);
    const saldoBanco = parsed.saldoBB + parsed.saldoC6;
    const legacy = await writeLegacyMonthRealBalance({
      month: parsed.mes,
      saldoBanco,
      saldoCarteira: parsed.saldoCarteira
    });

    return jsonOk({
      data: {
        mes: parsed.mes,
        saldoBB: parsed.saldoBB,
        saldoC6: parsed.saldoC6,
        saldoBanco,
        saldoCarteira: parsed.saldoCarteira,
        legacy
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
