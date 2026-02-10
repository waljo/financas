import { AppError } from "@/lib/errors";
import {
  readLancamentosCacheMeta,
  readLancamentosCacheStatus,
  syncLancamentosCacheFromSheets,
  writeLancamentosCacheMeta
} from "@/lib/sheets/lancamentosCacheClient";
import { ensureSchemaSheets } from "@/lib/sheets/sheetsClient";

const SYNC_META_LAST_RUN_AT = "sync_last_run_at";
const SYNC_META_LAST_SUCCESS_AT = "sync_last_success_at";
const SYNC_META_LAST_ERROR = "sync_last_error";

export interface SyncStatusPayload {
  online: boolean | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingOps: number;
  failedOps: number;
  conflicts: number;
  cache: {
    lancamentos: {
      count: number;
      syncedAt: string | null;
      fresh: boolean;
      ttlMs: number;
    };
  };
}

function readSyncMeta() {
  return {
    lastRunAt: readLancamentosCacheMeta(SYNC_META_LAST_RUN_AT),
    lastSuccessAt: readLancamentosCacheMeta(SYNC_META_LAST_SUCCESS_AT),
    lastError: readLancamentosCacheMeta(SYNC_META_LAST_ERROR)
  };
}

function markSyncRun() {
  writeLancamentosCacheMeta(SYNC_META_LAST_RUN_AT, new Date().toISOString());
}

function markSyncSuccess() {
  writeLancamentosCacheMeta(SYNC_META_LAST_SUCCESS_AT, new Date().toISOString());
  writeLancamentosCacheMeta(SYNC_META_LAST_ERROR, "");
}

function markSyncFailure(message: string) {
  writeLancamentosCacheMeta(SYNC_META_LAST_ERROR, message.trim().slice(0, 500));
}

async function checkSheetsConnectivity(): Promise<{ online: boolean; errorMessage: string | null }> {
  try {
    await ensureSchemaSheets();
    return { online: true, errorMessage: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao validar conexão com Google Sheets.";
    return { online: false, errorMessage: message };
  }
}

export async function readSyncStatus(options?: { checkConnection?: boolean }): Promise<SyncStatusPayload> {
  const cache = readLancamentosCacheStatus();
  const meta = readSyncMeta();

  let online: boolean | null = null;
  let lastError = meta.lastError && meta.lastError.trim() ? meta.lastError.trim() : null;

  if (options?.checkConnection) {
    const check = await checkSheetsConnectivity();
    online = check.online;
    if (!check.online && check.errorMessage) {
      lastError = check.errorMessage;
    }
  }

  return {
    online,
    lastRunAt: meta.lastRunAt,
    lastSuccessAt: meta.lastSuccessAt,
    lastError,
    pendingOps: 0,
    failedOps: lastError ? 1 : 0,
    conflicts: 0,
    cache: {
      lancamentos: {
        count: cache.count,
        syncedAt: cache.syncedAt,
        fresh: cache.fresh,
        ttlMs: cache.ttlMs
      }
    }
  };
}

export async function runManualSync(): Promise<SyncStatusPayload> {
  markSyncRun();
  try {
    await ensureSchemaSheets();
    await syncLancamentosCacheFromSheets();
    markSyncSuccess();
    return readSyncStatus({ checkConnection: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronização manual.";
    markSyncFailure(message);
    throw new AppError(message, 502, "SYNC_RUN_FAILED");
  }
}
