import { computeReport } from "@/domain/calculations";
import { jsonError, jsonOk } from "@/lib/http";
import { readLancamentos } from "@/lib/sheets/sheetsClient";
import { reportQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mes = searchParams.get("mes") ?? "";
    const query = reportQuerySchema.parse({ mes });

    const lancamentos = await readLancamentos();
    const report = computeReport(query.mes, lancamentos);

    return jsonOk({ data: report });
  } catch (error) {
    return jsonError(error);
  }
}
