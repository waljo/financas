import { jsonError, jsonOk } from "@/lib/http";
import { runManualSync } from "@/lib/sync/engine";

export const runtime = "nodejs";

export async function POST() {
  try {
    const data = await runManualSync();
    return jsonOk({
      data,
      message: "Sincronizacao concluida com sucesso."
    });
  } catch (error) {
    return jsonError(error);
  }
}
