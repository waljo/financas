"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  flushLancamentosOutbox,
  getLancamentosOutboxCount,
  subscribeLancamentosOutboxChange
} from "@/lib/offline/lancamentosOutbox";

const primaryLinks = [
  {
    href: "/",
    label: "Início",
    icon: (active: boolean) => (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    )
  },
  {
    href: "/cartoes",
    label: "Cartões",
    icon: (active: boolean) => (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    )
  }
];

const moreLinks = [
  { href: "/relatorios", label: "Relatórios" },
  { href: "/categorias", label: "Categorias" },
  { href: "/importar", label: "Importar" },
  { href: "/contas-fixas", label: "Contas fixas" }
];

type SyncStatus = {
  online: boolean | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingOps: number;
  failedOps: number;
  conflicts: number;
  cache: {
    lancamentos: {
      count: number;
      syncedAt: string | null;
      fresh: boolean;
      ttlMs: number;
    };
  };
};

function formatDateTime(value: string | null): string {
  if (!value) return "S/D";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "S/D";
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getSyncBadgeText(deviceOnline: boolean, syncStatus: SyncStatus | null): string {
  if (!deviceOnline) return "Offline";
  if (syncStatus?.online === false) return "Sem conexão";
  return "Online";
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const launchActive = pathname === "/lancar";
  const [moreOpen, setMoreOpen] = useState(false);
  const [repairLoading, setRepairLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [deviceOnline, setDeviceOnline] = useState(true);
  const [pendingOfflineWrites, setPendingOfflineWrites] = useState(0);
  const [flushingOfflineWrites, setFlushingOfflineWrites] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const moreRouteActive = moreLinks.some((item) => item.href === pathname);

  const probeDeviceOnline = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.navigator.onLine) {
      setDeviceOnline(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`/api/health?ts=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal
      });
      setDeviceOnline(response.ok);
    } catch {
      setDeviceOnline(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDeviceOnline(window.navigator.onLine);
    void probeDeviceOnline();

    const update = () => {
      void probeDeviceOnline();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    const interval = window.setInterval(() => {
      void probeDeviceOnline();
    }, 30000);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.clearInterval(interval);
    };
  }, [probeDeviceOnline]);

  useEffect(() => {
    setPendingOfflineWrites(getLancamentosOutboxCount());
    const unsubscribe = subscribeLancamentosOutboxChange((count) => {
      setPendingOfflineWrites(count);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      } catch {
        // Registro silencioso: o app continua funcional sem offline cache.
      }
    })();
  }, []);

  async function loadSyncStatus(options?: { checkConnection?: boolean; silent?: boolean }) {
    if (!options?.silent) {
      setSyncStatusLoading(true);
    }

    try {
      const query = options?.checkConnection ? "?checkConnection=true" : "";
      const response = await fetch(`/api/sync/status${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar status da sincronização");
      }
      setSyncStatus(payload.data ?? null);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Erro ao consultar status da sincronização"
      });
    } finally {
      if (!options?.silent) {
        setSyncStatusLoading(false);
      }
    }
  }

  const flushOfflineWrites = useCallback(
    async (options?: { silent?: boolean }) => {
      if (flushingOfflineWrites) {
        return { applied: 0, dropped: 0, remaining: pendingOfflineWrites, stoppedByOffline: false };
      }
      if (typeof window !== "undefined" && !window.navigator.onLine) {
        return { applied: 0, dropped: 0, remaining: pendingOfflineWrites, stoppedByOffline: true };
      }

      setFlushingOfflineWrites(true);
      try {
        const result = await flushLancamentosOutbox();
        setPendingOfflineWrites(result.remaining);

        if (!options?.silent && result.applied > 0) {
          setNotice({
            tone: "success",
            message: `${result.applied} lançamento(s) offline sincronizado(s).`
          });
        }
        if (!options?.silent && result.dropped > 0) {
          setNotice({
            tone: "error",
            message: `${result.dropped} operação(ões) offline inválida(s) foram descartadas.`
          });
        }
        if (result.applied > 0) {
          router.refresh();
        }
        return result;
      } finally {
        setFlushingOfflineWrites(false);
      }
    },
    [flushingOfflineWrites, pendingOfflineWrites, router]
  );

  useEffect(() => {
    void loadSyncStatus({ silent: true });
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    void loadSyncStatus({ checkConnection: true });
  }, [moreOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      void flushOfflineWrites();
      void loadSyncStatus({ checkConnection: true, silent: true });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [flushOfflineWrites]);

  useEffect(() => {
    if (!deviceOnline) return;
    if (pendingOfflineWrites <= 0) return;
    void flushOfflineWrites({ silent: true });
  }, [deviceOnline, pendingOfflineWrites, flushOfflineWrites]);

  async function repairConnection() {
    if (repairLoading) return;
    try {
      setRepairLoading(true);
      const response = await fetch("/api/bootstrap", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao reparar conexão");
      }
      setNotice({
        tone: "success",
        message: payload.message ?? "Conexão reparada com sucesso."
      });
      setMoreOpen(false);
      await loadSyncStatus({ checkConnection: true, silent: true });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Erro ao reparar conexão"
      });
    } finally {
      setRepairLoading(false);
    }
  }

  async function runSyncNow() {
    if (syncLoading) return;
    try {
      setSyncLoading(true);
      const outboxResult = await flushOfflineWrites({ silent: true });
      const response = await fetch("/api/sync/run", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao sincronizar agora");
      }

      setNotice({
        tone: "success",
        message:
          outboxResult.applied > 0
            ? `${outboxResult.applied} offline + ${payload.message ?? "Sincronização concluída."}`
            : payload.message ?? "Sincronização concluída."
      });

      setMoreOpen(false);
      await loadSyncStatus({ checkConnection: true, silent: true });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Erro ao sincronizar agora"
      });
    } finally {
      setSyncLoading(false);
    }
  }

  const syncBadgeText = getSyncBadgeText(deviceOnline, syncStatus);

  return (
    <>
      <nav className="sticky top-0 z-40 w-full border-b border-ink/5 bg-sand/80 px-6 h-14 flex items-center justify-between backdrop-blur-md">
        <span className="text-sm font-black uppercase tracking-widest text-ink/40">FinançasG</span>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
            syncBadgeText === "Online" ? "bg-pine/15 text-pine" : "bg-coral/15 text-coral"
          }`}
        >
          {syncBadgeText}
        </span>
      </nav>

      {moreOpen ? (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-[45] cursor-default bg-transparent"
        />
      ) : null}

      <nav className="fixed bottom-0 left-0 z-50 w-full px-0 pb-2 pt-0">
        <div className="relative flex w-full flex-col items-center border-t border-ink/10 bg-white/75 px-6 pb-2 pt-7 shadow-xl backdrop-blur-xl">
          <Link
            href="/lancar"
            className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-3 shadow-2xl ring-1 transition-all ${
              launchActive ? "bg-ink text-sand scale-110 ring-ink/20" : "bg-pine text-white ring-white/60"
            }`}
            aria-label="Lançar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </Link>

          <div className="flex w-full items-end justify-center gap-7">
            {primaryLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link key={link.href} href={link.href} className="flex flex-col items-center gap-1 transition-all">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                      active ? "bg-ink/10 text-ink" : "text-ink/45"
                    }`}
                  >
                    {link.icon(active)}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? "opacity-100" : "opacity-0"}`}>
                    {link.label}
                  </span>
                </Link>
              );
            })}

            <div className="relative flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-all"
                aria-label="Mais"
                aria-expanded={moreOpen}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                    moreRouteActive || moreOpen ? "bg-ink/10 text-ink" : "text-ink/45"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </span>
              </button>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${moreRouteActive || moreOpen ? "opacity-100" : "opacity-0"}`}>
                Mais
              </span>

              {moreOpen && (
                <div className="absolute bottom-full right-1/2 z-20 mb-3 w-56 translate-x-1/2 rounded-2xl border border-ink/10 bg-white/95 p-2 shadow-2xl backdrop-blur-xl">
                  {moreLinks.map((item) => (
                    <Link key={item.href} href={item.href} className="block rounded-xl px-3 py-2 text-sm font-semibold text-ink/80 hover:bg-sand">
                      {item.label}
                    </Link>
                  ))}

                  <div className="my-1 border-t border-ink/10" />

                  <div className="rounded-xl bg-sand/70 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-ink/45">Sincronização</p>
                    <p className="mt-1 text-[11px] font-semibold text-ink/70">
                      {syncStatusLoading
                        ? "Atualizando status..."
                        : syncStatus?.online === false
                          ? "Conexão com Sheets indisponível"
                          : "Conexão com Sheets OK"}
                    </p>
                    {!deviceOnline ? <p className="text-[11px] text-coral">Offline: leitura por cache local.</p> : null}
                    {pendingOfflineWrites > 0 ? (
                      <p className="text-[11px] text-coral">
                        {pendingOfflineWrites} pendência(s) de lançamento offline.
                      </p>
                    ) : null}
                    <p className="text-[11px] text-ink/60">Última sync: {formatDateTime(syncStatus?.lastSuccessAt ?? null)}</p>
                    <p className="text-[11px] text-ink/60">Cache lançamentos: {syncStatus?.cache?.lancamentos.count ?? 0}</p>
                  </div>

                  <button
                    type="button"
                    onClick={runSyncNow}
                    disabled={syncLoading || flushingOfflineWrites}
                    className="mt-1 block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink/80 hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {syncLoading || flushingOfflineWrites ? "Sincronizando..." : "Sincronizar agora"}
                  </button>

                  <button
                    type="button"
                    onClick={repairConnection}
                    disabled={repairLoading}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink/80 hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {repairLoading ? "Reparando..." : "Reparar conexão"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {notice && (
        <div className="fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setNotice(null)}
            className={`w-full max-w-sm rounded-2xl p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl ${
              notice.tone === "success" ? "bg-pine animate-bounce" : "bg-coral"
            }`}
          >
            {notice.message}
          </button>
        </div>
      )}
    </>
  );
}
