"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { readSyncDashboard, syncLancamentosNow } from "@/lib/mobileOffline/queue";
import type { LocalLancamentoRecord, SyncOpRecord, SyncStateRecord } from "@/lib/mobileOffline/db";

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

export default function SyncPage() {
  const { mobileOfflineMode } = useFeatureFlags();
  const [pendingRecords, setPendingRecords] = useState<LocalLancamentoRecord[]>([]);
  const [pendingOps, setPendingOps] = useState<SyncOpRecord[]>([]);
  const [pendingContaFixaOps, setPendingContaFixaOps] = useState(0);
  const [pendingCalendarioAnualOps, setPendingCalendarioAnualOps] = useState(0);
  const [pendingCategoriaOps, setPendingCategoriaOps] = useState(0);
  const [pendingCartaoOps, setPendingCartaoOps] = useState(0);
  const [pendingCartaoMovimentoOps, setPendingCartaoMovimentoOps] = useState(0);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [syncState, setSyncState] = useState<SyncStateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const loadDashboard = useCallback(async () => {
    if (!mobileOfflineMode) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const snapshot = await readSyncDashboard();
      setPendingRecords(snapshot.pendingRecords.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      setPendingOps(snapshot.pendingOps.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      setPendingContaFixaOps(snapshot.pendingContaFixaOps);
      setPendingCalendarioAnualOps(snapshot.pendingCalendarioAnualOps);
      setPendingCategoriaOps(snapshot.pendingCategoriaOps);
      setPendingCartaoOps(snapshot.pendingCartaoOps);
      setPendingCartaoMovimentoOps(snapshot.pendingCartaoMovimentoOps);
      setPendingTotal(snapshot.pendingCount);
      setSyncState(snapshot.syncState);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar status de sincronizacao");
    } finally {
      setLoading(false);
    }
  }, [mobileOfflineMode]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const pendingLancamentosCount = pendingRecords.length;
  const pendingCount = pendingTotal;
  const isOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  const serviceWorkerAvailable =
    typeof navigator === "undefined" ? true : "serviceWorker" in navigator;
  const secureContextOk = typeof window === "undefined" ? true : window.isSecureContext;

  const statusTone = useMemo(() => {
    switch (syncState?.last_sync_status) {
      case "success":
        return "text-pine bg-pine/10 ring-pine/20";
      case "error":
        return "text-coral bg-coral/10 ring-coral/20";
      case "syncing":
        return "text-amber-700 bg-amber-100 ring-amber-300";
      default:
        return "text-ink/70 bg-ink/5 ring-ink/10";
    }
  }, [syncState?.last_sync_status]);

  async function handleSyncNow() {
    setSyncing(true);
    setError("");
    setMessage("");

    try {
      const result = await syncLancamentosNow();
      if (result.syncedCount === 0) {
        setMessage("Sem pendências para sincronizar.");
      } else {
        setMessage(`${result.syncedCount} operação(ões) sincronizada(s) com sucesso.`);
      }
      await loadDashboard();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Falha na sincronização");
      await loadDashboard();
    } finally {
      setSyncing(false);
    }
  }

  if (!mobileOfflineMode) {
    return (
      <section className="space-y-4 pb-20">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Sync</h1>
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <p className="text-sm text-ink/70">
            O modo offline mobile está desativado. Configure <code>MOBILE_OFFLINE_MODE=true</code> para habilitar.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 pb-20">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Sync</h1>
        <p className="text-sm text-ink/60">Sincronização manual com Google Sheets legado (push em lote).</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink/45">Conectividade</p>
          <p className={`mt-2 text-sm font-bold ${isOnline ? "text-pine" : "text-coral"}`}>
            {isOnline ? "Online" : "Offline"}
          </p>
        </article>

        <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink/45">Pendentes totais</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-ink">{pendingCount}</p>
          <p className="mt-1 text-xs text-ink/55">
            Lancamentos: {pendingLancamentosCount} | Operacoes: {pendingOps.length} | Contas fixas: {pendingContaFixaOps} | Calendario: {pendingCalendarioAnualOps} | Categorias: {pendingCategoriaOps} | Cartoes: {pendingCartaoOps} | Mov. cartao: {pendingCartaoMovimentoOps}
          </p>
        </article>
      </div>

      <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink/45">Último sync</p>
            <p className="text-sm font-semibold text-ink/70">{formatDateTime(syncState?.last_sync_at ?? null)}</p>
            <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ${statusTone}`}>
              {syncState?.last_sync_status ?? "idle"}
            </span>
            {syncState?.last_sync_error ? (
              <p className="text-xs font-semibold text-coral">{syncState.last_sync_error}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing || loading || pendingCount === 0 || !isOnline}
            className="h-11 rounded-xl bg-ink px-4 text-xs font-bold uppercase tracking-widest text-sand transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        </div>
      </article>

      {!serviceWorkerAvailable || !secureContextOk ? (
        <article className="rounded-2xl bg-amber-100 p-5 shadow-sm ring-1 ring-amber-300">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Diagnóstico PWA</p>
          <p className="mt-2 text-sm font-semibold text-amber-900">
            O navegador atual não permite cache offline completo de páginas. Para funcionar offline no Android,
            abra o app por HTTPS local (ou `localhost`) e reinstale o PWA.
          </p>
        </article>
      ) : null}

      {message ? <p className="rounded-xl bg-pine/10 px-4 py-3 text-sm font-semibold text-pine">{message}</p> : null}
      {error ? <p className="rounded-xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral">{error}</p> : null}

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink/50">Fila local</h2>

        {loading ? <p className="text-sm text-ink/60">Carregando pendências...</p> : null}

        {!loading && pendingRecords.length === 0 ? (
          <p className="text-sm text-ink/60">Sem lançamentos pendentes.</p>
        ) : null}

        {!loading && pendingRecords.length > 0 ? (
          <ul className="space-y-2">
            {pendingRecords.map((record) => (
              <li key={record.id} className="rounded-xl bg-sand/40 p-3 ring-1 ring-ink/10">
                <p className="text-xs font-bold text-ink/80">{record.payload.data} • {record.payload.descricao}</p>
                <p className="text-xs text-ink/60">
                  {record.payload.tipo.toUpperCase()} • {record.payload.categoria} • {formatMoney(record.payload.valor)}
                </p>
                <p className="text-[10px] text-ink/45">ID: {record.id}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink/50">Operacoes pendentes</h2>
        {pendingOps.length === 0 ? (
          <p className="text-sm text-ink/60">Sem operacoes pendentes.</p>
        ) : (
          <ul className="space-y-2">
            {pendingOps.map((op) => (
              <li key={op.op_id} className="rounded-xl bg-sand/40 p-3 ring-1 ring-ink/10">
                <p className="text-xs font-bold text-ink/80">
                  {op.entity} • {op.action} • {op.entity_id}
                </p>
                <p className="text-[10px] text-ink/45">Atualizado em: {formatDateTime(op.updated_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
