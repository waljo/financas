"use client";

import type { Lancamento } from "@/lib/types";
import {
  countPendingLancamentos,
  getSyncState,
  listLocalLancamentos,
  markLancamentosAsSynced,
  saveLocalLancamento,
  setSyncState,
  type LocalLancamentoRecord
} from "@/lib/mobileOffline/db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueueLancamentoInput = Omit<Lancamento, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export interface SyncNowResult {
  syncedCount: number;
  pendingBefore: number;
  pendingAfter: number;
  syncedIds: string[];
}

function fallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function ensureUuid(value?: string) {
  if (value && UUID_PATTERN.test(value)) return value;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return fallbackUuid();
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Erro ao sincronizar";
}

function dedupeRecordsById(records: LocalLancamentoRecord[]) {
  const byId = new Map<string, LocalLancamentoRecord>();
  for (const record of records) {
    const current = byId.get(record.id);
    if (!current || current.updated_at < record.updated_at) {
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

export async function enqueueLancamentoLocal(input: QueueLancamentoInput) {
  const now = new Date().toISOString();
  const id = ensureUuid(input.id);

  const payload: Lancamento = {
    ...input,
    id,
    created_at: now,
    updated_at: now
  };

  return saveLocalLancamento(payload, { synced: false });
}

export async function readLancamentosLocaisByMonth(month: string) {
  return listLocalLancamentos({ month });
}

export async function readSyncDashboard() {
  const [pendingCount, syncState, pendingRecords] = await Promise.all([
    countPendingLancamentos(),
    getSyncState(),
    listLocalLancamentos({ synced: false })
  ]);

  return {
    pendingCount,
    syncState,
    pendingRecords
  };
}

async function safeParseJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function syncLancamentosNow(): Promise<SyncNowResult> {
  const pending = await listLocalLancamentos({ synced: false });
  const pendingBefore = pending.length;

  if (pendingBefore === 0) {
    const now = new Date().toISOString();
    await setSyncState({
      last_sync_at: now,
      last_sync_status: "success",
      last_sync_error: null
    });
    return {
      syncedCount: 0,
      pendingBefore: 0,
      pendingAfter: 0,
      syncedIds: []
    };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    await setSyncState({
      last_sync_status: "error",
      last_sync_error: "Sem conexao com a internet"
    });
    throw new Error("Sem conexao com a internet");
  }

  await setSyncState({
    last_sync_status: "syncing",
    last_sync_error: null
  });

  try {
    const deduped = dedupeRecordsById(pending);
    const payload = deduped.map((record) => ({
      ...record.payload,
      id: record.id,
      created_at: record.payload.created_at ?? record.created_at,
      updated_at: record.payload.updated_at ?? record.updated_at
    }));

    const response = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lancamentos: payload })
    });

    const json = await safeParseJson(response);
    if (!response.ok) {
      const message =
        (json && typeof json === "object" && "message" in json && typeof json.message === "string"
          ? json.message
          : null) ?? "Falha ao enviar lote para sincronizacao";
      throw new Error(message);
    }

    const syncedIds =
      json && typeof json === "object" && Array.isArray((json as { synced_ids?: string[] }).synced_ids)
        ? ((json as { synced_ids: string[] }).synced_ids ?? [])
        : payload.map((item) => item.id);

    await markLancamentosAsSynced(syncedIds);

    const now = new Date().toISOString();
    await setSyncState({
      last_sync_at: now,
      last_sync_status: "success",
      last_sync_error: null
    });

    const pendingAfter = await countPendingLancamentos();

    return {
      syncedCount: syncedIds.length,
      pendingBefore,
      pendingAfter,
      syncedIds
    };
  } catch (error) {
    await setSyncState({
      last_sync_status: "error",
      last_sync_error: normalizeErrorMessage(error)
    });
    throw error;
  }
}
