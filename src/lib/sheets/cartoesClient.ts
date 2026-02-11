import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Atribuicao,
  CartaoAlocacao,
  CartaoCredito,
  CartaoMovimento,
  CartaoMovimentoComAlocacoes,
  OrigemCartaoMovimento,
  StatusCartaoMovimento
} from "@/lib/types";
import { AppError } from "@/lib/errors";
import { toIsoNow, ymFromDate } from "@/lib/utils";

let db: DatabaseSync | null = null;
let schemaReady = false;
let ensurePromise: Promise<void> | null = null;

function getDbPath(): string {
  const configured = process.env.CARTOES_DB_PATH?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), "data", "cartoes.sqlite");
}

function asText(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolFromInt(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "sim", "yes", "on", "ativo"].includes(normalized)) return true;
    if (["0", "false", "nao", "não", "no", "off", "inativo"].includes(normalized)) return false;
  }
  return asNumber(value, 0) === 1;
}

function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new DatabaseSync(dbPath);
  instance.exec("PRAGMA foreign_keys = ON;");
  instance.exec("PRAGMA journal_mode = WAL;");

  db = instance;
  return instance;
}

function ensureSchemaSync(): void {
  if (schemaReady) return;

  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS cartoes (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      banco TEXT NOT NULL,
      titular TEXT NOT NULL,
      final_cartao TEXT NOT NULL DEFAULT '',
      padrao_atribuicao TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cartao_movimentos (
      id TEXT PRIMARY KEY,
      cartao_id TEXT NOT NULL,
      data TEXT NOT NULL,
      descricao TEXT NOT NULL,
      valor REAL NOT NULL,
      parcela_total INTEGER,
      parcela_numero INTEGER,
      tx_key TEXT NOT NULL,
      origem TEXT NOT NULL,
      status TEXT NOT NULL,
      mes_ref TEXT NOT NULL,
      observacao TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (cartao_id) REFERENCES cartoes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cartao_alocacoes (
      id TEXT PRIMARY KEY,
      movimento_id TEXT NOT NULL,
      atribuicao TEXT NOT NULL,
      valor REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (movimento_id) REFERENCES cartao_movimentos(id) ON DELETE CASCADE
    );

    DROP INDEX IF EXISTS idx_cartao_movimentos_tx;
    CREATE INDEX IF NOT EXISTS idx_cartao_movimentos_tx
      ON cartao_movimentos(cartao_id, tx_key);

    CREATE INDEX IF NOT EXISTS idx_cartao_movimentos_mes
      ON cartao_movimentos(mes_ref, status);

    CREATE INDEX IF NOT EXISTS idx_cartao_alocacoes_movimento
      ON cartao_alocacoes(movimento_id);
  `);

  schemaReady = true;
}

function runInTransaction<T>(action: () => T): T {
  const conn = getDb();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    conn.exec("COMMIT");
    return result;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
}

function mapCartaoRow(row: Record<string, unknown>): CartaoCredito {
  return {
    id: asText(row.id),
    nome: asText(row.nome),
    banco: asText(row.banco, "OUTRO") as CartaoCredito["banco"],
    titular: asText(row.titular, "OUTRO") as CartaoCredito["titular"],
    final_cartao: asText(row.final_cartao),
    padrao_atribuicao: asText(row.padrao_atribuicao, "AMBOS") as Atribuicao,
    ativo: asBoolFromInt(row.ativo),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at)
  };
}

function mapMovimentoRow(row: Record<string, unknown>): CartaoMovimento {
  return {
    id: asText(row.id),
    cartao_id: asText(row.cartao_id),
    data: asText(row.data),
    descricao: asText(row.descricao),
    valor: asNumber(row.valor, 0),
    parcela_total: asNullableNumber(row.parcela_total),
    parcela_numero: asNullableNumber(row.parcela_numero),
    tx_key: asText(row.tx_key),
    origem: asText(row.origem, "manual") as OrigemCartaoMovimento,
    status: asText(row.status, "pendente") as StatusCartaoMovimento,
    mes_ref: asText(row.mes_ref),
    observacao: asText(row.observacao),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at)
  };
}

function mapAlocacaoRow(row: Record<string, unknown>): CartaoAlocacao {
  return {
    id: asText(row.id),
    movimento_id: asText(row.movimento_id),
    atribuicao: asText(row.atribuicao, "AMBOS") as Atribuicao,
    valor: asNumber(row.valor, 0),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at)
  };
}

export function buildCartaoTxKey(input: {
  cartao_id: string;
  data: string;
  descricao: string;
  valor: number;
  parcela_total?: number | null;
  parcela_numero?: number | null;
}): string {
  const total = input.parcela_total && input.parcela_total > 1 ? input.parcela_total : 1;
  const numero = input.parcela_numero && input.parcela_numero > 0 ? input.parcela_numero : 1;
  const descricaoNormalizada = input.descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  return [input.cartao_id, input.data, descricaoNormalizada, input.valor.toFixed(2), `${numero}/${total}`].join("|");
}

export async function ensureCartoesDb(): Promise<void> {
  if (schemaReady) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = Promise.resolve()
    .then(() => {
      ensureSchemaSync();
    })
    .finally(() => {
      ensurePromise = null;
    });

  return ensurePromise;
}

export function invalidateCartoesReadCache(): void {
  // Mantido por compatibilidade de importes existentes. SQLite ja responde em baixa latencia.
}

export async function readCartoes(): Promise<CartaoCredito[]> {
  ensureSchemaSync();
  const conn = getDb();
  const rows = conn.prepare("SELECT * FROM cartoes ORDER BY nome COLLATE NOCASE").all() as Array<Record<string, unknown>>;
  return rows.map(mapCartaoRow);
}

export async function readCartaoMovimentos(): Promise<CartaoMovimento[]> {
  ensureSchemaSync();
  const conn = getDb();
  const rows = conn
    .prepare("SELECT * FROM cartao_movimentos ORDER BY data DESC, created_at DESC")
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapMovimentoRow);
}

export async function readCartaoAlocacoes(): Promise<CartaoAlocacao[]> {
  ensureSchemaSync();
  const conn = getDb();
  const rows = conn
    .prepare("SELECT * FROM cartao_alocacoes ORDER BY movimento_id, id")
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapAlocacaoRow);
}

export async function readCartaoMovimentosComAlocacoes(): Promise<CartaoMovimentoComAlocacoes[]> {
  const [cartoes, movimentos, alocacoes] = await Promise.all([
    readCartoes(),
    readCartaoMovimentos(),
    readCartaoAlocacoes()
  ]);

  const cartaoById = new Map(cartoes.map((item) => [item.id, item]));
  const alocacoesByMovimento = new Map<string, CartaoAlocacao[]>();

  for (const alocacao of alocacoes) {
    const list = alocacoesByMovimento.get(alocacao.movimento_id) ?? [];
    list.push(alocacao);
    alocacoesByMovimento.set(alocacao.movimento_id, list);
  }

  return movimentos.map((movimento) => ({
    ...movimento,
    cartao: cartaoById.get(movimento.cartao_id) ?? null,
    alocacoes: (alocacoesByMovimento.get(movimento.id) ?? []).sort((a, b) => a.id.localeCompare(b.id))
  }));
}

export async function saveCartao(input: {
  id?: string;
  nome: string;
  banco: CartaoCredito["banco"];
  titular: CartaoCredito["titular"];
  final_cartao?: string;
  padrao_atribuicao: Atribuicao;
  ativo: boolean;
}): Promise<CartaoCredito> {
  ensureSchemaSync();
  const conn = getDb();

  const now = toIsoNow();
  const id = input.id ?? randomUUID();
  const existing = conn.prepare("SELECT created_at FROM cartoes WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;

  if (input.id && !existing) {
    throw new AppError(`Cartao ${input.id} nao encontrado`, 404, "ROW_NOT_FOUND");
  }

  const row: CartaoCredito = {
    id,
    nome: input.nome.trim(),
    banco: input.banco,
    titular: input.titular,
    final_cartao: input.final_cartao?.trim() ?? "",
    padrao_atribuicao: input.padrao_atribuicao,
    ativo: input.ativo,
    created_at: existing ? asText(existing.created_at) : now,
    updated_at: now
  };

  if (existing) {
    conn
      .prepare(
        `UPDATE cartoes
         SET nome = ?, banco = ?, titular = ?, final_cartao = ?, padrao_atribuicao = ?, ativo = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        row.nome,
        row.banco,
        row.titular,
        row.final_cartao,
        row.padrao_atribuicao,
        row.ativo ? 1 : 0,
        row.updated_at,
        row.id
      );
  } else {
    conn
      .prepare(
        `INSERT INTO cartoes
         (id, nome, banco, titular, final_cartao, padrao_atribuicao, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.nome,
        row.banco,
        row.titular,
        row.final_cartao,
        row.padrao_atribuicao,
        row.ativo ? 1 : 0,
        row.created_at,
        row.updated_at
      );
  }

  return row;
}

export async function deleteCartao(id: string): Promise<void> {
  ensureSchemaSync();
  const conn = getDb();
  const result = conn.prepare("DELETE FROM cartoes WHERE id = ?").run(id);
  if (result.changes === 0) {
    throw new AppError(`Cartao ${id} nao encontrado`, 404, "ROW_NOT_FOUND");
  }
}

export async function saveCartaoMovimento(input: {
  id?: string;
  cartao_id: string;
  data: string;
  descricao: string;
  valor: number;
  parcela_total?: number | null;
  parcela_numero?: number | null;
  tx_key?: string;
  origem: OrigemCartaoMovimento;
  status: StatusCartaoMovimento;
  observacao?: string;
  mes_ref?: string;
  alocacoes: Array<{ id?: string; atribuicao: Atribuicao; valor: number }>;
}): Promise<CartaoMovimentoComAlocacoes> {
  ensureSchemaSync();
  const conn = getDb();

  const cardExists = conn.prepare("SELECT id FROM cartoes WHERE id = ?").get(input.cartao_id) as
    | Record<string, unknown>
    | undefined;
  if (!cardExists) {
    throw new AppError("Cartao nao encontrado", 404, "CARD_NOT_FOUND");
  }

  const now = toIsoNow();
  const movementId = input.id ?? randomUUID();
  const tx_key =
    input.tx_key?.trim() ||
    buildCartaoTxKey({
      cartao_id: input.cartao_id,
      data: input.data,
      descricao: input.descricao,
      valor: input.valor,
      parcela_total: input.parcela_total,
      parcela_numero: input.parcela_numero
    });

  const current = conn
    .prepare("SELECT created_at, mes_ref FROM cartao_movimentos WHERE id = ?")
    .get(movementId) as Record<string, unknown> | undefined;

  if (input.id && !current) {
    throw new AppError(`Movimento ${movementId} nao encontrado`, 404, "ROW_NOT_FOUND");
  }

  const row: CartaoMovimento = {
    id: movementId,
    cartao_id: input.cartao_id,
    data: input.data,
    descricao: input.descricao.trim(),
    valor: input.valor,
    parcela_total: input.parcela_total ?? null,
    parcela_numero: input.parcela_numero ?? null,
    tx_key,
    origem: input.origem,
    status: input.status,
    mes_ref: input.mes_ref?.trim() || (current ? asText(current.mes_ref) : ymFromDate(input.data)),
    observacao: input.observacao?.trim() ?? "",
    created_at: current ? asText(current.created_at) : now,
    updated_at: now
  };

  const alocacoes = input.alocacoes.map((item) => ({
    id: item.id ?? randomUUID(),
    movimento_id: movementId,
    atribuicao: item.atribuicao,
    valor: item.valor,
    created_at: now,
    updated_at: now
  }));

  runInTransaction(() => {
    if (current) {
      conn
        .prepare(
          `UPDATE cartao_movimentos
           SET cartao_id = ?, data = ?, descricao = ?, valor = ?, parcela_total = ?, parcela_numero = ?,
               tx_key = ?, origem = ?, status = ?, mes_ref = ?, observacao = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          row.cartao_id,
          row.data,
          row.descricao,
          row.valor,
          row.parcela_total,
          row.parcela_numero,
          row.tx_key,
          row.origem,
          row.status,
          row.mes_ref,
          row.observacao,
          row.updated_at,
          row.id
        );
    } else {
      conn
        .prepare(
          `INSERT INTO cartao_movimentos
           (id, cartao_id, data, descricao, valor, parcela_total, parcela_numero, tx_key, origem, status, mes_ref, observacao, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.id,
          row.cartao_id,
          row.data,
          row.descricao,
          row.valor,
          row.parcela_total,
          row.parcela_numero,
          row.tx_key,
          row.origem,
          row.status,
          row.mes_ref,
          row.observacao,
          row.created_at,
          row.updated_at
        );
    }

    conn.prepare("DELETE FROM cartao_alocacoes WHERE movimento_id = ?").run(movementId);

    const insertAlocacao = conn.prepare(
      `INSERT INTO cartao_alocacoes
       (id, movimento_id, atribuicao, valor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const alocacao of alocacoes) {
      insertAlocacao.run(
        alocacao.id,
        alocacao.movimento_id,
        alocacao.atribuicao,
        alocacao.valor,
        alocacao.created_at,
        alocacao.updated_at
      );
    }
  });

  const cardRow = conn.prepare("SELECT * FROM cartoes WHERE id = ?").get(input.cartao_id) as
    | Record<string, unknown>
    | undefined;
  const card = cardRow ? mapCartaoRow(cardRow) : null;

  return {
    ...row,
    cartao: card,
    alocacoes
  };
}

