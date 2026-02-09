"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ContaFixa } from "@/lib/types";
import { CategoryPicker } from "@/components/CategoryPicker";

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
  const [isFormOpen, setIsFormOpen] = useState(false);

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

      setMessage(form.id ? "Atualizada." : "Cadastrada.");
      setForm(initialForm);
      setIsFormOpen(false);
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
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRow(id: string) {
    if (!confirm("Excluir esta conta fixa?")) return;
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/contas-fixas?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir conta fixa");

      setMessage("Excluída.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  return (
    <section className="space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Contas Fixas</h1>
          <p className="text-sm font-medium text-ink/50">Gestão de gastos mensais</p>
        </div>
        <button
          onClick={() => {
            if (isFormOpen) setForm(initialForm);
            setIsFormOpen(!isFormOpen);
          }}
          className={`h-10 w-10 flex items-center justify-center rounded-full transition-all ${
            isFormOpen ? "bg-coral text-white rotate-45" : "bg-ink text-sand"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </header>

      {isFormOpen && (
        <form onSubmit={submit} className="rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-ink/5 space-y-6 animate-in fade-in slide-in-from-top-4">
          <header>
            <h2 className="text-lg font-black tracking-tight text-ink">
              {form.id ? "Editar Conta" : "Nova Conta Fixa"}
            </h2>
          </header>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Nome</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                value={form.nome}
                onChange={(event) => setForm((prev) => ({ ...prev, nome: event.target.value }))}
                required
                placeholder="Ex.: Aluguel"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Dia Vencimento</label>
                <input
                  className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                  type="number"
                  min="1"
                  max="31"
                  value={form.dia_vencimento}
                  onChange={(event) => setForm((prev) => ({ ...prev, dia_vencimento: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Valor Previsto</label>
                <input
                  className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.valor_previsto}
                  onChange={(event) => setForm((prev) => ({ ...prev, valor_previsto: event.target.value }))}
                  placeholder="0,00"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Atribuição</label>
                <select
                  className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                  value={form.atribuicao}
                  onChange={(event) => setForm((prev) => ({ ...prev, atribuicao: event.target.value }))}
                >
                  {atribuicoes.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <CategoryPicker
                label="Categoria"
                value={form.categoria}
                onChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
                required
                allowCreate
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Alertas (dias antes)</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                value={form.avisar_dias_antes}
                onChange={(event) => setForm((prev) => ({ ...prev, avisar_dias_antes: event.target.value }))}
                placeholder="5,2"
              />
            </div>

            <label className="flex items-center gap-3 p-4 rounded-2xl bg-sand/20 ring-1 ring-ink/5 cursor-pointer active:scale-[0.98] transition-all">
              <input
                type="checkbox"
                className="w-5 h-5 rounded-md border-ink/10 text-ink focus:ring-pine"
                checked={form.ativo}
                onChange={(event) => setForm((prev) => ({ ...prev, ativo: event.target.checked }))}
              />
              <span className="text-sm font-bold text-ink/60">Conta Ativa</span>
            </label>
          </div>

          <div className="flex gap-3">
            <button type="submit" className="flex-1 h-14 rounded-2xl bg-ink text-sm font-black uppercase tracking-widest text-sand shadow-lg active:scale-95 transition-all">
              {form.id ? "Atualizar" : "Salvar"}
            </button>
            <button
              type="button"
              className="h-14 rounded-2xl px-6 bg-sand text-sm font-black uppercase tracking-widest text-ink ring-1 ring-ink/5 active:scale-95 transition-all"
              onClick={() => {
                setForm(initialForm);
                setIsFormOpen(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {message && <p className="rounded-2xl bg-mint/20 p-4 text-center text-xs font-black uppercase tracking-widest text-pine animate-pulse">{message}</p>}
      {error && <p className="rounded-2xl bg-coral/10 p-4 text-center text-xs font-black uppercase tracking-widest text-coral">{error}</p>}

      <section className="space-y-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40 ml-1">Lista de Compromissos</h2>
        
        {loading && <p className="text-center py-10 text-ink/20 animate-pulse font-black uppercase tracking-widest text-xs">Carregando dados...</p>}
        
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <article key={row.id} className={`group relative overflow-hidden rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md ${!row.ativo && "opacity-50 grayscale"}`}>
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-xl font-black tracking-tight text-ink">{row.nome}</h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-sand px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-ink/40">
                      Dia {row.dia_vencimento}
                    </span>
                    <span className="rounded-full bg-sand px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-ink/40">
                      {row.atribuicao}
                    </span>
                    <span className="rounded-full bg-pine/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-pine">
                      {row.categoria}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-ink/30">Previsto</p>
                  <p className="text-lg font-black tracking-tighter text-ink">
                    {row.valor_previsto ? row.valor_previsto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "---"}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex gap-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                <button
                  onClick={() => editRow(row)}
                  className="flex-1 h-10 rounded-xl bg-ink text-[10px] font-bold uppercase tracking-widest text-sand shadow-sm active:scale-95 transition-all"
                >
                  Editar
                </button>
                <button
                  onClick={() => removeRow(row.id)}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-coral/10 text-coral active:scale-95 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.34 6.61m-6.83 0-.34-6.61M18.6 1.83a2.41 2.41 0 0 0-3.37 0c-.062.062-.11.124-.145.187L14.737 4.5H9.263l-.348-2.483a2.403 2.403 0 0 0-.145-.187 2.41 2.41 0 0 0-3.37 0c-.868.868-.908 2.238-.113 3.111l.245.272H18.473l.245-.272c.795-.873.755-2.243-.113-3.111ZM4.735 8.25h14.53l-1.074 12.422A2.25 2.25 0 0 1 15.945 22.5H8.055a2.25 2.25 0 0 1-2.246-1.828L4.735 8.25Z" />
                  </svg>
                </button>
              </div>
              
              {!row.ativo && <div className="absolute inset-0 bg-sand/20 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/20 -rotate-12">Desativada</span>
              </div>}
            </article>
          ))}
        </div>
        
        {!loading && rows.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-sand flex items-center justify-center text-ink/10">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/30">Nenhuma conta fixa cadastrada</p>
          </div>
        )}
      </section>
    </section>
  );
}
