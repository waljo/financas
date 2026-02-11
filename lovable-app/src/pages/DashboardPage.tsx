import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import type { DashboardData, Lancamento, SyncStatus } from "../types";

type ApiResponse<T> = { data: T };

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<DashboardData | null>(null);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [filterText, setFilterText] = useState("");

  const filteredLancamentos = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return lancamentos;
    return lancamentos.filter((item) =>
      `${item.descricao} ${item.categoria}`.toLowerCase().includes(q)
    );
  }, [lancamentos, filterText]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [dashboardPayload, lancamentosPayload, syncPayload] = await Promise.all([
        apiFetch<ApiResponse<DashboardData>>(`/api/dashboard?mes=${month}`),
        apiFetch<ApiResponse<Lancamento[]>>(`/api/lancamentos?mes=${month}`),
        apiFetch<ApiResponse<SyncStatus>>(`/api/sync/status`)
      ]);

      setData(dashboardPayload.data);
      setLancamentos(lancamentosPayload.data ?? []);
      setStatus(syncPayload.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch("/api/sync/run", { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [month]);

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
    }
    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-ink">Dashboard</h1>
          <p className="text-xs font-bold uppercase tracking-widest text-ink/40">
            Migracao Lovable: React + Vite + TypeScript + Tailwind
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
              online ? "bg-pine/15 text-pine" : "bg-coral/15 text-coral"
            }`}
          >
            {online ? "Online" : "Offline"}
          </span>
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="rounded-xl bg-ink px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
          >
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/40">Mes</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold ring-1 ring-ink/10 outline-none"
          />
        </label>

        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/40">Filtro lancamentos</span>
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Buscar descricao/categoria..."
            className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold ring-1 ring-ink/10 outline-none"
          />
        </label>
      </section>

      {error ? (
        <article className="rounded-2xl border border-coral/30 bg-coral/10 p-4 text-sm font-bold text-coral">
          {error}
        </article>
      ) : null}

      {loading ? (
        <article className="rounded-2xl border border-ink/10 bg-white p-5 text-sm font-bold text-ink/60">Carregando...</article>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Saldo mes</p>
              <p className="mt-2 text-xl font-black text-ink">{money(data.saldoMes)}</p>
            </article>
            <article className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Receitas</p>
              <p className="mt-2 text-xl font-black text-pine">{money(data.receitasMes)}</p>
            </article>
            <article className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Despesas</p>
              <p className="mt-2 text-xl font-black text-coral">{money(data.despesasMes)}</p>
            </article>
            <article className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Balanço</p>
              <p className="mt-2 text-xl font-black text-ink">{money(data.diferencaBalanco)}</p>
            </article>
          </section>

          <section className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
            <h2 className="text-sm font-black uppercase tracking-widest text-ink/60">Projecao 90 dias</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <p className="text-xs font-bold text-ink/70">Receitas previstas: {money(data.projecao90Dias.receitasPrevistas)}</p>
              <p className="text-xs font-bold text-ink/70">Despesas walker: {money(data.projecao90Dias.despesasWalkerPrevistas)}</p>
              <p className="text-xs font-black text-ink">Saldo projetado: {money(data.projecao90Dias.saldoProjetado)}</p>
            </div>
          </section>

          <section className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
            <h2 className="text-sm font-black uppercase tracking-widest text-ink/60">Lancamentos ({filteredLancamentos.length})</h2>
            <div className="mt-4 space-y-2">
              {filteredLancamentos.slice(0, 80).map((item) => (
                <article key={item.id} className="flex items-center justify-between rounded-2xl bg-sand/50 px-4 py-3">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="truncate text-sm font-black text-ink">{item.descricao}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">
                      {item.data} · {item.categoria}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-ink">{money(item.valor)}</p>
                </article>
              ))}

              {filteredLancamentos.length === 0 ? (
                <p className="py-10 text-center text-xs font-bold uppercase tracking-wider text-ink/30">
                  Nenhum lancamento encontrado
                </p>
              ) : null}
            </div>
          </section>

          {status ? (
            <section className="rounded-3xl bg-white p-5 ring-1 ring-ink/5">
              <h2 className="text-sm font-black uppercase tracking-widest text-ink/60">Status de sincronizacao</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <p className="text-xs font-bold text-ink/70">Online API: {status.online ? "sim" : "nao"}</p>
                <p className="text-xs font-bold text-ink/70">Pendencias: {status.pendingOps}</p>
                <p className="text-xs font-bold text-ink/70">Falhas: {status.failedOps}</p>
                <p className="text-xs font-bold text-ink/70">
                  Ultimo sucesso: {status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString("pt-BR") : "-"}
                </p>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