export async function deleteCartaoMovimento(id: string): Promise<void> {
  ensureSchemaSync();
  const conn = getDb();

  const movement = conn.prepare("SELECT id FROM cartao_movimentos WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!movement) {
    throw new AppError(`Movimento ${id} nao encontrado`, 404, "ROW_NOT_FOUND");
  }

  runInTransaction(() => {
    conn.prepare("DELETE FROM cartao_alocacoes WHERE movimento_id = ?").run(id);
    conn.prepare("DELETE FROM cartao_movimentos WHERE id = ?").run(id);
  });
}

export async function alignCartaoMovimentosMesRef(params: {
  ids: string[];
  mes_ref: string;
  updated_at?: string;
}): Promise<number> {
  ensureSchemaSync();
  if (params.ids.length === 0) return 0;

  const conn = getDb();
  const now = params.updated_at?.trim() || toIsoNow();
  const stmt = conn.prepare(
    `UPDATE cartao_movimentos
     SET mes_ref = ?, updated_at = ?
     WHERE id = ? AND origem = 'fatura' AND mes_ref <> ?`
  );

  let changed = 0;
  runInTransaction(() => {
    for (const id of params.ids) {
      const result = stmt.run(params.mes_ref, now, id, params.mes_ref);
      changed += Number(result.changes);
    }
  });

  return changed;
}
