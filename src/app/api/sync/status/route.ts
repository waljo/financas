import { jsonError, jsonOk } from "@/lib/http";
import {
  readLancamentosCacheStatus,
  readSyncStatusMeta
} from "@/lib/sheets/lancamentosCacheClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const cache = readLancamentosCacheStatus();
    const syncMeta = readSyncStatusMeta();
    const hasError = Boolean(syncMeta.lastError);

    return jsonOk({
      data: {
        online: true,
        lastRunAt: syncMeta.lastRunAt,
        lastSuccessAt: syncMeta.lastSuccessAt ?? cache.syncedAt,
        lastError: syncMeta.lastError,
        pendingOps: 0,
        failedOps: hasError ? 1 : 0,
        conflicts: 0,
        cache: {
          lancamentos: cache
        }
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
