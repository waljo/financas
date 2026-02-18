"use client";

import type { Lancamento } from "@/lib/types";

const DB_NAME = "financas_mobile_offline";
const DB_VERSION = 2;
const LANCAMENTOS_STORE = "lancamentos_local";
const SYNC_STATE_STORE = "sync_state";
const SYNC_OPS_STORE = "sync_ops";
const GLOBAL_SYNC_STATE_ID = "global";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

export type LocalLancamentoPayload = Omit<Lancamento, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export interface LocalLancamentoRecord {
  id: string;
  payload: LocalLancamentoPayload;
  synced: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncStateRecord {
  id: typeof GLOBAL_SYNC_STATE_ID;
  last_sync_at: string | null;
  last_sync_status: SyncStatus;
  last_sync_error: string | null;
}

export type SyncEntity =
  | "lancamento"
  | "conta_fixa"
  | "calendario_anual"
  | "categoria"
  | "cartao"
  | "cartao_movimento";
export type SyncAction = "upsert" | "delete";

export interface SyncOpRecord {
  op_id: string;
  entity: SyncEntity;
  entity_id: string;
  action: SyncAction;
  payload: unknown | null;
  synced: boolean;
  created_at: string;
  updated_at: string;
}

function assertIndexedDbAvailable() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    throw new Error("IndexedDB indisponivel neste ambiente.");
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Erro na operacao IndexedDB"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Transacao IndexedDB falhou"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Transacao IndexedDB abortada"));
  });
}

function openDb(): Promise<IDBDatabase> {
  assertIndexedDbAvailable();

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LANCAMENTOS_STORE)) {
        const store = db.createObjectStore(LANCAMENTOS_STORE, { keyPath: "id" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }

      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(SYNC_OPS_STORE)) {
        const store = db.createObjectStore(SYNC_OPS_STORE, { keyPath: "op_id" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("entity", "entity", { unique: false });
        store.createIndex("entity_id", "entity_id", { unique: false });
        store.createIndex("entity_entity_id", ["entity", "entity_id"], { unique: false });
        store.createIndex("updated_at", "updated_at", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>
): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);

  try {
    const result = await handler(store, transaction);
    await transactionDone(transaction);
    return result;
  } finally {
    db.close();
  }
}

function defaultSyncState(): SyncStateRecord {
  return {
    id: GLOBAL_SYNC_STATE_ID,
    last_sync_at: null,
    last_sync_status: "idle",
    last_sync_error: null
  };
}

export async function getLocalLancamentoById(id: string): Promise<LocalLancamentoRecord | null> {
  return withStore(LANCAMENTOS_STORE, "readonly", async (store) => {
    const result = await requestToPromise(store.get(id) as IDBRequest<LocalLancamentoRecord | undefined>);
    return result ?? null;
  });
}

export async function saveLocalLancamento(
  payload: LocalLancamentoPayload,
  options?: { synced?: boolean }
): Promise<LocalLancamentoRecord> {
  const now = new Date().toISOString();
  const id = payload.id;
  if (!id) {
    throw new Error("Lancamento local sem id");
  }

  const existing = await getLocalLancamentoById(id);
  const record: LocalLancamentoRecord = {
    id,
    payload: {
      ...payload,
      created_at: payload.created_at ?? existing?.payload.created_at ?? now,
      updated_at: now
    },
    synced: options?.synced ?? existing?.synced ?? false,
    created_at: existing?.created_at ?? now,
    updated_at: now
  };

  return withStore(LANCAMENTOS_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put(record));
    return record;
  });
}

export async function listLocalLancamentos(options?: {
  synced?: boolean;
  month?: string;
}): Promise<LocalLancamentoRecord[]> {
  const records = await withStore(LANCAMENTOS_STORE, "readonly", async (store) => {
    const all = await requestToPromise(store.getAll() as IDBRequest<LocalLancamentoRecord[]>);
    return all;
  });

  return records.filter((record) => {
    if (typeof options?.synced === "boolean" && record.synced !== options.synced) {
      return false;
    }
    if (options?.month && !record.payload.data.startsWith(options.month)) {
      return false;
    }
    return true;
  });
}

