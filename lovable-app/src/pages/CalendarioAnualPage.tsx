import { FormEvent, useEffect, useState } from "react";
import { CategoryPicker } from "../components/CategoryPicker";
import type { CalendarioAnual } from "../types";

const atribuicoes = ["WALKER", "DEA", "AMBOS", "AMBOS_I"] as const;

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
  "Janeiro",
  "Fevereiro",
  "Marco",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro"
];

type ApiPayload<T> = {
  data: T;
  message?: string;
};

export default function CalendarioAnualPage() {
  const [rows, setRows] = useState<CalendarioAnual[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<CalendarioForm>(initialForm);
  const [isFormOpen, setIsFormOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/calendario-anual");
      const payload = (await response.json()) as ApiPayload<CalendarioAnual[]>;
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar calendario anual");
      setRows(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
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

      const method = form.id ? "PUT" : "POST";
      const response = await fetch("/api/calendario-anual", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as ApiPayload<unknown>;
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

    try {
      const response = await fetch(`/api/calendario-anual?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as ApiPayload<unknown>;
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir evento anual");

      setMessage("Excluido.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    }
  }

  return (
    <section className="space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Calendario Anual</h1>
          <p className="text-sm font-medium text-ink/50">Planejamento de despesas sazonais</p>
        </div>
        <button
          onClick={() => {
            if (isFormOpen) setForm(initialForm);
            setIsFormOpen(!isFormOpen);
          }}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
            isFormOpen ? "rotate-45 bg-coral text-white" : "bg-ink text-sand"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </header>

      {isFormOpen ? (
        <form
          onSubmit={submit}
          className="animate-in slide-in-from-top-4 space-y-6 rounded-[2rem] bg-white p-8 shadow-sm ring-1 ring-ink/5 fade-in"
        >
          <header>
            <h2 className="text-lg font-black tracking-tight text-ink">{form.id ? "Editar Planejamento" : "Novo Evento Sazonal"}</h2>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Mes</label>
              <select
                className="h-14 w-full appearance-none rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
                value={form.mes}
                onChange={(event) => setForm((prev) => ({ ...prev, mes: event.target.value }))}
                required
              >
                {nomesMeses.map((nome, i) => (
                  <option key={nome} value={i + 1}>
                    {nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Dia (Opcional)</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
                type="number"
                min="1"
                max="31"
                value={form.dia_mes}
                onChange={(event) => setForm((prev) => ({ ...prev, dia_mes: event.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Evento / Despesa</label>
            <input
              className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
              value={form.evento}
              onChange={(event) => setForm((prev) => ({ ...prev, evento: event.target.value }))}
              required
              placeholder="Ex.: IPVA, Seguro, Aniversario..."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Valor Estimado</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
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
              <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Atribuicao</label>
              <select
                className="h-14 w-full appearance-none rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
                value={form.atribuicao}
                onChange={(event) => setForm((prev) => ({ ...prev, atribuicao: event.target.value }))}
              >
                {atribuicoes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
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
              <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Avisos (dias antes)</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
                value={form.avisar_dias_antes}
                onChange={(event) => setForm((prev) => ({ ...prev, avisar_dias_antes: event.target.value }))}
                placeholder="10,5,2"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-ink/40">Observacao</label>
            <textarea
              className="min-h-24 w-full resize-none rounded-2xl bg-sand/30 p-5 text-sm font-bold ring-1 ring-ink/10 outline-none transition-all focus:ring-2 focus:ring-pine"
              value={form.observacao}
              onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
              placeholder="Notas adicionais..."
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="h-14 flex-1 rounded-2xl bg-ink text-sm font-black uppercase tracking-widest text-sand shadow-lg transition-all active:scale-95"
            >
              {form.id ? "Atualizar" : "Salvar no Plano"}
            </button>
            <button
              type="button"
              className="h-14 rounded-2xl bg-sand px-6 text-sm font-black uppercase tracking-widest text-ink ring-1 ring-ink/5 transition-all active:scale-95"
              onClick={() => {
                setForm(initialForm);
                setIsFormOpen(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {message ? (
        <p className="animate-pulse rounded-2xl bg-mint/20 p-4 text-center text-xs font-black uppercase tracking-widest text-pine">
          {message}
        </p>
      ) : null}
      {error ? <p className="rounded-2xl bg-coral/10 p-4 text-center text-xs font-black uppercase tracking-widest text-coral">{error}</p> : null}

      <section className="space-y-6">
        {loading ? (
          <p className="animate-pulse py-10 text-center text-xs font-black uppercase tracking-widest text-ink/20">Carregando plano...</p>
        ) : null}

        {nomesMeses.map((nomeMes, index) => {
          const eventosDoMes = rows.filter((row) => row.mes === index + 1);
          if (eventosDoMes.length === 0) return null;

          return (
            <div key={nomeMes} className="space-y-3">
              <h2 className="ml-2 text-[10px] font-black uppercase tracking-[0.2em] text-ink/30">{nomeMes}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {eventosDoMes.map((row) => (
                  <article
                    key={row.id}
                    className="group relative overflow-hidden rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md"
                  >
                    <div className="flex items-start justify-between">
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

                    <div className="mt-4 flex translate-y-2 gap-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                      <button
                        onClick={() => editRow(row)}
                        className="h-10 flex-1 rounded-xl bg-ink text-[10px] font-bold uppercase tracking-widest text-sand shadow-sm transition-all active:scale-95"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => void removeRow(row.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-coral/10 text-coral transition-all active:scale-95"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="h-5 w-5"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m14.74 9-.34 6.61m-6.83 0-.34-6.61M18.6 1.83a2.41 2.41 0 0 0-3.37 0c-.062.062-.11.124-.145.187L14.737 4.5H9.263l-.348-2.483a2.403 2.403 0 0 0-.145-.187 2.41 2.41 0 0 0-3.37 0c-.868.868-.908 2.238-.113 3.111l.245.272H18.473l.245-.272c.795-.873.755-2.243-.113-3.111ZM4.735 8.25h14.53l-1.074 12.422A2.25 2.25 0 0 1 15.945 22.5H8.055a2.25 2.25 0 0 1-2.246-1.828L4.735 8.25Z"
                          />
                        </svg>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}

        {!loading && rows.length === 0 ? (
          <div className="space-y-4 py-20 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sand text-ink/10">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
                />
              </svg>
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-ink/30">Nenhum evento sazonal planejado</p>
          </div>
        ) : null}
      </section>
    </section>
  );
}
