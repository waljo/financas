import { jsonError, jsonOk } from "@/lib/http";
import {
  readLancamentosCacheStatus,
  readSyncStatusMeta,
  syncLancamentosCacheFromSheets,
  writeSyncStatusMeta
} from "@/lib/sheets/lancamentosCacheClient";

export const runtime = "nodejs";

export async function POST() {
  const runAt = new Date().toISOString();

  try {
    writeSyncStatusMeta({
      lastRunAt: runAt,
      lastError: null
    });

    await syncLancamentosCacheFromSheets();

    const successAt = new Date().toISOString();
    writeSyncStatusMeta({
      lastRunAt: runAt,
      lastSuccessAt: successAt,
      lastError: null
    });

    const cache = readLancamentosCacheStatus();
    const syncMeta = readSyncStatusMeta();

    return jsonOk({
      data: {
        online: true,
        lastRunAt: syncMeta.lastRunAt,
        lastSuccessAt: syncMeta.lastSuccessAt,
        lastError: syncMeta.lastError,
        pendingOps: 0,
        failedOps: 0,
        conflicts: 0,
        cache: {
          lancamentos: cache
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar cache local.";
    writeSyncStatusMeta({
      lastRunAt: runAt,
      lastError: message
    });
    return jsonError(error);
  }
}
