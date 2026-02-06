import { ensureSchemaSheets } from "@/lib/sheets/sheetsClient";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    await ensureSchemaSheets();
    return jsonOk({ ok: true, message: "Abas normalizadas garantidas com sucesso" });
  } catch (error) {
    return jsonError(error);
  }
}
