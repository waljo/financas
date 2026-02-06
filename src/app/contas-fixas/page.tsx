"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ContaFixa } from "@/lib/types";

const atribuicoes = ["WALKER", "DEA", "AMBOS", "AMBOS_I"];

interface ContaFixaForm {
  id?: string;
  nome: string;
  dia_vencimento: string;
  valor_previsto: string;
  atribuicao: string;
  categoria: string;
  avisar_dias_antes: string;
  ativo: boolean;
}

const initialForm: ContaFixaForm = {
  nome: "",
  dia_vencimento: "10",
  valor_previsto: "",
  atribuicao: "AMBOS",
  categoria: "",
  avisar_dias_antes: "5,2",
  ativo: true
};

export default function ContasFixasPage() {
  const [rows, setRows] = useState<ContaFixa[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<ContaFixaForm>(initialForm);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/contas-fixas");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar contas fixas");
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
        dia_vencimento: Number(form.dia_vencimento),
        valor_previsto: form.valor_previsto ? Number(form.valor_previsto) : null,
        ativo: Boolean(form.ativo)
      };

      const method = form.id ? "PUT" : "POST";
      const response = await fetch("/api/contas-fixas", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao salvar conta fixa");

      setMessage(form.id ? "Conta fixa atualizada." : "Conta fixa cadastrada.");
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  function editRow(row: ContaFixa) {
    setForm({
      id: row.id,
      nome: row.nome,
      dia_vencimento: String(row.dia_vencimento),
      valor_previsto: row.valor_previsto === null ? "" : String(row.valor_previsto),
      atribuicao: row.atribuicao,
      categoria: row.categoria,
      avisar_dias_antes: row.avisar_dias_antes,
      ativo: row.ativo
    });
  }

  async function removeRow(id: string) {
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/contas-fixas?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir conta fixa");

      if (form.id === id) {
        setForm(initialForm);
      }

      setMessage("Conta fixa excluida.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Contas fixas</h1>
        <p className="text-sm text-ink/70">CRUD no Sheets para vencimentos recorrentes.</p>
      </header>

      <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm md:col-span-2">
          Nome
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.nome}
            onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))}
            required
          />
        </label>
        <label className="text-sm">
          Dia vencimento
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            min="1"
            max="31"
            value={form.dia_vencimento}
            onChange={(event) => setForm((prev) => ({ ...prev, dia_vencimento: event.target.value }))}
            required
          />
        </label>
        <label className="text-sm">
          Valor previsto
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            step="0.01"
            min="0"
            value={form.valor_previsto}
            onChange={(event) => setForm((prev) => ({ ...prev, valor_previsto: event.target.value }))}
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
        <label className="text-sm">
          Categoria
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.categoria}
            onChange={(event) => setForm((prev) => ({ ...prev, categoria: event.target.value }))}
            required
          />
        </label>
        <label className="text-sm">
          Avisar dias antes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={form.avisar_dias_antes}
            onChange={(event) => setForm((prev) => ({ ...prev, avisar_dias_antes: event.target.value }))}
            placeholder="5,2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.ativo}
            onChange={(event) => setForm((prev) => ({ ...prev, ativo: event.target.checked }))}
          />
          Ativo
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
        <h2 className="mb-3 text-lg font-semibold">Lista</h2>
        {loading ? <p className="text-sm">Carregando...</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-2 py-2">Nome</th>
                <th className="px-2 py-2">Dia</th>
                <th className="px-2 py-2">Valor</th>
                <th className="px-2 py-2">Atrib.</th>
                <th className="px-2 py-2">Categoria</th>
                <th className="px-2 py-2">Avisos</th>
                <th className="px-2 py-2">Ativo</th>
                <th className="px-2 py-2">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink/5">
                  <td className="px-2 py-2">{row.nome}</td>
                  <td className="px-2 py-2">{row.dia_vencimento}</td>
                  <td className="px-2 py-2">{row.valor_previsto ?? "-"}</td>
                  <td className="px-2 py-2">{row.atribuicao}</td>
                  <td className="px-2 py-2">{row.categoria}</td>
                  <td className="px-2 py-2">{row.avisar_dias_antes}</td>
                  <td className="px-2 py-2">{row.ativo ? "Sim" : "Nao"}</td>
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
