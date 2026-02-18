"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import {
  queueCategoriaDeleteLocal,
  queueCategoriaUpsertLocal
} from "@/lib/mobileOffline/queue";
import {
  MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY,
  MOBILE_OFFLINE_CATEGORIAS_CACHE_KEY,
  MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY,
  MOBILE_OFFLINE_LANCAMENTOS_CACHE_KEY
} from "@/lib/mobileOffline/storageKeys";
import type { CalendarioAnual, Categoria, ContaFixa, Lancamento } from "@/lib/types";

type CategoriaRow = Categoria & { usoTotal: number };

type CategoriaForm = {
  id?: string;
  nome: string;
  ativa: boolean;
  ordem: string;
  cor: string;
};

const initialForm: CategoriaForm = {
  nome: "",
  ativa: true,
  ordem: "",
  cor: ""
};

type NormalizePreview = {
  summary: {
    totalCategoriasEmUso: number;
    totalUsos: number;
    missing: number;
    existingActive: number;
    existingInactive: number;
  };
  items: Array<{
    nome: string;
    slug: string;
    usoTotal: number;
    status: "existing_active" | "existing_inactive" | "missing";
    categoriaId: string | null;
    categoriaNome: string | null;
  }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUuid(value?: string) {
  if (value && UUID_PATTERN.test(value)) return value;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function readCachedArray(key: string): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    return norm === "1" || norm === "true" || norm === "sim" || norm === "yes";
  }
  return false;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCategoria(item: unknown): Categoria | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const nome = normalizeCategoryName(typeof raw.nome === "string" ? raw.nome : "");
  if (!id || !nome) return null;

  const slugInput = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug : nome;
  return {
    id,
    nome,
    slug: normalizeCategorySlug(slugInput),
    ativa: raw.ativa === undefined ? true : parseBooleanLike(raw.ativa),
    ordem: parseNullableNumber(raw.ordem),
    cor: typeof raw.cor === "string" ? raw.cor.trim() : "",
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : ""
  };
}

function toCategoriaRow(item: unknown): CategoriaRow | null {
  const base = toCategoria(item);
  if (!base) return null;
  const raw = item as Record<string, unknown>;
  const uso = parseNullableNumber(raw.usoTotal);
  return {
    ...base,
    usoTotal: uso !== null && uso >= 0 ? uso : 0
  };
}

function sortCategorias<T extends { ordem: number | null; nome: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const ordemA = a.ordem ?? Number.MAX_SAFE_INTEGER;
    const ordemB = b.ordem ?? Number.MAX_SAFE_INTEGER;
    if (ordemA !== ordemB) return ordemA - ordemB;
    return a.nome.localeCompare(b.nome);
  });
}

function categoriasFromRows(rows: CategoriaRow[]): Categoria[] {
  return rows.map(({ usoTotal: _usoTotal, ...item }) => item);
}

function readCachedCategorias(): CategoriaRow[] {
  return readCachedArray(MOBILE_OFFLINE_CATEGORIAS_CACHE_KEY)
    .map(toCategoriaRow)
    .filter((item): item is CategoriaRow => Boolean(item));
}

