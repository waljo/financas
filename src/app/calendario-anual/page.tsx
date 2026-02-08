"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CalendarioAnual } from "@/lib/types";
import { CategoryPicker } from "@/components/CategoryPicker";

const atribuicoes = ["WALKER", "DEA", "AMBOS", "AMBOS_I"];

interface CalendarioForm {
  id?: string;
  mes: string;
  evento: string;
  valor_estimado: string;
  avisar_dias_antes: string;
  atribuicao: string;
  categoria: string;
  observacao: string;
  dia_mes: string;
}

const initialForm: CalendarioForm = {
  mes: "1",
  evento: "",
  valor_estimado: "",
  avisar_dias_antes: "10,5,2",
  atribuicao: "AMBOS",
  categoria: "",
  observacao: "",
  dia_mes: "1"
};

export default function CalendarioAnualPage() {
  const [rows, setRows] = useState<CalendarioAnual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<CalendarioForm>(initialForm);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/calendario-anual");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar calendario anual");
      setRows(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");

    try {
      const payload = {
        ...form,
        mes: Number(form.mes),
        valor_estimado: Number(form.valor_estimado),
        dia_mes: form.dia_mes ? Number(form.dia_mes) : 1
      };

      const method = form.id ? "PUT" : "POST";
      const response = await fetch("/api/calendario-anual", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao salvar evento anual");

      setMessage(form.id ? "Evento anual atualizado." : "Evento anual salvo.");
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  function editRow(row: CalendarioAnual) {
    setForm({
      id: row.id,
      mes: String(row.mes),
      evento: row.evento,
      valor_estimado: String(row.valor_estimado),
      avisar_dias_antes: row.avisar_dias_antes,
      atribuicao: row.atribuicao,
      categoria: row.categoria,
      observacao: row.observacao,
      dia_mes: String(row.dia_mes ?? 1)
    });
  }

  async function removeRow(id: string) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/calendario-anual?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir evento anual");

      if (form.id === id) {
        setForm(initialForm);
      }

      setMessage("Evento anual excluido.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Calendario anual</h1>
        <p className="text-sm text-ink/70">CRUD de despesas sazonais para previsao de meses caros.</p>
      </header>

      <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm">
          Mes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            min="1"
            max="12"
            value={form.mes}
            onChange={(event) => setForm((prev) => ({ ...prev, mes: event.target.value }))}
            required
          />
        </label>
        <label className="text-sm">
          Dia (opcional)
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            min="1"
            max="31"
            value={form.dia_mes}
            onChange={(event) => setForm((prev) => ({ ...prev, dia_mes: event.target.value }))}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Evento
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.evento}
            onChange={(event) => setForm((prev) => ({ ...prev, evento: event.target.value }))}
            required
          />
        </label>

        <label className="text-sm">
          Valor estimado
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            min="0"
            step="0.01"
            value={form.valor_estimado}
            onChange={(event) => setForm((prev) => ({ ...prev, valor_estimado: event.target.value }))}
            required
          />
        </label>
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
        <CategoryPicker
          label="Categoria"
          value={form.categoria}
          onChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
          required
          allowCreate
        />
        <label className="text-sm">
          Avisar dias antes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.avisar_dias_antes}
            onChange={(event) => setForm((prev) => ({ ...prev, avisar_dias_antes: event.target.value }))}
          />
        </label>

        <label className="text-sm md:col-span-4">
          Observacao
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.observacao}
            onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
          />
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
              Cancelar edicao
            </button>
          ) : null}
        </div>
      </form>

      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}

      <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Eventos cadastrados</h2>
        {loading ? <p className="text-sm">Carregando...</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-2 py-2">Mes</th>
                <th className="px-2 py-2">Dia</th>
                <th className="px-2 py-2">Evento</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Atrib.</th>
                <th className="px-2 py-2">Categoria</th>
                <th className="px-2 py-2">Avisos</th>
                <th className="px-2 py-2">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink/5">
                  <td className="px-2 py-2">{row.mes}</td>
                  <td className="px-2 py-2">{row.dia_mes ?? 1}</td>
                  <td className="px-2 py-2">{row.evento}</td>
                  <td className="px-2 py-2">{row.valor_estimado}</td>
                  <td className="px-2 py-2">{row.atribuicao}</td>
                  <td className="px-2 py-2">{row.categoria}</td>
                  <td className="px-2 py-2">{row.avisar_dias_antes}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded border border-ink/20 px-2 py-1"
                        onClick={() => editRow(row)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="rounded border border-coral px-2 py-1 text-coral"
                        onClick={() => removeRow(row.id)}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
