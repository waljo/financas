import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Lancamento } from "@/lib/types";
import { readLancamentos } from "@/lib/sheets/sheetsClient";

const CACHE_TTL_MS = 5 * 60 * 1000;
const META_SYNCED_AT_KEY = "lancamentos_synced_at";

let db: DatabaseSync | null = null;
let schemaReady = false;
let syncInFlight: Promise<void> | null = null;

function getDbPath(): string {
  const configured = process.env.LANCAMENTOS_CACHE_DB_PATH?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), "data", "lancamentos.sqlite");
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

function getDb(): DatabaseSync {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const instance = new DatabaseSync(dbPath);
  instance.exec("PRAGMA journal_mode = WAL;");
  instance.exec("PRAGMA synchronous = NORMAL;");
  db = instance;
  return instance;
}

function ensureSchemaSync(): void {
  if (schemaReady) return;

  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS lancamentos_cache (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      tipo TEXT NOT NULL,
      descricao TEXT NOT NULL,
      categoria TEXT NOT NULL,
      valor REAL NOT NULL,
      atribuicao TEXT NOT NULL,
      metodo TEXT NOT NULL,
      parcela_total INTEGER,
      parcela_numero INTEGER,
      observacao TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      quem_pagou TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lancamentos_cache_data
      ON lancamentos_cache(data DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
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

function readMeta(key: string): string | null {
  ensureSchemaSync();
  const conn = getDb();
  const row = conn
    .prepare("SELECT value FROM cache_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(key: string, value: string): void {
  ensureSchemaSync();
  const conn = getDb();
  conn
    .prepare(
      "INSERT INTO cache_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

function parseMetaNumber(value: string | null): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCacheRows(): Lancamento[] {
  ensureSchemaSync();
  const conn = getDb();
  const rows = conn
    .prepare("SELECT * FROM lancamentos_cache ORDER BY data DESC, updated_at DESC")
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: asText(row.id),
    data: asText(row.data),
    tipo: asText(row.tipo, "despesa") as Lancamento["tipo"],
    descricao: asText(row.descricao),
    categoria: asText(row.categoria),
    valor: asNumber(row.valor, 0),
    atribuicao: asText(row.atribuicao, "AMBOS") as Lancamento["atribuicao"],
    metodo: asText(row.metodo, "outro") as Lancamento["metodo"],
    parcela_total: asNullableNumber(row.parcela_total),
    parcela_numero: asNullableNumber(row.parcela_numero),
    observacao: asText(row.observacao),
    created_at: asText(row.created_at),
    updated_at: asText(row.updated_at),
    quem_pagou: asText(row.quem_pagou, "WALKER") as Lancamento["quem_pagou"]
  }));
}

function isCacheFresh(nowMs: number): boolean {
  const syncedAt = readMeta(META_SYNCED_AT_KEY);
  if (!syncedAt) return false;
  const syncedAtMs = Date.parse(syncedAt);
  if (!Number.isFinite(syncedAtMs)) return false;
  return nowMs - syncedAtMs <= CACHE_TTL_MS;
}

export async function syncLancamentosCacheFromSheets(): Promise<void> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const lancamentos = await readLancamentos();
    const nowIso = new Date().toISOString();
    ensureSchemaSync();

    runInTransaction(() => {
      const conn = getDb();
      conn.prepare("DELETE FROM lancamentos_cache").run();
      const insert = conn.prepare(`
        INSERT INTO lancamentos_cache(
          id, data, tipo, descricao, categoria, valor, atribuicao, metodo,
          parcela_total, parcela_numero, observacao, created_at, updated_at, quem_pagou
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of lancamentos) {
        insert.run(
          item.id,
          item.data,
          item.tipo,
          item.descricao,
          item.categoria,
          item.valor,
          item.atribuicao,
          item.metodo,
          item.parcela_total,
          item.parcela_numero,
          item.observacao,
          item.created_at,
          item.updated_at,
          item.quem_pagou
        );
      }

      writeMeta(META_SYNCED_AT_KEY, nowIso);
      writeMeta("lancamentos_count", String(lancamentos.length));
    });
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}

export async function readLancamentosCached(): Promise<Lancamento[]> {
  const nowMs = Date.now();
  const cachedRows = readCacheRows();
  if (cachedRows.length > 0 && isCacheFresh(nowMs)) {
    return cachedRows;
  }

  try {
    await syncLancamentosCacheFromSheets();
    return readCacheRows();
  } catch {
    if (cachedRows.length > 0) {
      return cachedRows;
    }
    throw new Error("Falha ao carregar lancamentos do cache e da origem Sheets.");
  }
}

export interface LancamentosCacheStatus {
  count: number;
  syncedAt: string | null;
  fresh: boolean;
  ttlMs: number;
}

export function readLancamentosCacheStatus(nowMs = Date.now()): LancamentosCacheStatus {
  ensureSchemaSync();
  const syncedAt = readMeta(META_SYNCED_AT_KEY);
  const count = parseMetaNumber(readMeta("lancamentos_count"));
  return {
    count,
    syncedAt,
    fresh: isCacheFresh(nowMs),
    ttlMs: CACHE_TTL_MS
  };
}

export function readLancamentosCacheMeta(key: string): string | null {
  return readMeta(key);
}

export function writeLancamentosCacheMeta(key: string, value: string): void {
  writeMeta(key, value);
}
