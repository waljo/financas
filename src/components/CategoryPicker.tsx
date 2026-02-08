"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";

type CategoriaOption = {
  id: string;
  nome: string;
  slug: string;
  ativa: boolean;
  usoTotal?: number;
  legacy?: boolean;
};

interface CategoryPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  allowCreate?: boolean;
}

export function CategoryPicker(props: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<CategoriaOption[]>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const currentValue = normalizeCategoryName(props.value);
  const currentSlug = normalizeCategorySlug(currentValue);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/categorias?ativo=true");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar categorias");
      setOptions((payload.data ?? []) as CategoriaOption[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao carregar categorias");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const allOptions = useMemo(() => {
    const hasCurrent = currentSlug && options.some((item) => item.slug === currentSlug);
    const legacy = currentValue && !hasCurrent ? [{ id: `legacy:${currentSlug}`, nome: currentValue, slug: currentSlug, ativa: true, legacy: true }] : [];
    return [...legacy, ...options].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [currentSlug, currentValue, options]);

  const filtered = useMemo(() => {
    const query = normalizeCategorySlug(search);
    if (!query) return allOptions;
    return allOptions.filter((item) => item.slug.includes(query));
  }, [allOptions, search]);

  const createCandidate = useMemo(() => {
    if (!props.allowCreate) return "";
    const nome = normalizeCategoryName(search);
    if (!nome) return "";
    const slug = normalizeCategorySlug(nome);
    const exists = allOptions.some((item) => item.slug === slug);
    return exists ? "" : nome;
  }, [allOptions, props.allowCreate, search]);

  async function handleCreate() {
    if (!createCandidate) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/categorias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: createCandidate, ativa: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao criar categoria");

      const created = payload.data as CategoriaOption;
      setOptions((prev) => {
        if (prev.some((item) => item.slug === created.slug)) return prev;
        return [...prev, created];
      });
      props.onChange(created.nome);
      setSearch("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao criar categoria");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <label className="text-sm">
        {props.label}
        <button
          type="button"
          className="mt-1 flex w-full items-center justify-between rounded-lg border border-ink/20 px-3 py-2 text-left"
          onClick={() => setOpen(true)}
          disabled={props.disabled}
          aria-label={`Selecionar categoria para ${props.label}`}
        >
          <span className={currentValue ? "text-ink" : "text-ink/50"}>
            {currentValue || props.placeholder || "Selecionar categoria"}
          </span>
          <span className="text-xs text-ink/60">Buscar</span>
        </button>
        {props.required && !currentValue ? <span className="text-xs text-coral">Selecione uma categoria.</span> : null}
      </label>

      {open ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
            aria-label="Fechar seletor de categoria"
          />
          <section className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">Selecionar categoria</h3>
              <button
                type="button"
                className="rounded-lg border border-ink/20 px-3 py-1 text-sm"
                onClick={() => setOpen(false)}
              >
                Fechar
              </button>
            </div>

            <input
              ref={searchRef}
              className="w-full rounded-lg border border-ink/20 px-3 py-2 text-sm"
              placeholder="Buscar categoria"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            {createCandidate ? (
              <button
                type="button"
                className="mt-2 w-full rounded-lg border border-pine/40 bg-pine/10 px-3 py-2 text-left text-sm"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? "Criando..." : `Criar "${createCandidate}"`}
              </button>
            ) : null}

            {loading ? <p className="mt-3 text-sm text-ink/70">Carregando categorias...</p> : null}
            {error ? <p className="mt-3 rounded bg-coral/15 p-2 text-sm text-coral">{error}</p> : null}

            {!loading && !error ? (
              <div className="mt-3 space-y-2">
                {filtered.length === 0 ? (
                  <p className="rounded-lg border border-ink/10 bg-sand p-3 text-sm text-ink/70">
                    Nenhuma categoria encontrada.
                  </p>
                ) : (
                  filtered.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        item.slug === currentSlug ? "border-ink/40 bg-sand" : "border-ink/10 bg-white"
                      }`}
                      onClick={() => {
                        props.onChange(item.nome);
                        setOpen(false);
                      }}
                    >
                      <p className="font-medium">{item.nome}</p>
                      {item.legacy ? <p className="text-xs text-ink/60">Categoria legada (ainda nao cadastrada).</p> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