function writeCachedCategorias(rows: CategoriaRow[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CATEGORIAS_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function buildUsageMapFromLocalCaches() {
  const lancamentos = readCachedArray(MOBILE_OFFLINE_LANCAMENTOS_CACHE_KEY) as Lancamento[];
  const contasFixas = readCachedArray(MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY) as ContaFixa[];
  const calendario = readCachedArray(MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY) as CalendarioAnual[];

  const usage = new Map<string, number>();
  const categorias = [
    ...lancamentos.map((item) => item?.categoria),
    ...contasFixas.map((item) => item?.categoria),
    ...calendario.map((item) => item?.categoria)
  ];

  for (const raw of categorias) {
    const nome = normalizeCategoryName(typeof raw === "string" ? raw : "");
    if (!nome) continue;
    const slug = normalizeCategorySlug(nome);
    usage.set(slug, (usage.get(slug) ?? 0) + 1);
  }

  return usage;
}

function attachUsage(categorias: Categoria[]): CategoriaRow[] {
  const usage = buildUsageMapFromLocalCaches();
  return categorias.map((item) => ({
    ...item,
    usoTotal: usage.get(item.slug) ?? 0
  }));
}

export default function CategoriasPage() {
  const { mobileOfflineMode } = useFeatureFlags();
  const [rows, setRows] = useState<CategoriaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<CategoriaForm>(initialForm);
  const [search, setSearch] = useState("");
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<NormalizePreview | null>(null);
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;

  async function load() {
    setLoading(true);
    setError("");
    const cached = mobileOfflineMode ? sortCategorias(readCachedCategorias()) : [];
    if (cached.length > 0) {
      setRows(cached);
    }
    try {
      const response = await fetch("/api/categorias");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar categorias");
      const remoteRows = ((payload.data ?? []) as unknown[])
        .map(toCategoriaRow)
        .filter((item): item is CategoriaRow => Boolean(item));
      const nextRows = mobileOfflineMode
        ? sortCategorias(attachUsage(categoriasFromRows(remoteRows)))
        : sortCategorias(remoteRows);
      setRows(nextRows);
      if (mobileOfflineMode) {
        writeCachedCategorias(nextRows);
      }
    } catch (err) {
      if (!mobileOfflineMode || cached.length === 0) {
        setError(err instanceof Error ? err.message : "Erro inesperado");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((item) => (showOnlyActive ? item.ativa : true))
      .filter((item) => (!query ? true : `${item.nome} ${item.slug}`.toLowerCase().includes(query)));
  }, [rows, search, showOnlyActive]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const payload = {
        ...form,
        ordem: form.ordem ? Number(form.ordem) : null
      };

      if (mobileOfflineMode) {
        const nome = normalizeCategoryName(payload.nome);
        const slug = normalizeCategorySlug(nome);
        if (!nome || !slug) {
          throw new Error("Nome de categoria invalido");
        }
        const duplicate = rows.find((item) => item.slug === slug && item.id !== form.id);
        if (duplicate) {
          throw new Error(`Ja existe categoria equivalente: ${duplicate.nome}`);
        }

        const now = new Date().toISOString();
        const current = form.id ? rows.find((item) => item.id === form.id) : null;
        const localCategoria: Categoria = {
          id: ensureUuid(form.id),
          nome,
          slug,
          ativa: payload.ativa,
          ordem: payload.ordem,
          cor: payload.cor.trim(),
          created_at: current?.created_at || now,
          updated_at: now
        };

        const nextCategorias = form.id
          ? categoriasFromRows(rows).map((item) => (item.id === form.id ? localCategoria : item))
          : [localCategoria, ...categoriasFromRows(rows)];
        const nextRows = sortCategorias(attachUsage(nextCategorias));
        setRows(nextRows);
        writeCachedCategorias(nextRows);
        await queueCategoriaUpsertLocal(localCategoria);
        setMessage(form.id ? "Categoria atualizada localmente. Use Sync para enviar." : "Categoria cadastrada localmente. Use Sync para enviar.");
        setForm(initialForm);
        return;
      }

      const method = form.id ? "PUT" : "POST";
      const response = await fetch("/api/categorias", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao salvar categoria");

      setMessage(form.id ? "Categoria atualizada." : "Categoria cadastrada.");
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  function editRow(row: CategoriaRow) {
    setForm({
      id: row.id,
      nome: row.nome,
      ativa: row.ativa,
      ordem: row.ordem === null ? "" : String(row.ordem),
      cor: row.cor ?? ""
    });
  }

  async function toggleAtiva(row: CategoriaRow) {
    setError("");
    setMessage("");

    if (mobileOfflineMode) {
      const now = new Date().toISOString();
      const nextCategoria: Categoria = {
        id: row.id,
        nome: row.nome,
        slug: row.slug,
        ativa: !row.ativa,
        ordem: row.ordem,
        cor: row.cor,
        created_at: row.created_at,
        updated_at: now
      };

      const nextCategorias = categoriasFromRows(rows).map((item) => (item.id === row.id ? nextCategoria : item));
      const nextRows = sortCategorias(attachUsage(nextCategorias));
      setRows(nextRows);
      writeCachedCategorias(nextRows);
      await queueCategoriaUpsertLocal(nextCategoria);
      setMessage(!row.ativa ? "Categoria reativada localmente. Use Sync para enviar." : "Categoria desativada localmente. Use Sync para enviar.");
      return;
    }

    try {
      const response = await fetch("/api/categorias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          nome: row.nome,
          ativa: !row.ativa,
          ordem: row.ordem,
          cor: row.cor
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao alterar status");
      setMessage(!row.ativa ? "Categoria reativada." : "Categoria desativada.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  async function removeRow(row: CategoriaRow) {
    if (!confirm(`Excluir categoria "${row.nome}"?`)) return;
    setError("");
    setMessage("");

    if (row.usoTotal > 0) {
      setError(`Categoria em uso (${row.usoTotal} registro(s)). Desative em vez de excluir.`);
      return;
    }

    if (mobileOfflineMode) {
      const nextRows = sortCategorias(rows.filter((item) => item.id !== row.id));
      setRows(nextRows);
      writeCachedCategorias(nextRows);
      await queueCategoriaDeleteLocal(row.id);
      if (form.id === row.id) setForm(initialForm);
      setMessage("Categoria excluida localmente. Use Sync para enviar.");
      return;
    }

    try {
      const response = await fetch(`/api/categorias?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir categoria");
      if (form.id === row.id) setForm(initialForm);
      setMessage("Categoria excluida.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  async function loadPreview() {
    if (mobileOfflineMode && !isOnline) {
      setError("Preview de normalizacao requer internet.");
      return;
    }

    setPreviewLoading(true);
    setError("");
    try {
      const response = await fetch("/api/categorias/normalizar/preview");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao gerar preview de normalizacao");
      setPreview(payload.data as NormalizePreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function runNormalization() {
    if (mobileOfflineMode && !isOnline) {
      setError("Normalizacao de categorias requer internet.");
      return;
    }

    setNormalizing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/categorias/normalizar/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reativarInativas: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao executar normalizacao");
      setMessage(
        `Normalizacao concluida: ${payload.data.created} criada(s), ${payload.data.reativadas} reativada(s).`
      );
      await Promise.all([load(), loadPreview()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setNormalizing(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Categorias</h1>
        <p className="text-sm text-ink/70">Lista mestre para padronizar categorias de lancamentos e cadastros.</p>
        {mobileOfflineMode ? (
          <p className="mt-2 inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink/70">
            Modo offline: alteracoes salvas localmente
          </p>
        ) : null}
      </header>

      <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm md:col-span-2">
          Nome
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.nome}
            onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))}
            placeholder="Ex.: Moradia"
            required
          />
        </label>
        <label className="text-sm">
          Ordem (opcional)
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            value={form.ordem}
            onChange={(event) => setForm((prev) => ({ ...prev, ordem: event.target.value }))}
          />
        </label>
        <label className="text-sm">
          Cor (opcional)
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.cor}
            onChange={(event) => setForm((prev) => ({ ...prev, cor: event.target.value }))}
            placeholder="#0EA5E9"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.ativa}
            onChange={(event) => setForm((prev) => ({ ...prev, ativa: event.target.checked }))}
          />
          Categoria ativa
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-ink px-4 py-2 font-semibold text-sand">
            {form.id ? "Atualizar" : "Salvar"}
          </button>
          {form.id ? (
            <button
              type="button"
              className="rounded-lg border border-ink/20 px-4 py-2"
              onClick={() => setForm(initialForm)}
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-full rounded-lg border border-ink/20 px-3 py-2 text-sm md:max-w-sm"
            placeholder="Buscar categoria"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOnlyActive}
              onChange={(event) => setShowOnlyActive(event.target.checked)}
            />
            Mostrar apenas ativas
          </label>
          <button
            type="button"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            onClick={loadPreview}
            disabled={previewLoading || (mobileOfflineMode && !isOnline)}
          >
            {previewLoading ? "Gerando preview..." : "Preview normalizacao"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            onClick={runNormalization}
            disabled={normalizing || (mobileOfflineMode && !isOnline)}
          >
            {normalizing ? "Normalizando..." : "Normalizar categorias antigas"}
          </button>
        </div>

        {preview ? (
          <article className="rounded-lg border border-ink/10 bg-sand p-3 text-sm">
            <p>
              Em uso: {preview.summary.totalCategoriasEmUso} | Faltantes: {preview.summary.missing} | Inativas:{" "}
              {preview.summary.existingInactive}
            </p>
          </article>
        ) : null}
      </section>

      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}

      <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Lista de categorias</h2>
        {loading ? <p className="text-sm text-ink/70">Carregando...</p> : null}
        {!loading && filtered.length === 0 ? <p className="text-sm text-ink/70">Nenhuma categoria encontrada.</p> : null}

        {filtered.length > 0 ? (
          <div className="space-y-2">
            {filtered.map((row) => (
              <article key={row.id} className="rounded-lg border border-ink/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.nome}</p>
                    <p className="text-xs text-ink/60">
                      {row.ativa ? "Ativa" : "Inativa"} | uso: {row.usoTotal}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded border border-ink/20 px-2 py-1 text-xs"
                      onClick={() => editRow(row)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="rounded border border-ink/20 px-2 py-1 text-xs"
                      onClick={() => void toggleAtiva(row)}
                    >
                      {row.ativa ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-coral/40 px-2 py-1 text-xs text-coral"
                      onClick={() => void removeRow(row)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}
