import * as SQLite from "expo-sqlite";
import { nowIso } from "../utils/time";
import { createUuid } from "../utils/uuid";

const db = SQLite.openDatabaseSync("financas_native.db");
const GLOBAL_SYNC_STATE_ID = "global";

const ENTITY_ID_KEYS = {
  lancamentos: "id",
  contas_fixas: "id",
  calendario_anual: "id",
  receitas_regras: "chave",
  categorias: "id",
  cartoes: "id",
  cartao_movimentos: "id"
};

const VALID_BANCOS = ["C6", "BB", "OUTRO"];
const VALID_TITULARES = ["WALKER", "DEA", "JULIA", "OUTRO"];
const VALID_ATRIBUICOES = ["WALKER", "DEA", "AMBOS", "AMBOS_I"];
const VALID_METODOS = ["pix", "cartao", "dinheiro", "transferencia", "outro"];
const VALID_PESSOA_PAGADORA = ["WALKER", "DEA"];

function toLegacyRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    length: safeRows.length,
    item(index) {
      return safeRows[index];
    },
    _array: safeRows
  };
}

async function runSql(sql, params = []) {
  const statement = String(sql ?? "").trim().toUpperCase();
  const binds = Array.isArray(params) ? params : [params];

  if (statement.startsWith("SELECT") || statement.startsWith("WITH")) {
    const rows = await db.getAllAsync(sql, binds);
    return {
      rows: toLegacyRows(rows),
      rowsAffected: 0,
      insertId: undefined
    };
  }

  const result = await db.runAsync(sql, binds);
  return {
    rows: toLegacyRows([]),
    rowsAffected: Number(result?.changes ?? 0),
    insertId: result?.lastInsertRowId
  };
}

function parseJsonSafe(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function extractItemId(entity, item, index) {
  const key = ENTITY_ID_KEYS[entity];
  const raw = key ? item?.[key] : null;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return `${entity}:${index + 1}`;
}

function extractUpdatedAt(item) {
  if (typeof item?.updated_at === "string" && item.updated_at.trim()) return item.updated_at;
  return nowIso();
}

function normalizeEnum(value, allowed, fallback) {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (allowed.includes(text)) return text;
  return fallback;
}

function normalizeMetodo(value, fallback = "outro") {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (VALID_METODOS.includes(text)) return text;
  return fallback;
}

function normalizeDateInput(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error("Data invalida. Use YYYY-MM-DD.");
  }
  return text;
}

function ymFromDate(value) {
  return normalizeDateInput(value).slice(0, 7);
}

