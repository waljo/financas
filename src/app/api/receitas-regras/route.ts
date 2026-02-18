import { jsonError, jsonOk } from "@/lib/http";
import { readReceitasRegras } from "@/lib/sheets/sheetsClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await readReceitasRegras();
    return jsonOk({ data: rows });
  } catch (error) {
    return jsonError(error);
  }
}
