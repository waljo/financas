"use client";

import type {
  Atribuicao,
  CalendarioAnual,
  CartaoCredito,
  CartaoMovimentoComAlocacoes,
  Categoria,
  ContaFixa,
  Lancamento
} from "@/lib/types";
import {
  deleteLocalLancamentoById,
  getSyncState,
  listLocalLancamentos,
  listSyncOps,
  markSyncOpsAsSynced,
  markLancamentosAsSynced,
  saveLocalLancamento,
  setSyncState,
  upsertSyncOp,
  type LocalLancamentoRecord,
  type SyncOpRecord
} from "@/lib/mobileOffline/db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueueLancamentoInput = Omit<Lancamento, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

type ContaFixaQueueInput = Omit<ContaFixa, "id"> & { id?: string };
type CalendarioAnualQueueInput = Omit<CalendarioAnual, "id"> & { id?: string };
type CategoriaQueueInput = Omit<Categoria, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type CartaoQueueInput = Omit<CartaoCredito, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
type CartaoMovimentoQueueInput = Omit<
  CartaoMovimentoComAlocacoes,
  "id" | "cartao" | "alocacoes" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  alocacoes: Array<{
    id?: string;
    atribuicao: Atribuicao;
    valor: number;
    created_at?: string;
    updated_at?: string;
  }>;
};

export interface SyncNowResult {
  syncedCount: number;
  pendingBefore: number;
  pendingAfter: number;
  syncedIds: string[];
  pendingOpsCount: number;
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

function dedupeOpsByEntityId(records: SyncOpRecord[]) {
  const byEntity = new Map<string, SyncOpRecord>();
  for (const record of records) {
    const key = `${record.entity}:${record.entity_id}`;
    const current = byEntity.get(key);
    if (!current || current.updated_at < record.updated_at) {
      byEntity.set(key, record);
    }
  }
  return [...byEntity.values()];
}

function toContaFixaPayload(input: ContaFixaQueueInput, id: string): ContaFixa {
  return {
    ...input,
    id
  };
}

function toCalendarioAnualPayload(input: CalendarioAnualQueueInput, id: string): CalendarioAnual {
  return {
    ...input,
    id
  };
}

function toCategoriaPayload(input: CategoriaQueueInput, id: string): Categoria {
  const now = new Date().toISOString();
  return {
    ...input,
    id,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now
  };
}

function toCartaoPayload(input: CartaoQueueInput, id: string): CartaoCredito {
  const now = new Date().toISOString();
  return {
    ...input,
    id,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now
  };
}

function toCartaoMovimentoPayload(input: CartaoMovimentoQueueInput, id: string): CartaoMovimentoComAlocacoes {
  const now = new Date().toISOString();
  return {
    ...input,
    id,
    cartao: null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    alocacoes: input.alocacoes.map((item) => ({
      id: item.id ?? ensureUuid(),
      movimento_id: id,
      atribuicao: item.atribuicao,
      valor: item.valor,
      created_at: item.created_at ?? now,
      updated_at: item.updated_at ?? now
    }))
  };
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

  const saved = await saveLocalLancamento(payload, { synced: false });
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "lancamento",
    entity_id: saved.id,
    action: "upsert",
    payload: {
      ...saved.payload,
      id: saved.id,
      created_at: saved.payload.created_at ?? saved.created_at,
      updated_at: saved.payload.updated_at ?? saved.updated_at
    }
  });
  return saved;
}

export async function readLancamentosLocaisByMonth(month: string) {
  return listLocalLancamentos({ month });
}

export async function queueLancamentoUpdateLocal(input: Lancamento) {
  const now = new Date().toISOString();
  const payload: Lancamento = {
    ...input,
    updated_at: now,
    created_at: input.created_at || now
  };
  const saved = await saveLocalLancamento(payload, { synced: false });
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "lancamento",
    entity_id: saved.id,
    action: "upsert",
    payload: {
      ...saved.payload,
      id: saved.id,
      created_at: saved.payload.created_at ?? saved.created_at,
      updated_at: saved.payload.updated_at ?? saved.updated_at
    }
  });
  return saved;
}