function normalizeDescricaoForTx(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function buildCartaoTxKey(input) {
  const total = Number.isInteger(input.parcela_total) && input.parcela_total > 1 ? input.parcela_total : 1;
  const numero = Number.isInteger(input.parcela_numero) && input.parcela_numero > 0 ? input.parcela_numero : 1;
  return [
    input.cartao_id,
    input.data,
    normalizeDescricaoForTx(input.descricao),
    Number(input.valor).toFixed(2),
    `${numero}/${total}`
  ].join("|");
}

export async function initDb() {
  await runSql(
    `CREATE TABLE IF NOT EXISTS entity_rows (
      entity TEXT NOT NULL,
      item_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (entity, item_id)
    )`
  );
  await runSql(
    `CREATE TABLE IF NOT EXISTS sync_ops (
      op_id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    )`
  );
  await runSql(
    `CREATE TABLE IF NOT EXISTS sync_state (
      id TEXT PRIMARY KEY,
      last_sync_at TEXT,
      last_sync_status TEXT NOT NULL,
      last_sync_error TEXT,
      updated_at TEXT NOT NULL
    )`
  );
  await runSql(
    `CREATE TABLE IF NOT EXISTS sync_logs (
      log_id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    )`
  );
}

export async function getSyncState() {
  const result = await runSql("SELECT * FROM sync_state WHERE id = ? LIMIT 1", [GLOBAL_SYNC_STATE_ID]);
  if (result.rows.length === 0) {
    return {
      id: GLOBAL_SYNC_STATE_ID,
      last_sync_at: null,
      last_sync_status: "idle",
      last_sync_error: null
    };
  }
  return result.rows.item(0);
}

export async function setSyncState(patch) {
  const current = await getSyncState();
  const next = {
    id: GLOBAL_SYNC_STATE_ID,
    last_sync_at:
      Object.prototype.hasOwnProperty.call(patch, "last_sync_at") ? patch.last_sync_at : current.last_sync_at,
    last_sync_status:
      Object.prototype.hasOwnProperty.call(patch, "last_sync_status")
        ? patch.last_sync_status
        : current.last_sync_status,
    last_sync_error:
      Object.prototype.hasOwnProperty.call(patch, "last_sync_error")
        ? patch.last_sync_error
        : current.last_sync_error,
    updated_at: nowIso()
  };

  await runSql(
    `INSERT OR REPLACE INTO sync_state
     (id, last_sync_at, last_sync_status, last_sync_error, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [next.id, next.last_sync_at, next.last_sync_status, next.last_sync_error, next.updated_at]
  );
  return next;
}

export async function addSyncLog(input) {
  const log = {
    log_id: input.log_id ?? createUuid(),
    level: String(input.level ?? "info").trim() || "info",
    event: String(input.event ?? "sync_event").trim() || "sync_event",
    message: String(input.message ?? "").trim() || "Sem detalhes",
    details: input.details ?? null,
    created_at: input.created_at ?? nowIso()
  };

  await runSql(
    `INSERT OR REPLACE INTO sync_logs (log_id, level, event, message, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      log.log_id,
      log.level,
      log.event,
      log.message,
      log.details === null ? null : JSON.stringify(log.details),
      log.created_at
    ]
  );
  return log;
}

export async function listSyncLogs(options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 80;
  const result = await runSql(
    `SELECT log_id, level, event, message, details, created_at
     FROM sync_logs
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
  const rows = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows.item(index);
    rows.push({
      ...row,
      details: parseJsonSafe(row.details, null)
    });
  }
  return rows;
}

export async function clearSyncLogs() {
  await runSql("DELETE FROM sync_logs");
}

export async function replaceEntityRows(entity, rows) {
  await runSql("DELETE FROM entity_rows WHERE entity = ?", [entity]);
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const itemId = extractItemId(entity, row, index);
    await runSql(
      `INSERT OR REPLACE INTO entity_rows (entity, item_id, payload, updated_at)
       VALUES (?, ?, ?, ?)`,
      [entity, itemId, JSON.stringify(row), extractUpdatedAt(row)]
    );
  }
}

export async function upsertEntityRow(entity, item, explicitItemId) {
  const itemId = explicitItemId || extractItemId(entity, item, 0);
  await runSql(
    `INSERT OR REPLACE INTO entity_rows (entity, item_id, payload, updated_at)
     VALUES (?, ?, ?, ?)`,
    [entity, itemId, JSON.stringify(item), extractUpdatedAt(item)]
  );
}

export async function removeEntityRow(entity, itemId) {
  await runSql("DELETE FROM entity_rows WHERE entity = ? AND item_id = ?", [entity, itemId]);
}

export async function listEntityRows(entity, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : null;
  const query = limit
    ? `SELECT item_id, payload, updated_at
       FROM entity_rows
       WHERE entity = ?
       ORDER BY updated_at DESC
       LIMIT ?`
    : `SELECT item_id, payload, updated_at
       FROM entity_rows
       WHERE entity = ?
       ORDER BY updated_at DESC`;
  const result = await runSql(query, limit ? [entity, limit] : [entity]);
  const rows = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows.item(index);
    rows.push(parseJsonSafe(row.payload, { id: row.item_id }));
  }
  return rows;
}

export async function getEntityRowById(entity, itemId) {
  const result = await runSql(
    `SELECT item_id, payload, updated_at
     FROM entity_rows
     WHERE entity = ? AND item_id = ?
     LIMIT 1`,
    [entity, itemId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows.item(0);
  return parseJsonSafe(row.payload, { id: row.item_id });
}

export async function replaceFromBootstrapData(data) {
  const entries = [
    ["lancamentos", data.lancamentos ?? []],
    ["contas_fixas", data.contas_fixas ?? []],
    ["calendario_anual", data.calendario_anual ?? []],
    ["receitas_regras", data.receitas_regras ?? []],
    ["categorias", data.categorias ?? []],
    ["cartoes", data.cartoes ?? []],
    ["cartao_movimentos", data.cartao_movimentos ?? []]
  ];

  for (const [entity, rows] of entries) {
    await replaceEntityRows(entity, rows);
  }
}

export async function getEntityCounts() {
  const result = await runSql(
    `SELECT entity, COUNT(*) as total
     FROM entity_rows
     GROUP BY entity`
  );
  const counts = {};
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows.item(index);
    counts[row.entity] = Number(row.total ?? 0);
  }
  return counts;
}

export async function queueSyncOp(input) {
  const operation = {
    op_id: input.op_id ?? createUuid(),
    entity: input.entity,
    entity_id: input.entity_id,
    action: input.action,
    payload: input.payload ?? null,
    created_at: input.created_at ?? nowIso()
  };

  await runSql(
    `INSERT OR REPLACE INTO sync_ops (op_id, entity, entity_id, action, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      operation.op_id,
      operation.entity,
      operation.entity_id,
      operation.action,
      operation.payload === null ? null : JSON.stringify(operation.payload),
      operation.created_at
    ]
  );
  return operation;
}

export async function listPendingSyncOps() {
  const result = await runSql(
    `SELECT op_id, entity, entity_id, action, payload, created_at
     FROM sync_ops
     ORDER BY created_at ASC`
  );
  const rows = [];
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows.item(index);
    rows.push({
      ...row,
      payload: parseJsonSafe(row.payload, null)
    });
  }
  return rows;
}

