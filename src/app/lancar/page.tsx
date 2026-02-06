"use client";

import { FormEvent, useMemo, useState } from "react";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const atribuicoes = ["WALKER", "DEA", "AMBOS", "AMBOS_I"];
const metodos = ["pix", "cartao", "dinheiro", "transferencia", "outro"];

export default function LancarPage() {
  const initialState = useMemo(
    () => ({
      data: todayIso(),
      tipo: "despesa",
      descricao: "",
      categoria: "",
      valor: "",
      atribuicao: "AMBOS",
      metodo: "pix",
      parcela_total: "",
      parcela_numero: "",
      observacao: "",
      quem_pagou: "WALKER"
    }),
    []
  );

  const [form, setForm] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        ...form,
        valor: Number(form.valor),
        parcela_total: form.parcela_total ? Number(form.parcela_total) : null,
        parcela_numero: form.parcela_numero ? Number(form.parcela_numero) : null
      };

      const response = await fetch("/api/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao salvar lancamento");
      }

      setMessage("Lancamento salvo com sucesso.");
      setForm(initialState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Novo lancamento</h1>
        <p className="text-sm text-ink/70">Formulario otimizado para mobile e lancamento rapido.</p>
      </header>

      <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Data
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="date"
              value={form.data}
              onChange={(event) => setForm((prev) => ({ ...prev, data: event.target.value }))}
              required
            />
          </label>

          <label className="text-sm">
            Tipo
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.tipo}
              onChange={(event) => setForm((prev) => ({ ...prev, tipo: event.target.value }))}
            >
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
            </select>
          </label>
        </div>

        <label className="text-sm">
          Descricao
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.descricao}
            onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
            required
            placeholder="Ex.: Condominio"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Categoria
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.categoria}
              onChange={(event) => setForm((prev) => ({ ...prev, categoria: event.target.value }))}
              required
              placeholder="Moradia, Saude..."
            />
          </label>

          <label className="text-sm">
            Valor
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              step="0.01"
              value={form.valor}
              onChange={(event) => setForm((prev) => ({ ...prev, valor: event.target.value }))}
              required
            />
            <span className="text-xs text-ink/60">
              Receita ou despesa podem ser negativas para ajustes de reconciliacao.
            </span>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Atribuicao
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.atribuicao}
              onChange={(event) => setForm((prev) => ({ ...prev, atribuicao: event.target.value }))}
            >
              {atribuicoes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Metodo
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.metodo}
              onChange={(event) => setForm((prev) => ({ ...prev, metodo: event.target.value }))}
            >
              {metodos.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Quem pagou
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.quem_pagou}
              onChange={(event) => setForm((prev) => ({ ...prev, quem_pagou: event.target.value }))}
            >
              <option value="WALKER">WALKER</option>
              <option value="DEA">DEA</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Parcela total (opcional)
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              min="1"
              value={form.parcela_total}
              onChange={(event) => setForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
            />
          </label>

          <label className="text-sm">
            Numero da parcela (opcional)
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              min="1"
              value={form.parcela_numero}
              onChange={(event) => setForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
            />
          </label>
        </div>

        <label className="text-sm">
          Observacao
          <textarea
            className="mt-1 min-h-24 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.observacao}
            onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
          />
        </label>

        <button
          type="submit"
          className="w-full rounded-lg bg-ink px-4 py-3 font-semibold text-sand md:w-auto"
          disabled={saving}
        >
          {saving ? "Salvando..." : "Salvar lancamento"}
        </button>
      </form>

      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}
    </section>
  );
}
