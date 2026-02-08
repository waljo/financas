"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Categoria } from "@/lib/types";

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

export default function CategoriasPage() {
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

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/categorias");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar categorias");
      setRows((payload.data ?? []) as CategoriaRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
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
            disabled={previewLoading}
          >
            {previewLoading ? "Gerando preview..." : "Preview normalizacao"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            onClick={runNormalization}
            disabled={normalizing}
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