export async function queueLancamentoDeleteLocal(id: string) {
  await deleteLocalLancamentoById(id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "lancamento",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function queueContaFixaUpsertLocal(input: ContaFixaQueueInput) {
  const id = ensureUuid(input.id);
  const payload = toContaFixaPayload(input, id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "conta_fixa",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function queueContaFixaDeleteLocal(id: string) {
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "conta_fixa",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function queueCalendarioAnualUpsertLocal(input: CalendarioAnualQueueInput) {
  const id = ensureUuid(input.id);
  const payload = toCalendarioAnualPayload(input, id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "calendario_anual",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function queueCalendarioAnualDeleteLocal(id: string) {
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "calendario_anual",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function queueCategoriaUpsertLocal(input: CategoriaQueueInput) {
  const id = ensureUuid(input.id);
  const payload = toCategoriaPayload(input, id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "categoria",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function queueCategoriaDeleteLocal(id: string) {
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "categoria",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function queueCartaoUpsertLocal(input: CartaoQueueInput) {
  const id = ensureUuid(input.id);
  const payload = toCartaoPayload(input, id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "cartao",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function queueCartaoDeleteLocal(id: string) {
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "cartao",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function queueCartaoMovimentoUpsertLocal(input: CartaoMovimentoQueueInput) {
  const id = ensureUuid(input.id);
  const payload = toCartaoMovimentoPayload(input, id);
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "cartao_movimento",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function queueCartaoMovimentoDeleteLocal(id: string) {
  await upsertSyncOp({
    op_id: ensureUuid(),
    entity: "cartao_movimento",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function readSyncDashboard() {
  const [pendingRecords, pendingOps, syncState] = await Promise.all([
    listLocalLancamentos({ synced: false }),
    listSyncOps({ synced: false }),
    getSyncState()
  ]);
  const pendingOpsCount = pendingOps.length;
  const pendingContaFixaOps = pendingOps.filter((item) => item.entity === "conta_fixa").length;
  const pendingCalendarioAnualOps = pendingOps.filter((item) => item.entity === "calendario_anual").length;
  const pendingCategoriaOps = pendingOps.filter((item) => item.entity === "categoria").length;
  const pendingCartaoOps = pendingOps.filter((item) => item.entity === "cartao").length;
  const pendingCartaoMovimentoOps = pendingOps.filter((item) => item.entity === "cartao_movimento").length;
  const pendingLancamentoOpsIds = new Set(
    pendingOps.filter((item) => item.entity === "lancamento").map((item) => item.entity_id)
  );
  const pendingLancamentosWithoutOp = pendingRecords.filter((item) => !pendingLancamentoOpsIds.has(item.id)).length;
  const pendingCount = pendingOpsCount + pendingLancamentosWithoutOp;

  return {
    pendingCount,
    pendingOpsCount,
    pendingContaFixaOps,
    pendingCalendarioAnualOps,
    pendingCategoriaOps,
    pendingCartaoOps,
    pendingCartaoMovimentoOps,
    syncState,
    pendingRecords,
    pendingOps
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
  const [pendingLancamentos, pendingOps] = await Promise.all([
    listLocalLancamentos({ synced: false }),
    listSyncOps({ synced: false })
  ]);
  const lancOpsIds = new Set(
    pendingOps.filter((item) => item.entity === "lancamento").map((item) => item.entity_id)
  );
  const pendingLancamentosWithoutOp = pendingLancamentos.filter((item) => !lancOpsIds.has(item.id));
  const pendingBefore = pendingLancamentosWithoutOp.length + pendingOps.length;

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
      syncedIds: [],
      pendingOpsCount: 0
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
    const dedupedLancamentos = dedupeRecordsById(pendingLancamentos);
    const dedupedOps = dedupeOpsByEntityId(pendingOps);

    const lancamentoOpsById = new Map<
      string,
      { action: "upsert"; payload: Record<string, unknown> } | { action: "delete" }
    >();
    for (const op of dedupedOps) {
      if (op.entity !== "lancamento") continue;
      if (op.action === "delete") {
        lancamentoOpsById.set(op.entity_id, { action: "delete" });
        continue;
      }
      if (!op.payload || typeof op.payload !== "object") continue;
      lancamentoOpsById.set(op.entity_id, { action: "upsert", payload: op.payload as Record<string, unknown> });
    }

    for (const record of dedupedLancamentos) {
      if (lancamentoOpsById.has(record.id)) continue;
      lancamentoOpsById.set(record.id, {
        action: "upsert",
        payload: {
          ...record.payload,
          id: record.id,
          created_at: record.payload.created_at ?? record.created_at,
          updated_at: record.payload.updated_at ?? record.updated_at
        }
      });
    }

    const lancamentosUpsert = [...lancamentoOpsById.values()]
      .filter((item): item is { action: "upsert"; payload: Record<string, unknown> } => item.action === "upsert")
      .map((item) => item.payload);
    const lancamentosDeleteIds = [...lancamentoOpsById.entries()]
      .filter(([, item]) => item.action === "delete")
      .map(([id]) => id);

    const contaOps = dedupedOps.filter((item) => item.entity === "conta_fixa");
    const contasFixasUpsert = contaOps
      .filter((item) => item.action === "upsert" && item.payload && typeof item.payload === "object")
      .map((item) => item.payload as Record<string, unknown>);
    const contasFixasDeleteIds = contaOps.filter((item) => item.action === "delete").map((item) => item.entity_id);
    const calendarioOps = dedupedOps.filter((item) => item.entity === "calendario_anual");
    const calendarioAnualUpsert = calendarioOps
      .filter((item) => item.action === "upsert" && item.payload && typeof item.payload === "object")
      .map((item) => item.payload as Record<string, unknown>);
    const calendarioAnualDeleteIds = calendarioOps
      .filter((item) => item.action === "delete")
      .map((item) => item.entity_id);
    const categoriaOps = dedupedOps.filter((item) => item.entity === "categoria");
    const categoriasUpsert = categoriaOps
      .filter((item) => item.action === "upsert" && item.payload && typeof item.payload === "object")
      .map((item) => item.payload as Record<string, unknown>);
    const categoriasDeleteIds = categoriaOps
      .filter((item) => item.action === "delete")
      .map((item) => item.entity_id);
    const cartaoOps = dedupedOps.filter((item) => item.entity === "cartao");
    const cartoesUpsert = cartaoOps
      .filter((item) => item.action === "upsert" && item.payload && typeof item.payload === "object")
      .map((item) => item.payload as Record<string, unknown>);
    const cartoesDeleteIds = cartaoOps
      .filter((item) => item.action === "delete")
      .map((item) => item.entity_id);
    const cartaoMovimentoOps = dedupedOps.filter((item) => item.entity === "cartao_movimento");
    const cartaoMovimentosUpsert = cartaoMovimentoOps
      .filter((item) => item.action === "upsert" && item.payload && typeof item.payload === "object")
      .map((item) => item.payload as Record<string, unknown>);
    const cartaoMovimentosDeleteIds = cartaoMovimentoOps
      .filter((item) => item.action === "delete")
      .map((item) => item.entity_id);

    const response = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lancamentos_upsert: lancamentosUpsert,
        lancamentos_delete_ids: lancamentosDeleteIds,
        contas_fixas_upsert: contasFixasUpsert,
        contas_fixas_delete_ids: contasFixasDeleteIds,
        calendario_anual_upsert: calendarioAnualUpsert,
        calendario_anual_delete_ids: calendarioAnualDeleteIds,
        categorias_upsert: categoriasUpsert,
        categorias_delete_ids: categoriasDeleteIds,
        cartoes_upsert: cartoesUpsert,
        cartoes_delete_ids: cartoesDeleteIds,
        cartao_movimentos_upsert: cartaoMovimentosUpsert,
        cartao_movimentos_delete_ids: cartaoMovimentosDeleteIds
      })
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
        : lancamentosUpsert
            .map((item) => String(item.id ?? ""))
            .filter(Boolean);

    const lancamentoUpsertIds = new Set(lancamentosUpsert.map((item) => String(item.id ?? "")).filter(Boolean));
    const lancamentoSyncedIds = syncedIds.filter((id) => lancamentoUpsertIds.has(id));

    if (lancamentoSyncedIds.length > 0) {
      await markLancamentosAsSynced(lancamentoSyncedIds);
    }
    for (const id of lancamentosDeleteIds) {
      await deleteLocalLancamentoById(id);
    }
    await markSyncOpsAsSynced(pendingOps.map((item) => item.op_id));

    const now = new Date().toISOString();
    await setSyncState({
      last_sync_at: now,
      last_sync_status: "success",
      last_sync_error: null
    });

    const snapshotAfter = await readSyncDashboard();
    const pendingAfter = snapshotAfter.pendingCount;

    return {
      syncedCount:
        lancamentoSyncedIds.length +
        lancamentosDeleteIds.length +
        contaOps.length +
        calendarioOps.length +
        categoriaOps.length +
        cartaoOps.length +
        cartaoMovimentoOps.length,
      pendingBefore,
      pendingAfter,
      syncedIds: [
        ...lancamentoSyncedIds,
        ...lancamentosDeleteIds,
        ...contaOps.map((item) => item.entity_id),
        ...calendarioOps.map((item) => item.entity_id),
        ...categoriaOps.map((item) => item.entity_id),
        ...cartaoOps.map((item) => item.entity_id),
        ...cartaoMovimentoOps.map((item) => item.entity_id)
      ],
      pendingOpsCount: snapshotAfter.pendingOpsCount
    };
  } catch (error) {
    await setSyncState({
      last_sync_status: "error",
      last_sync_error: normalizeErrorMessage(error)
    });
    throw error;
  }
}