export async function countPendingLancamentos(): Promise<number> {
  const pending = await listLocalLancamentos({ synced: false });
  return pending.length;
}

export async function markLancamentosAsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await withStore(LANCAMENTOS_STORE, "readwrite", async (store) => {
    const now = new Date().toISOString();

    for (const id of ids) {
      const current = await requestToPromise(store.get(id) as IDBRequest<LocalLancamentoRecord | undefined>);
      if (!current) continue;

      const next: LocalLancamentoRecord = {
        ...current,
        synced: true,
        updated_at: now,
        payload: {
          ...current.payload,
          updated_at: now
        }
      };

      await requestToPromise(store.put(next));
    }
  });
}

export async function deleteLocalLancamentoById(id: string): Promise<void> {
  await withStore(LANCAMENTOS_STORE, "readwrite", async (store) => {
    await requestToPromise(store.delete(id));
  });
}

export async function getSyncState(): Promise<SyncStateRecord> {
  return withStore(SYNC_STATE_STORE, "readonly", async (store) => {
    const result = await requestToPromise(store.get(GLOBAL_SYNC_STATE_ID) as IDBRequest<SyncStateRecord | undefined>);
    return result ?? defaultSyncState();
  });
}

export async function setSyncState(
  patch: Partial<Omit<SyncStateRecord, "id">>
): Promise<SyncStateRecord> {
  const current = await getSyncState();
  const next: SyncStateRecord = {
    ...current,
    ...patch,
    id: GLOBAL_SYNC_STATE_ID
  };

  return withStore(SYNC_STATE_STORE, "readwrite", async (store) => {
    await requestToPromise(store.put(next));
    return next;
  });
}

export async function listSyncOps(options?: {
  synced?: boolean;
  entity?: SyncEntity;
}): Promise<SyncOpRecord[]> {
  const records = await withStore(SYNC_OPS_STORE, "readonly", async (store) => {
    const all = await requestToPromise(store.getAll() as IDBRequest<SyncOpRecord[]>);
    return all;
  });

  return records
    .filter((record) => {
      if (typeof options?.synced === "boolean" && record.synced !== options.synced) {
        return false;
      }
      if (options?.entity && record.entity !== options.entity) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
}

export async function countPendingSyncOps(entity?: SyncEntity): Promise<number> {
  const pending = await listSyncOps({ synced: false, entity });
  return pending.length;
}

export async function upsertSyncOp(input: {
  op_id: string;
  entity: SyncEntity;
  entity_id: string;
  action: SyncAction;
  payload?: unknown | null;
}): Promise<SyncOpRecord> {
  const now = new Date().toISOString();

  return withStore(SYNC_OPS_STORE, "readwrite", async (store) => {
    const index = store.index("entity_entity_id");
    const existing = (await requestToPromise(
      index.getAll([input.entity, input.entity_id]) as IDBRequest<SyncOpRecord[]>
    )) as SyncOpRecord[];

    const latestPending = existing
      .filter((item) => !item.synced)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

    const targetId = latestPending?.op_id ?? input.op_id;
    const record: SyncOpRecord = {
      op_id: targetId,
      entity: input.entity,
      entity_id: input.entity_id,
      action: input.action,
      payload: input.payload ?? null,
      synced: false,
      created_at: latestPending?.created_at ?? now,
      updated_at: now
    };

    await requestToPromise(store.put(record));
    return record;
  });
}

export async function markSyncOpsAsSynced(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;

  await withStore(SYNC_OPS_STORE, "readwrite", async (store) => {
    const now = new Date().toISOString();
    for (const opId of opIds) {
      const current = await requestToPromise(store.get(opId) as IDBRequest<SyncOpRecord | undefined>);
      if (!current) continue;
      await requestToPromise(
        store.put({
          ...current,
          synced: true,
          updated_at: now
        })
      );
    }
  });
}