export async function removeSyncOpsByIds(opIds) {
  for (const opId of opIds) {
    await runSql("DELETE FROM sync_ops WHERE op_id = ?", [opId]);
  }
}

export async function getPendingOpsCount() {
  const result = await runSql("SELECT COUNT(*) as total FROM sync_ops");
  if (result.rows.length === 0) return 0;
  return Number(result.rows.item(0).total ?? 0);
}

export async function getLocalSummary() {
  const [counts, pendingOps, syncState] = await Promise.all([
    getEntityCounts(),
    getPendingOpsCount(),
    getSyncState()
  ]);
  return {
    counts,
    pending_ops: pendingOps,
    sync_state: syncState
  };
}

function normalizeMoneyInput(value) {
  const text = String(value ?? "")
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Valor invalido.");
  }
  return Number(parsed.toFixed(2));
}

function normalizeMoneyNonNegativeInput(value) {
  const text = String(value ?? "")
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Valor estimado invalido.");
  }
  return Number(parsed.toFixed(2));
}

function normalizeSlug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeOptionalOrder(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Ordem de categoria invalida.");
  }
  return parsed;
}

export async function createLancamentoLocal(input) {
  const id = createUuid();
  const now = nowIso();
  const payload = {
    id,
    data: input.data,
    tipo: input.tipo ?? "despesa",
    descricao: String(input.descricao ?? "").trim(),
    categoria: String(input.categoria ?? "").trim() || "SEM_CATEGORIA",
    valor: normalizeMoneyInput(input.valor),
    atribuicao: normalizeEnum(input.atribuicao, VALID_ATRIBUICOES, "WALKER"),
    metodo: normalizeMetodo(input.metodo, "pix"),
    parcela_total: null,
    parcela_numero: null,
    observacao: String(input.observacao ?? "").trim(),
    quem_pagou: normalizeEnum(input.quem_pagou, VALID_PESSOA_PAGADORA, "WALKER"),
    created_at: now,
    updated_at: now
  };

  if (!payload.data || !payload.descricao) {
    throw new Error("Data e descricao sao obrigatorias.");
  }

  await upsertEntityRow("lancamentos", payload, id);
  await queueSyncOp({
    entity: "lancamento",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateLancamentoLocal(id, input) {
  const current = await getEntityRowById("lancamentos", id);
  if (!current) {
    throw new Error("Lancamento nao encontrado.");
  }

  const now = nowIso();
  const payload = {
    ...current,
    id,
    data: String(input.data ?? current.data ?? "").trim(),
    tipo: input.tipo ?? current.tipo ?? "despesa",
    descricao: String(input.descricao ?? current.descricao ?? "").trim(),
    categoria: String(input.categoria ?? current.categoria ?? "").trim() || "SEM_CATEGORIA",
    valor: Object.prototype.hasOwnProperty.call(input, "valor")
      ? normalizeMoneyInput(input.valor)
      : Number(current.valor ?? 0),
    atribuicao: normalizeEnum(input.atribuicao ?? current.atribuicao, VALID_ATRIBUICOES, "WALKER"),
    metodo: normalizeMetodo(input.metodo ?? current.metodo, "outro"),
    observacao: String(input.observacao ?? current.observacao ?? "").trim(),
    quem_pagou: normalizeEnum(input.quem_pagou ?? current.quem_pagou, VALID_PESSOA_PAGADORA, "WALKER"),
    created_at: current.created_at ?? now,
    updated_at: now
  };

  if (!payload.data || !payload.descricao) {
    throw new Error("Data e descricao sao obrigatorias.");
  }

  await upsertEntityRow("lancamentos", payload, id);
  await queueSyncOp({
    entity: "lancamento",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function deleteLancamentoLocal(id) {
  await removeEntityRow("lancamentos", id);
  await queueSyncOp({
    entity: "lancamento",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function createCategoriaLocal(input) {
  const id = createUuid();
  const now = nowIso();
  const nome = String(input.nome ?? "").trim();
  if (!nome) {
    throw new Error("Nome da categoria e obrigatorio.");
  }

  const slugBase = String(input.slug ?? "").trim() || nome;
  const slug = normalizeSlug(slugBase) || normalizeSlug(nome) || "sem-categoria";
  const payload = {
    id,
    nome,
    slug,
    ativa: input.ativa !== false,
    ordem: normalizeOptionalOrder(input.ordem),
    cor: String(input.cor ?? "").trim(),
    created_at: now,
    updated_at: now
  };

  await upsertEntityRow("categorias", payload, id);
  await queueSyncOp({
    entity: "categoria",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateCategoriaLocal(id, input) {
  const current = await getEntityRowById("categorias", id);
  if (!current) {
    throw new Error("Categoria nao encontrada.");
  }
  const now = nowIso();
  const nome = String(input.nome ?? current.nome ?? "").trim();
  if (!nome) {
    throw new Error("Nome da categoria e obrigatorio.");
  }
  const slugBase = String(input.slug ?? current.slug ?? nome).trim() || nome;
  const payload = {
    ...current,
    id,
    nome,
    slug: normalizeSlug(slugBase) || normalizeSlug(nome) || "sem-categoria",
    ativa: Object.prototype.hasOwnProperty.call(input, "ativa") ? input.ativa !== false : current.ativa !== false,
    ordem: Object.prototype.hasOwnProperty.call(input, "ordem")
      ? normalizeOptionalOrder(input.ordem)
      : current.ordem ?? null,
    cor: String(input.cor ?? current.cor ?? "").trim(),
    created_at: current.created_at ?? now,
    updated_at: now
  };

  await upsertEntityRow("categorias", payload, id);
  await queueSyncOp({
    entity: "categoria",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function deleteCategoriaLocal(id) {
  await removeEntityRow("categorias", id);
  await queueSyncOp({
    entity: "categoria",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function createReceitaRegraLocal(input) {
  const chave = String(input.chave ?? "").trim();
  if (!chave) {
    throw new Error("Chave da regra de receita e obrigatoria.");
  }
  const payload = {
    chave,
    valor: String(input.valor ?? "").trim()
  };

  await upsertEntityRow("receitas_regras", payload, chave);
  await queueSyncOp({
    entity: "receita_regra",
    entity_id: chave,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateReceitaRegraLocal(currentChave, input) {
  const oldChave = String(currentChave ?? "").trim();
  if (!oldChave) {
    throw new Error("Chave da regra de receita e obrigatoria.");
  }
  const old = await getEntityRowById("receitas_regras", oldChave);
  if (!old) {
    throw new Error("Regra de receita nao encontrada.");
  }

  const nextChave = String(input.chave ?? old.chave ?? oldChave).trim();
  if (!nextChave) {
    throw new Error("Chave da regra de receita e obrigatoria.");
  }
  const next = {
    chave: nextChave,
    valor: String(input.valor ?? old.valor ?? "").trim()
  };

  if (nextChave !== oldChave) {
    await removeEntityRow("receitas_regras", oldChave);
    await queueSyncOp({
      entity: "receita_regra",
      entity_id: oldChave,
      action: "delete",
      payload: null
    });
  }

  await upsertEntityRow("receitas_regras", next, nextChave);
  await queueSyncOp({
    entity: "receita_regra",
    entity_id: nextChave,
    action: "upsert",
    payload: next
  });
  return next;
}

export async function deleteReceitaRegraLocal(chave) {
  const safeChave = String(chave ?? "").trim();
  if (!safeChave) return;
  await removeEntityRow("receitas_regras", safeChave);
  await queueSyncOp({
    entity: "receita_regra",
    entity_id: safeChave,
    action: "delete",
    payload: null
  });
}

function normalizeDayOfMonth(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    throw new Error("Dia de vencimento invalido.");
  }
  return parsed;
}

function normalizeMonth(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new Error("Mes invalido.");
  }
  return parsed;
}

function normalizeOptionalDayOfMonth(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return normalizeDayOfMonth(text);
}

export async function createContaFixaLocal(input) {
  const id = createUuid();
  const payload = {
    id,
    nome: String(input.nome ?? "").trim(),
    dia_vencimento: normalizeDayOfMonth(input.dia_vencimento),
    valor_previsto:
      String(input.valor_previsto ?? "").trim() === "" ? null : normalizeMoneyInput(input.valor_previsto),
    atribuicao: normalizeEnum(input.atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    quem_pagou: normalizeEnum(input.quem_pagou, VALID_PESSOA_PAGADORA, "WALKER"),
    categoria: String(input.categoria ?? "").trim() || "SEM_CATEGORIA",
    avisar_dias_antes: String(input.avisar_dias_antes ?? "").trim() || "5,2",
    ativo: input.ativo !== false
  };

  if (!payload.nome) {
    throw new Error("Nome da conta fixa e obrigatorio.");
  }

  await upsertEntityRow("contas_fixas", payload, id);
  await queueSyncOp({
    entity: "conta_fixa",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateContaFixaLocal(id, input) {
  const current = await getEntityRowById("contas_fixas", id);
  if (!current) {
    throw new Error("Conta fixa nao encontrada.");
  }
  const payload = {
    ...current,
    id,
    nome: String(input.nome ?? current.nome ?? "").trim(),
    dia_vencimento: Object.prototype.hasOwnProperty.call(input, "dia_vencimento")
      ? normalizeDayOfMonth(input.dia_vencimento)
      : normalizeDayOfMonth(current.dia_vencimento),
    valor_previsto: Object.prototype.hasOwnProperty.call(input, "valor_previsto")
      ? String(input.valor_previsto ?? "").trim() === ""
        ? null
        : normalizeMoneyInput(input.valor_previsto)
      : current.valor_previsto ?? null,
    atribuicao: normalizeEnum(input.atribuicao ?? current.atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    quem_pagou: normalizeEnum(input.quem_pagou ?? current.quem_pagou, VALID_PESSOA_PAGADORA, "WALKER"),
    categoria: String(input.categoria ?? current.categoria ?? "").trim() || "SEM_CATEGORIA",
    avisar_dias_antes: String(input.avisar_dias_antes ?? current.avisar_dias_antes ?? "").trim() || "5,2",
    ativo: Object.prototype.hasOwnProperty.call(input, "ativo") ? input.ativo !== false : current.ativo !== false
  };
  if (!payload.nome) {
    throw new Error("Nome da conta fixa e obrigatorio.");
  }

  await upsertEntityRow("contas_fixas", payload, id);
  await queueSyncOp({
    entity: "conta_fixa",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function deleteContaFixaLocal(id) {
  await removeEntityRow("contas_fixas", id);
  await queueSyncOp({
    entity: "conta_fixa",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function createCalendarioAnualLocal(input) {
  const id = createUuid();
  const payload = {
    id,
    mes: normalizeMonth(input.mes),
    evento: String(input.evento ?? "").trim(),
    valor_estimado: normalizeMoneyNonNegativeInput(input.valor_estimado),
    avisar_dias_antes: String(input.avisar_dias_antes ?? "").trim() || "10,5,2",
    atribuicao: normalizeEnum(input.atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    categoria: String(input.categoria ?? "").trim() || "SEM_CATEGORIA",
    observacao: String(input.observacao ?? "").trim(),
    dia_mes: normalizeOptionalDayOfMonth(input.dia_mes)
  };

  if (!payload.evento) {
    throw new Error("Evento do calendario e obrigatorio.");
  }

  await upsertEntityRow("calendario_anual", payload, id);
  await queueSyncOp({
    entity: "calendario_anual",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateCalendarioAnualLocal(id, input) {
  const current = await getEntityRowById("calendario_anual", id);
  if (!current) {
    throw new Error("Evento sazonal nao encontrado.");
  }
  const payload = {
    ...current,
    id,
    mes: Object.prototype.hasOwnProperty.call(input, "mes") ? normalizeMonth(input.mes) : normalizeMonth(current.mes),
    evento: String(input.evento ?? current.evento ?? "").trim(),
    valor_estimado: Object.prototype.hasOwnProperty.call(input, "valor_estimado")
      ? normalizeMoneyNonNegativeInput(input.valor_estimado)
      : Number(current.valor_estimado ?? 0),
    avisar_dias_antes: String(input.avisar_dias_antes ?? current.avisar_dias_antes ?? "").trim() || "10,5,2",
    atribuicao: normalizeEnum(input.atribuicao ?? current.atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    categoria: String(input.categoria ?? current.categoria ?? "").trim() || "SEM_CATEGORIA",
    observacao: String(input.observacao ?? current.observacao ?? "").trim(),
    dia_mes: Object.prototype.hasOwnProperty.call(input, "dia_mes")
      ? normalizeOptionalDayOfMonth(input.dia_mes)
      : current.dia_mes ?? null
  };
  if (!payload.evento) {
    throw new Error("Evento do calendario e obrigatorio.");
  }

  await upsertEntityRow("calendario_anual", payload, id);
  await queueSyncOp({
    entity: "calendario_anual",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function deleteCalendarioAnualLocal(id) {
  await removeEntityRow("calendario_anual", id);
  await queueSyncOp({
    entity: "calendario_anual",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function createCartaoLocal(input) {
  const id = createUuid();
  const now = nowIso();
  const payload = {
    id,
    nome: String(input.nome ?? "").trim(),
    banco: normalizeEnum(input.banco, VALID_BANCOS, "C6"),
    titular: normalizeEnum(input.titular, VALID_TITULARES, "WALKER"),
    final_cartao: String(input.final_cartao ?? "").trim(),
    padrao_atribuicao: normalizeEnum(input.padrao_atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    ativo: true,
    created_at: now,
    updated_at: now
  };
  if (!payload.nome) {
    throw new Error("Nome do cartao e obrigatorio.");
  }

  await upsertEntityRow("cartoes", payload, id);
  await queueSyncOp({
    entity: "cartao",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateCartaoLocal(id, input) {
  const current = await getEntityRowById("cartoes", id);
  if (!current) {
    throw new Error("Cartao nao encontrado.");
  }
  const now = nowIso();
  const payload = {
    ...current,
    id,
    nome: String(input.nome ?? current.nome ?? "").trim(),
    banco: normalizeEnum(input.banco ?? current.banco, VALID_BANCOS, "C6"),
    titular: normalizeEnum(input.titular ?? current.titular, VALID_TITULARES, "WALKER"),
    final_cartao: String(input.final_cartao ?? current.final_cartao ?? "").trim(),
    padrao_atribuicao: normalizeEnum(input.padrao_atribuicao ?? current.padrao_atribuicao, VALID_ATRIBUICOES, "AMBOS"),
    ativo: Object.prototype.hasOwnProperty.call(input, "ativo") ? input.ativo !== false : current.ativo !== false,
    created_at: current.created_at ?? now,
    updated_at: now
  };
  if (!payload.nome) {
    throw new Error("Nome do cartao e obrigatorio.");
  }

  await upsertEntityRow("cartoes", payload, id);
  await queueSyncOp({
    entity: "cartao",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function deleteCartaoLocal(id) {
  const movimentos = await listEntityRows("cartao_movimentos");
  const relacionados = movimentos.filter((item) => item.cartao_id === id);
  for (const movimento of relacionados) {
    await removeEntityRow("cartao_movimentos", movimento.id);
    await queueSyncOp({
      entity: "cartao_movimento",
      entity_id: movimento.id,
      action: "delete",
      payload: null
    });
  }

  await removeEntityRow("cartoes", id);
  await queueSyncOp({
    entity: "cartao",
    entity_id: id,
    action: "delete",
    payload: null
  });
}

export async function createCartaoMovimentoLocal(input) {
  const cardId = String(input.cartao_id ?? "").trim();
  if (!cardId) {
    throw new Error("Selecione um cartao.");
  }
  const cartao = await getEntityRowById("cartoes", cardId);
  if (!cartao) {
    throw new Error("Cartao nao encontrado localmente.");
  }

  const id = createUuid();
  const now = nowIso();
  const data = normalizeDateInput(input.data);
  const descricao = String(input.descricao ?? "").trim();
  if (!descricao) {
    throw new Error("Descricao da compra e obrigatoria.");
  }
  const valor = normalizeMoneyInput(input.valor);
  const atribuicao = normalizeEnum(input.atribuicao, VALID_ATRIBUICOES, "AMBOS");
  const parcelaTotalRaw = Number(input.parcela_total ?? 0);
  const parcelaNumeroRaw = Number(input.parcela_numero ?? 0);
  const parcela_total =
    Number.isInteger(parcelaTotalRaw) && parcelaTotalRaw > 1 ? parcelaTotalRaw : null;
  const parcela_numero =
    Number.isInteger(parcelaNumeroRaw) && parcelaNumeroRaw > 0 ? parcelaNumeroRaw : null;

  const payload = {
    id,
    cartao_id: cardId,
    data,
    descricao,
    valor,
    parcela_total,
    parcela_numero,
    tx_key: buildCartaoTxKey({
      cartao_id: cardId,
      data,
      descricao,
      valor,
      parcela_total,
      parcela_numero
    }),
    origem: "manual",
    status: "pendente",
    mes_ref: ymFromDate(data),
    observacao: String(input.observacao ?? "").trim(),
    created_at: now,
    updated_at: now,
    alocacoes: [
      {
        id: createUuid(),
        movimento_id: id,
        atribuicao,
        valor,
        created_at: now,
        updated_at: now
      }
    ]
  };

  await upsertEntityRow("cartao_movimentos", payload, id);
  await queueSyncOp({
    entity: "cartao_movimento",
    entity_id: id,
    action: "upsert",
    payload
  });
  return payload;
}

export async function updateCartaoMovimentoLocal(movimentoId, input) {
  const current = await getEntityRowById("cartao_movimentos", movimentoId);
  if (!current) {
    throw new Error("Movimento de cartao nao encontrado.");
  }

  const cartaoId = String(input.cartao_id ?? current.cartao_id ?? "").trim();
  if (!cartaoId) {
    throw new Error("Selecione um cartao.");
  }
  const cartao = await getEntityRowById("cartoes", cartaoId);
  if (!cartao) {
    throw new Error("Cartao nao encontrado localmente.");
  }

  const now = nowIso();
  const data = Object.prototype.hasOwnProperty.call(input, "data")
    ? normalizeDateInput(input.data)
    : normalizeDateInput(current.data);
  const descricao = String(input.descricao ?? current.descricao ?? "").trim();
  if (!descricao) {
    throw new Error("Descricao da compra e obrigatoria.");
  }
  const valor = Object.prototype.hasOwnProperty.call(input, "valor")
    ? normalizeMoneyInput(input.valor)
    : normalizeMoneyInput(current.valor);
  const atribuicao = normalizeEnum(
    input.atribuicao ?? current.alocacoes?.[0]?.atribuicao ?? "AMBOS",
    VALID_ATRIBUICOES,
    "AMBOS"
  );
  const parcelaTotalRaw = Object.prototype.hasOwnProperty.call(input, "parcela_total")
    ? Number(input.parcela_total ?? 0)
    : Number(current.parcela_total ?? 0);
  const parcelaNumeroRaw = Object.prototype.hasOwnProperty.call(input, "parcela_numero")
    ? Number(input.parcela_numero ?? 0)
    : Number(current.parcela_numero ?? 0);
  const parcela_total =
    Number.isInteger(parcelaTotalRaw) && parcelaTotalRaw > 1 ? parcelaTotalRaw : null;
  const parcela_numero =
    Number.isInteger(parcelaNumeroRaw) && parcelaNumeroRaw > 0 ? parcelaNumeroRaw : null;

  const next = {
    ...current,
    id: movimentoId,
    cartao_id: cartaoId,
    data,
    descricao,
    valor,
    parcela_total,
    parcela_numero,
    tx_key: buildCartaoTxKey({
      cartao_id: cartaoId,
      data,
      descricao,
      valor,
      parcela_total,
      parcela_numero
    }),
    origem: input.origem ?? current.origem ?? "manual",
    status: input.status ?? current.status ?? "pendente",
    mes_ref: ymFromDate(data),
    observacao: String(input.observacao ?? current.observacao ?? "").trim(),
    created_at: current.created_at ?? now,
    updated_at: now,
    alocacoes: [
      {
        id: current.alocacoes?.[0]?.id ?? createUuid(),
        movimento_id: movimentoId,
        atribuicao,
        valor,
        created_at: current.alocacoes?.[0]?.created_at ?? now,
        updated_at: now
      }
    ]
  };

  await upsertEntityRow("cartao_movimentos", next, movimentoId);
  await queueSyncOp({
    entity: "cartao_movimento",
    entity_id: movimentoId,
    action: "upsert",
    payload: next
  });
  return next;
}

export async function classifyCartaoMovimentoLocal(movimentoId, atribuicao) {
  const current = await getEntityRowById("cartao_movimentos", movimentoId);
  if (!current) {
    throw new Error("Movimento de cartao nao encontrado.");
  }

  const now = nowIso();
  const safeAtribuicao = normalizeEnum(atribuicao, VALID_ATRIBUICOES, "AMBOS");
  const next = {
    ...current,
    status: "conciliado",
    updated_at: now,
    alocacoes: [
      {
        id: current.alocacoes?.[0]?.id ?? createUuid(),
        movimento_id: current.id,
        atribuicao: safeAtribuicao,
        valor: Number(current.valor ?? 0),
        created_at: current.alocacoes?.[0]?.created_at ?? now,
        updated_at: now
      }
    ]
  };

  await upsertEntityRow("cartao_movimentos", next, next.id);
  await queueSyncOp({
    entity: "cartao_movimento",
    entity_id: next.id,
    action: "upsert",
    payload: next
  });
  return next;
}

export async function deleteCartaoMovimentoLocal(movimentoId) {
  await removeEntityRow("cartao_movimentos", movimentoId);
  await queueSyncOp({
    entity: "cartao_movimento",
    entity_id: movimentoId,
    action: "delete",
    payload: null
  });
}

export function listBancoOptions() {
  return [...VALID_BANCOS];
}

export function listTitularOptions() {
  return [...VALID_TITULARES];
}

export function listAtribuicaoOptions() {
  return [...VALID_ATRIBUICOES];
}

export function listMetodoOptions() {
  return [...VALID_METODOS];
}

export function listPessoaPagadoraOptions() {
  return [...VALID_PESSOA_PAGADORA];
}
