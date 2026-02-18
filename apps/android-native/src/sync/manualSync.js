import { postJson } from "../api/backend";
import {
  addSyncLog,
  listPendingSyncOps,
  removeSyncOpsByIds,
  setSyncState
} from "../db/store";
import { nowIso } from "../utils/time";

function dedupeOps(operations) {
  const byEntityAndId = new Map();
  for (const operation of operations) {
    const key = `${operation.entity}:${operation.entity_id}`;
    byEntityAndId.set(key, operation);
  }
  return [...byEntityAndId.values()];
}

function groupOpsForPush(operations) {
  const grouped = {
    lancamentos_upsert: [],
    lancamentos_delete_ids: [],
    contas_fixas_upsert: [],
    contas_fixas_delete_ids: [],
    calendario_anual_upsert: [],
    calendario_anual_delete_ids: [],
    categorias_upsert: [],
    categorias_delete_ids: [],
    receitas_regras_upsert: [],
    receitas_regras_delete_ids: [],
    cartoes_upsert: [],
    cartoes_delete_ids: [],
    cartao_movimentos_upsert: [],
    cartao_movimentos_delete_ids: []
  };

  for (const operation of operations) {
    const target = `${operation.entity}:${operation.action}`;
    switch (target) {
      case "lancamento:upsert":
        grouped.lancamentos_upsert.push(operation.payload);
        break;
      case "lancamento:delete":
        grouped.lancamentos_delete_ids.push(operation.entity_id);
        break;
      case "conta_fixa:upsert":
        grouped.contas_fixas_upsert.push(operation.payload);
        break;
      case "conta_fixa:delete":
        grouped.contas_fixas_delete_ids.push(operation.entity_id);
        break;
      case "calendario_anual:upsert":
        grouped.calendario_anual_upsert.push(operation.payload);
        break;
      case "calendario_anual:delete":
        grouped.calendario_anual_delete_ids.push(operation.entity_id);
        break;
      case "categoria:upsert":
        grouped.categorias_upsert.push(operation.payload);
        break;
      case "categoria:delete":
        grouped.categorias_delete_ids.push(operation.entity_id);
        break;
      case "receita_regra:upsert":
        grouped.receitas_regras_upsert.push(operation.payload);
        break;
      case "receita_regra:delete":
        grouped.receitas_regras_delete_ids.push(operation.entity_id);
        break;
      case "cartao:upsert":
        grouped.cartoes_upsert.push(operation.payload);
        break;
      case "cartao:delete":
        grouped.cartoes_delete_ids.push(operation.entity_id);
        break;
      case "cartao_movimento:upsert":
        grouped.cartao_movimentos_upsert.push(operation.payload);
        break;
      case "cartao_movimento:delete":
        grouped.cartao_movimentos_delete_ids.push(operation.entity_id);
        break;
      default:
        break;
    }
  }

  return grouped;
}

function hasAnyPushOperation(payload) {
  return Object.values(payload).some((item) => Array.isArray(item) && item.length > 0);
}

function buildPayloadCounts(payload) {
  const counts = {};
  for (const [key, value] of Object.entries(payload)) {
    counts[key] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

export async function syncNow(baseUrl) {
  const pendingRaw = await listPendingSyncOps();
  const pending = dedupeOps(pendingRaw);
  if (pending.length === 0) {
    await addSyncLog({
      level: "info",
      event: "sync_skipped",
      message: "Sem operacoes pendentes para sincronizar."
    });
    return {
      pushed: 0,
      remaining: 0,
      synced_ids: []
    };
  }

  const pushPayload = groupOpsForPush(pending);
  if (!hasAnyPushOperation(pushPayload)) {
    await removeSyncOpsByIds(pending.map((item) => item.op_id));
    await addSyncLog({
      level: "warn",
      event: "sync_compacted",
      message: "Fila compactada sem operacoes validas para push.",
      details: { pending: pending.length }
    });
    return {
      pushed: 0,
      remaining: 0,
      synced_ids: []
    };
  }

  await setSyncState({
    last_sync_status: "syncing",
    last_sync_error: null
  });
  await addSyncLog({
    level: "info",
    event: "sync_started",
    message: "Sincronizacao iniciada.",
    details: {
      pending_before_dedupe: pendingRaw.length,
      pending_after_dedupe: pending.length,
      payload_counts: buildPayloadCounts(pushPayload)
    }
  });

  try {
    const response = await postJson(baseUrl, "/api/sync/push", pushPayload);
    await removeSyncOpsByIds(pending.map((item) => item.op_id));
    await setSyncState({
      last_sync_at: nowIso(),
      last_sync_status: "success",
      last_sync_error: null
    });
    await addSyncLog({
      level: "success",
      event: "sync_success",
      message: "Sincronizacao concluida com sucesso.",
      details: {
        pushed: pending.length,
        synced_ids: Array.isArray(response?.synced_ids) ? response.synced_ids.length : 0,
        server: response
      }
    });

    const syncedIds = Array.isArray(response?.synced_ids) ? response.synced_ids : [];
    return {
      pushed: pending.length,
      remaining: 0,
      synced_ids: syncedIds
    };
  } catch (error) {
    await setSyncState({
      last_sync_status: "error",
      last_sync_error: error instanceof Error ? error.message : "Falha no sync"
    });
    await addSyncLog({
      level: "error",
      event: "sync_error",
      message: error instanceof Error ? error.message : "Falha no sync",
      details: {
        pending: pending.length
      }
    });
    throw error;
  }
}
