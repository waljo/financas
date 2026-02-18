"use client";

import { FormEvent, useEffect, useState } from "react";
import type { CalendarioAnual } from "@/lib/types";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { queueCalendarioAnualDeleteLocal, queueCalendarioAnualUpsertLocal } from "@/lib/mobileOffline/queue";
import { MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY } from "@/lib/mobileOffline/storageKeys";

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

const nomesMeses = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUuid(value?: string) {
  if (value && UUID_PATTERN.test(value)) return value;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function readCachedCalendarioAnual(): CalendarioAnual[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CalendarioAnual[];
  } catch {
    return [];
  }
}

function writeCachedCalendarioAnual(rows: CalendarioAnual[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY, JSON.stringify(rows));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

export default function CalendarioAnualPage() {
  const { mobileOfflineMode } = useFeatureFlags();
  const [rows, setRows] = useState<CalendarioAnual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<CalendarioForm>(initialForm);
  const [isFormOpen, setIsFormOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const cached = mobileOfflineMode ? readCachedCalendarioAnual() : [];
    if (cached.length > 0) {
      setRows(cached);
    }
    try {
      const response = await fetch("/api/calendario-anual");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar calendário anual");
      const remoteRows = (payload.data ?? []) as CalendarioAnual[];
      setRows(remoteRows);
      if (mobileOfflineMode) {
        writeCachedCalendarioAnual(remoteRows);
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

      if (mobileOfflineMode) {
        const localId = ensureUuid(form.id);
        const localRow: CalendarioAnual = {
          id: localId,
          mes: payload.mes,
          evento: String(payload.evento).trim(),
          valor_estimado: payload.valor_estimado,
          avisar_dias_antes: String(payload.avisar_dias_antes).trim(),
          atribuicao: payload.atribuicao as CalendarioAnual["atribuicao"],
          categoria: String(payload.categoria).trim(),
          observacao: String(payload.observacao ?? "").trim(),
          dia_mes: payload.dia_mes
        };

        const nextRows = form.id
          ? rows.map((item) => (item.id === form.id ? localRow : item))
          : [localRow, ...rows];

        setRows(nextRows);
        writeCachedCalendarioAnual(nextRows);
        await queueCalendarioAnualUpsertLocal(localRow);
        setMessage(form.id ? "Evento atualizado localmente. Use Sync para enviar." : "Evento salvo localmente. Use Sync para enviar.");
        setForm(initialForm);
        setIsFormOpen(false);
        return;
      }

      const method = form.id ? "PUT" : "POST";
      const response = await fetch("/api/calendario-anual", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Erro ao salvar evento anual");

      setMessage(form.id ? "Evento atualizado." : "Evento planejado.");
      setForm(initialForm);
      setIsFormOpen(false);
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
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRow(id: string) {
    if (!confirm("Excluir este evento do planejamento?")) return;
    setError("");
    setMessage("");

    if (mobileOfflineMode) {
      const nextRows = rows.filter((item) => item.id !== id);
      setRows(nextRows);
      writeCachedCalendarioAnual(nextRows);
      await queueCalendarioAnualDeleteLocal(id);
      setMessage("Evento excluído localmente. Use Sync para enviar.");
      return;
    }

    try {
      const response = await fetch(`/api/calendario-anual?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir evento anual");

      setMessage("Excluído.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  return (
    <section className="space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Calendário Anual</h1>
          <p className="text-sm font-medium text-ink/50">Planejamento de despesas sazonais</p>
          {mobileOfflineMode ? (
            <p className="mt-2 inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink/70">
              Modo offline: alterações salvas localmente
            </p>
          ) : null}
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
              {form.id ? "Editar Planejamento" : "Novo Evento Sazonal"}
            </h2>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Mês</label>
              <select
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                value={form.mes}
                onChange={(event) => setForm((prev) => ({ ...prev, mes: event.target.value }))}
                required
              >
                {nomesMeses.map((nome, i) => (
                  <option key={nome} value={i + 1}>{nome}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Dia (Opcional)</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                type="number"
                min="1"
                max="31"
                value={form.dia_mes}
                onChange={(event) => setForm((prev) => ({ ...prev, dia_mes: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Evento / Despesa</label>
            <input
              className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
              value={form.evento}
              onChange={(event) => setForm((prev) => ({ ...prev, evento: event.target.value }))}
              required
              placeholder="Ex.: IPVA, Seguro, Aniversário..."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Valor Estimado</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                type="number"
                step="0.01"
                min="0"
                value={form.valor_estimado}
                onChange={(event) => setForm((prev) => ({ ...prev, valor_estimado: event.target.value }))}
                required
                placeholder="0,00"
              />
            </div>
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CategoryPicker
              label="Categoria"
              value={form.categoria}
              onChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
              required
              allowCreate
            />
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Avisos (dias antes)</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                value={form.avisar_dias_antes}
                onChange={(event) => setForm((prev) => ({ ...prev, avisar_dias_antes: event.target.value }))}
                placeholder="10,5,2"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Observação</label>
            <textarea
              className="min-h-24 w-full rounded-2xl bg-sand/30 p-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all resize-none"
              value={form.observacao}
              onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
              placeholder="Notas adicionais..."
            />
          </div>

          <div className="flex gap-3">
            <button type="submit" className="flex-1 h-14 rounded-2xl bg-ink text-sm font-black uppercase tracking-widest text-sand shadow-lg active:scale-95 transition-all">
              {form.id ? "Atualizar" : "Salvar no Plano"}
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

      <section className="space-y-6">
        {loading && <p className="text-center py-10 text-ink/20 animate-pulse font-black uppercase tracking-widest text-xs">Carregando plano...</p>}
        
        {nomesMeses.map((nomeMes, index) => {
          const eventosDoMes = rows.filter(r => r.mes === index + 1);
          if (eventosDoMes.length === 0) return null;

          return (
            <div key={nomeMes} className="space-y-3">
              <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/30 ml-2">{nomeMes}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {eventosDoMes.map((row) => (
                  <article key={row.id} className="group relative overflow-hidden rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <h3 className="text-lg font-black tracking-tight text-ink">{row.evento}</h3>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-sand px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-ink/40">
                            Dia {row.dia_mes ?? 1}
                          </span>
                          <span className="rounded-full bg-sand px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-ink/40">
                            {row.atribuicao}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black tracking-tighter text-ink">
                          {row.valor_estimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                        <span className="rounded-full bg-pine/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-pine">
                          {row.categoria}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
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
                  </article>
                ))}
              </div>
            </div>
          );
        })}
        
        {!loading && rows.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-sand flex items-center justify-center text-ink/10">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/30">Nenhum evento sazonal planejado</p>
          </div>
        )}
      </section>
    </section>
  );
}
