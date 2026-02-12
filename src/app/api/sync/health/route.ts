import { jsonError, jsonOk } from "@/lib/http";
import { requestAppsScript } from "@/lib/mobileOffline/appsScriptClient";
import { isMobileOfflineModeEnabled } from "@/lib/mobileOffline/flags";
import { ensureSchemaSheets } from "@/lib/sheets/sheetsClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!isMobileOfflineModeEnabled()) {
      return jsonOk({
        ok: false,
        enabled: false,
        message: "MOBILE_OFFLINE_MODE desativado"
      });
    }

    const appsScriptUrl = process.env.APPS_SCRIPT_WEB_APP_URL?.trim();
    const appsScriptToken = process.env.APPS_SCRIPT_APP_TOKEN?.trim();

    if (!appsScriptUrl || !appsScriptToken) {
      await ensureSchemaSheets();
      return jsonOk({
        ok: true,
        enabled: true,
        mode: "sheets_oauth_fallback",
        message: "Apps Script não configurado; usando sync direto no Google Sheets via OAuth."
      });
    }

    const result = await requestAppsScript("health", { method: "GET" });
    return jsonOk({
      ok: true,
      enabled: true,
      mode: "apps_script",
      target: result.url,
      remote: result.body
    });
  } catch (error) {
    return jsonError(error);
  }
}
