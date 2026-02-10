import { jsonError, jsonOk } from "@/lib/http";
import { readSyncStatus } from "@/lib/sync/engine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkConnection = (searchParams.get("checkConnection") ?? "").toLowerCase() === "true";
    const data = await readSyncStatus({ checkConnection });
    return jsonOk({ data });
  } catch (error) {
    return jsonError(error);
  }
}
