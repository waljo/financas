"use client";

import { Fragment, useEffect, useState } from "react";
import type { DashboardData, Lancamento } from "@/lib/types";

const MANUAL_BALANCE_STORAGE_KEY = "dashboard.manual-balance.v2";
const BANK_BALANCE_FIELDS = [
  { key: "bb", label: "Saldo BB" },
  { key: "c6", label: "Saldo C6" }
] as const;

type BankBalanceKey = (typeof BANK_BALANCE_FIELDS)[number]["key"];
type BankBalances = Record<BankBalanceKey, string>;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function createEmptyBankBalances(): BankBalances {
  return { bb: "", c6: "" };
}

function normalizeBankBalances(value: unknown): BankBalances {
  const output = createEmptyBankBalances();
  if (!value || typeof value !== "object") {
    return output;
  }

  for (const item of BANK_BALANCE_FIELDS) {
    const raw = (value as Record<string, unknown>)[item.key];
    output[item.key] = typeof raw === "string" ? raw : "";
  }

  return output;
}

function hasAnyBankBalance(bankBalances: BankBalances): boolean {
  return BANK_BALANCE_FIELDS.some((item) => bankBalances[item.key].trim() !== "");
}

function parseInputNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface StoredManualBalance {
  month: string;
  bankBalances: BankBalances;
  saldoCarteira: string;
  updatedAt: string;
}

interface ManualBalanceStore {
  latest: StoredManualBalance | null;
  byMonth: Record<string, StoredManualBalance>;
}

function readManualBalanceStore(): ManualBalanceStore {
  if (typeof window === "undefined") {
    return { latest: null, byMonth: {} };
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_BALANCE_STORAGE_KEY);
    if (!raw) {
      return { latest: null, byMonth: {} };
    }

    const parsed = JSON.parse(raw) as ManualBalanceStore;
    if (!parsed || typeof parsed !== "object") {
      return { latest: null, byMonth: {} };
    }

    const byMonthRaw = parsed.byMonth ?? {};
    const byMonth = Object.fromEntries(
      Object.entries(byMonthRaw).map(([month, item]) => {
        const entry = item as
          | {
              month?: unknown;
              bankBalances?: unknown;
              saldoCarteira?: unknown;
              updatedAt?: unknown;
            }
          | undefined;

        const normalized: StoredManualBalance = {
          month: typeof entry?.month === "string" ? entry.month : month,
          bankBalances: normalizeBankBalances(entry?.bankBalances),
          saldoCarteira: typeof entry?.saldoCarteira === "string" ? entry.saldoCarteira : "",
          updatedAt: typeof entry?.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString()
        };
        return [month, normalized];
      })
    ) as Record<string, StoredManualBalance>;

    const latestRaw = parsed.latest as
      | {
          month?: unknown;
          bankBalances?: unknown;
          saldoCarteira?: unknown;
          updatedAt?: unknown;
        }
      | null
      | undefined;

    const latest: StoredManualBalance | null =
      latestRaw && typeof latestRaw.month === "string"
        ? {
            month: latestRaw.month,
            bankBalances: normalizeBankBalances(latestRaw.bankBalances),
            saldoCarteira: typeof latestRaw.saldoCarteira === "string" ? latestRaw.saldoCarteira : "",
            updatedAt: typeof latestRaw.updatedAt === "string" ? latestRaw.updatedAt : new Date(0).toISOString()
          }
        : null;

    return { latest, byMonth };
  } catch {
    return { latest: null, byMonth: {} };
  }
}

function readManualBalanceForMonth(month: string): { bankBalances: BankBalances; saldoCarteira: string } | null {
  const store = readManualBalanceStore();
  const byMonth = store.byMonth[month];
  if (byMonth) {
    return {
      bankBalances: byMonth.bankBalances,
      saldoCarteira: byMonth.saldoCarteira
    };
  }
  if (month === currentMonth() && store.latest) {
    return {
      bankBalances: store.latest.bankBalances,
      saldoCarteira: store.latest.saldoCarteira
    };
  }
  return null;
}

function saveManualBalance(month: string, bankBalances: BankBalances, saldoCarteira: string) {
  if (typeof window === "undefined") return;
  if (!hasAnyBankBalance(bankBalances) && saldoCarteira.trim() === "") return;

  const store = readManualBalanceStore();
  const entry: StoredManualBalance = {
    month,
    bankBalances,
    saldoCarteira,
    updatedAt: new Date().toISOString()
  };

  const nextStore: ManualBalanceStore = {
    latest: entry,
    byMonth: {
      ...store.byMonth,
      [month]: entry
    }
  };

  window.localStorage.setItem(MANUAL_BALANCE_STORAGE_KEY, JSON.stringify(nextStore));
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [bankBalances, setBankBalances] = useState<BankBalances>(createEmptyBankBalances());
  const [saldoCarteira, setSaldoCarteira] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLanc, setLoadingLanc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saldoConsistencyAlert, setSaldoConsistencyAlert] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [filterText, setFilterText] = useState("");
  const [filterCategoria, setFilterCategoria] = useState("todas");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortKey, setSortKey] = useState<"data" | "valor" | "descricao" | "categoria" | "tipo">("data");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    data: "",
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
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [operationMessage, setOperationMessage] = useState("");
  const [bootstrapMsg, setBootstrapMsg] = useState<string>("");

  async function fetchDashboard(nextMonth: string, options?: { skipLoading?: boolean }) {
    const shouldManageLoading = !options?.skipLoading;
    if (shouldManageLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/dashboard?mes=${nextMonth}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar dashboard");
      }
      setData(payload.data);

      const stored = readManualBalanceForMonth(nextMonth);
      if (!stored && payload.data) {
        setBankBalances((prev) => {
          if (hasAnyBankBalance(prev)) return prev;
          return {
            ...createEmptyBankBalances(),
            bb: String(payload.data.saldoBancoReferencia)
          };
        });
        setSaldoCarteira((prev) => (prev.trim() !== "" ? prev : String(payload.data.saldoCarteiraReferencia)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      if (shouldManageLoading) {
        setLoading(false);
      }
    }
  }

  async function persistLegacyBalance(nextMonth: string, nextBankBalances: BankBalances, nextSaldoCarteira: string) {
    const response = await fetch("/api/dashboard/saldo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mes: nextMonth,
        saldoBB: parseInputNumber(nextBankBalances.bb),
        saldoC6: parseInputNumber(nextBankBalances.c6),
        saldoCarteira: parseInputNumber(nextSaldoCarteira)
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message ?? "Falha ao atualizar saldo legado");
    }
  }

  async function refreshDashboard() {
    const semSaldoBancos = !hasAnyBankBalance(bankBalances);
    const semSaldoCarteira = saldoCarteira.trim() === "";
    if (semSaldoBancos && semSaldoCarteira) {
      setError("Preencha ao menos um saldo antes de atualizar para evitar gravar zero no legado.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await persistLegacyBalance(month, bankBalances, saldoCarteira);
      saveManualBalance(month, bankBalances, saldoCarteira);
      await fetchDashboard(month, { skipLoading: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar saldo real");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLancamentos(nextMonth: string) {
    setLoadingLanc(true);
    try {
      const response = await fetch(`/api/lancamentos?mes=${nextMonth}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar lancamentos");
      }
      setLancamentos(payload.data ?? []);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao carregar lancamentos");
    } finally {
      setLoadingLanc(false);
    }
  }

  useEffect(() => {
    const stored = readManualBalanceForMonth(month);
    if (stored) {
      setBankBalances(stored.bankBalances);
      setSaldoCarteira(stored.saldoCarteira);
    } else {
      setBankBalances(createEmptyBankBalances());
      setSaldoCarteira("");
    }
    setEditId(null);
    void fetchDashboard(month);
    void fetchLancamentos(month);
  }, [month]);

  useEffect(() => {
    if (!data) {
      setSaldoConsistencyAlert(null);
      return;
    }

    const saldoBancarioAtual = BANK_BALANCE_FIELDS.reduce(
      (acc, item) => acc + parseInputNumber(bankBalances[item.key]),
      0
    );
    const saldoCarteiraAtual = parseInputNumber(saldoCarteira);
    const saldoInformado = roundMoney(saldoBancarioAtual + saldoCarteiraAtual);
    const saldoRealPlanilha = roundMoney(data.balancoReal ?? 0);
    const diferenca = roundMoney(saldoRealPlanilha - saldoInformado);

    if (Math.abs(diferenca) >= 0.01) {
      setSaldoConsistencyAlert(
        `Alerta: saldo real da planilha (${saldoRealPlanilha.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL"
        })}) difere de saldo bancario + carteira (${saldoInformado.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL"
        })}) em ${Math.abs(diferenca).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`
      );
      return;
    }

    setSaldoConsistencyAlert(null);
  }, [data, bankBalances, saldoCarteira]);

  useEffect(() => {
    if (!operationMessage) return;
    const timeout = window.setTimeout(() => setOperationMessage(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [operationMessage]);

  async function bootstrapSheets() {
    setBootstrapMsg("Configurando abas...");
    const response = await fetch("/api/bootstrap", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setBootstrapMsg(payload.message ?? "Falha no bootstrap");
      return;
    }
    setBootstrapMsg("Abas normalizadas prontas.");
    await fetchDashboard(month);
  }

  function startEdit(item: Lancamento) {
    if (editId === item.id) {
      setEditId(null);
      return;
    }

    setEditId(item.id);
    setError(null);
    setEditForm({
      data: item.data,
      tipo: item.tipo,
      descricao: item.descricao,
      categoria: item.categoria,
      valor: String(item.valor),
      atribuicao: item.atribuicao,
      metodo: item.metodo,
      parcela_total: item.parcela_total ? String(item.parcela_total) : "",
      parcela_numero: item.parcela_numero ? String(item.parcela_numero) : "",
      observacao: item.observacao ?? "",
      quem_pagou: item.quem_pagou
    });
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit() {
    if (!editId || savingEdit) return;
    try {
      setSavingEdit(true);
      setError(null);
      const valor = Number(editForm.valor);
      if (!Number.isFinite(valor)) {
        throw new Error("Informe um valor valido para continuar.");
      }

      const payload = {
        id: editId,
        ...editForm,
        valor,
        parcela_total: editForm.parcela_total ? Number(editForm.parcela_total) : null,
        parcela_numero: editForm.parcela_numero ? Number(editForm.parcela_numero) : null
      };
      const response = await fetch("/api/lancamentos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Falha ao atualizar lancamento");
      }
      setEditId(null);
      setOperationMessage("Lancamento atualizado com sucesso.");
      await fetchLancamentos(month);
      await fetchDashboard(month);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar lancamento");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteLancamento(id: string) {
    if (!confirm("Excluir este lancamento?")) return;
    try {
      setError(null);
      const response = await fetch(`/api/lancamentos?id=${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Falha ao excluir lancamento");
      }
      await fetchLancamentos(month);
      await fetchDashboard(month);
      setOperationMessage("Lancamento excluido com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir lancamento");
    }
  }

  const categorias = Array.from(new Set(lancamentos.map((item) => item.categoria).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const filteredLancamentos = lancamentos.filter((item) => {
    const text = filterText.trim().toLowerCase();
    if (text) {
      const hay = `${item.descricao} ${item.categoria} ${item.observacao ?? ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    if (filterCategoria !== "todas" && item.categoria !== filterCategoria) return false;
    return true;
  });
  const sortedLancamentos = [...filteredLancamentos].sort((a, b) => {
    let av: string | number = "";
    let bv: string | number = "";
    switch (sortKey) {
      case "data":
        av = a.data;
        bv = b.data;
        break;
      case "valor":
        av = a.valor;
        bv = b.valor;
        break;
      case "descricao":
        av = a.descricao;
        bv = b.descricao;
        break;
      case "categoria":
        av = a.categoria;
        bv = b.categoria;
        break;
      case "tipo":
        av = a.tipo;
        bv = b.tipo;
        break;
    }
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
  const totalPages = Math.max(1, Math.ceil(filteredLancamentos.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * pageSize;
  const pageItems = sortedLancamentos.slice(pageStart, pageStart + pageSize);

  function legacyStatus(observacao: string) {
    const match = observacao?.match(/\[LEGADO:([A-Z_]+)\]/);
    if (!match) return { label: "Desconhecido", color: "text-ink/60" };
    const key = match[1];
    if (key === "OK") return { label: "Ok", color: "text-pine" };
    if (key === "SKIPPED") return { label: "Ignorado", color: "text-ink/60" };
    if (key === "NO_SPACE") return { label: "Sem espaco", color: "text-coral" };
    if (key === "ERROR") return { label: "Erro", color: "text-coral" };
    return { label: key, color: "text-ink/60" };
  }

  const receberPagarDEA = data?.receberPagarDEA ?? 0;
  const deaLabel = receberPagarDEA > 0 ? "Receber DEA" : receberPagarDEA < 0 ? "Pagar DEA" : "Acerto DEA";
  const deaValue = Math.abs(receberPagarDEA);
  const saldoBancosTotal = BANK_BALANCE_FIELDS.reduce((acc, item) => acc + parseInputNumber(bankBalances[item.key]), 0);
  const balancoValue = data?.diferencaBalanco ?? 0;

  const cards = [
    { label: "Receitas do mes", value: data?.receitasMes ?? 0 },
    { label: "Despesas do mes", value: data?.despesasMes ?? 0 },
    { label: "Saldo do mes", value: data?.saldoMes ?? 0 },
    { label: "Saldo apos acerto DEA", value: data?.saldoAposAcertoDEA ?? 0 },
    { label: deaLabel, value: deaValue },
    { label: "Saldo sistema", value: data?.balancoSistema ?? 0 },
    { label: "SALDO REAL (VEM DA PLANILHA)", value: data?.balancoReal ?? 0 },
    { label: "Projecao 90 dias", value: data?.projecao90Dias?.saldoProjetado ?? 0 }
  ];

  return (
    <section className="space-y-8 pb-20">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Início</h1>
          <p className="text-sm font-medium text-ink/50">Bom dia, Walker</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand ring-1 ring-ink/5">
          <span className="text-xs font-bold text-ink/40">WG</span>
        </div>
      </header>

      {/* Hero Balance */}
      {!data && loading ? (
        <div className="animate-pulse space-y-8">
          <div className="h-48 rounded-[2rem] bg-ink/5" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 rounded-2xl bg-ink/5" />
            <div className="h-24 rounded-2xl bg-ink/5" />
          </div>
        </div>
      ) : (
        <>
          <article
            className={`relative overflow-hidden rounded-[2rem] p-8 shadow-2xl transition-all ${
              balancoValue >= 0 
                ? "bg-gradient-to-br from-pine to-emerald-700 text-white" 
                : "bg-gradient-to-br from-coral to-rose-700 text-white"
            }`}
          >
            <div className="relative z-10">
              <p className="text-xs font-bold uppercase tracking-widest opacity-80">Balanço do Mês</p>
              <p className="mt-1 text-4xl font-black tracking-tighter">
                {balancoValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md w-fit">
                <span className={balancoValue >= 0 ? "text-mint" : "text-rose-200"}>
                  {balancoValue >= 0 ? "● Sistema em dia" : "● Ajuste necessário"}
                </span>
              </div>
            </div>
            {/* Abstract shapes for premium feel */}
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-black/10 blur-3xl" />
          </article>

          {/* Quick Summary Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Receitas</p>
              <p className="mt-1 text-lg font-bold text-pine">
                {data?.receitasMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) ?? "R$ 0,00"}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Despesas</p>
              <p className="mt-1 text-lg font-bold text-coral">
                {data?.despesasMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) ?? "R$ 0,00"}
              </p>
            </div>
          </div>
        </>
      )}

      {/* Manual Controls Section */}
      <section className="rounded-3xl bg-sand/50 p-6 ring-1 ring-ink/5">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-ink/40">Controle de Caixa</h2>
        <article className="mb-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Saldo bancario</p>
          <p className="mt-1 text-2xl font-black tracking-tight text-ink">
            {saldoBancosTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <p className="mt-1 text-xs text-ink/55">Soma dos saldos informados em BB e C6.</p>
        </article>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink/40 ml-1">Referência</label>
            <input
              className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 transition-all focus:ring-2 focus:ring-pine outline-none"
              type="month"
              value={month}
              onChange={(event) => {
                const nextMonth = event.target.value;
                const stored = readManualBalanceForMonth(nextMonth);
                setMonth(nextMonth);
                setBankBalances(stored?.bankBalances ?? createEmptyBankBalances());
                setSaldoCarteira(stored?.saldoCarteira ?? "");
              }}
            />
          </div>
          {BANK_BALANCE_FIELDS.map((item) => (
            <div key={item.key} className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-ink/40 ml-1">{item.label}</label>
              <input
                className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 transition-all focus:ring-2 focus:ring-pine outline-none"
                type="number"
                placeholder="0,00"
                value={bankBalances[item.key]}
                onChange={(event) =>
                  setBankBalances((prev) => ({
                    ...prev,
                    [item.key]: event.target.value
                  }))
                }
              />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-ink/40 ml-1">Carteira</label>
            <input
              className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 transition-all focus:ring-2 focus:ring-pine outline-none"
              type="number"
              placeholder="0,00"
              value={saldoCarteira}
              onChange={(event) => setSaldoCarteira(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="flex h-12 items-center justify-center rounded-xl bg-ink px-6 text-sm font-bold text-sand shadow-lg active:scale-95 transition-all disabled:opacity-50"
            onClick={refreshDashboard}
            disabled={loading}
          >
            {loading ? "Sincronizando..." : "Sincronizar Saldo"}
          </button>
          <button
            type="button"
            className="flex h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-bold text-ink shadow-sm ring-1 ring-ink/10 active:scale-95 transition-all"
            onClick={bootstrapSheets}
          >
            Reparar Conexão
          </button>
        </div>
        
        {bootstrapMsg && <p className="mt-3 text-center text-[10px] font-bold uppercase text-pine animate-pulse">{bootstrapMsg}</p>}
        {error && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-center text-xs font-bold text-coral">{error}</p>}
        {saldoConsistencyAlert && (
          <p className="mt-3 rounded-xl bg-amber-100 p-3 text-center text-xs font-bold text-amber-800">
            {saldoConsistencyAlert}
          </p>
        )}
      </section>

      {/* Secondary Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {cards.filter(c => !["Receitas do mes", "Despesas do mes"].includes(c.label)).map((card) => (
          <article key={card.label} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink/30 group-hover:text-ink/50 transition-colors">{card.label}</p>
            <p className="mt-2 text-xl font-black tracking-tight text-ink">
              {card.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </article>
        ))}
      </div>

      {data?.projecao90Dias ? (
        <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Detalhe projecao 90 dias</h2>
          <p className="text-sm text-ink/70">
            {data.projecao90Dias.periodoInicio} ate {data.projecao90Dias.periodoFim}
          </p>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <p>Receitas previstas: R$ {data.projecao90Dias.receitasPrevistas.toFixed(2)}</p>
            <p>Despesas fixas: R$ {data.projecao90Dias.despesasFixasPrevistas.toFixed(2)}</p>
            <p>Despesas sazonais: R$ {data.projecao90Dias.despesasSazonaisPrevistas.toFixed(2)}</p>
            <p>Parcelas: R$ {data.projecao90Dias.parcelasPrevistas.toFixed(2)}</p>
          </div>
        </article>
      ) : null}

      <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Lancamentos do mes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-ink/20 px-3 py-1 text-sm"
              onClick={() => fetchLancamentos(month)}
              disabled={loadingLanc}
            >
              {loadingLanc ? "Atualizando..." : "Atualizar lista"}
            </button>
            <select
              className="rounded border border-ink/20 px-2 py-1 text-sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <label className="text-sm">
            Buscar
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={filterText}
              onChange={(event) => {
                setFilterText(event.target.value);
                setPage(1);
              }}
              placeholder="Descricao, categoria, observacao"
            />
          </label>
          <label className="text-sm">
            Categoria
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={filterCategoria}
              onChange={(event) => {
                setFilterCategoria(event.target.value);
                setPage(1);
              }}
            >
              <option value="todas">Todas</option>
              {categorias.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm text-ink/70 md:mt-7">
            {filteredLancamentos.length} registro(s) filtrados
          </div>
        </div>

        {sortedLancamentos.length === 0 ? (
          <p className="mt-3 text-sm text-ink/70">Nenhum lancamento encontrado para este mes.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-left text-ink/60">
                  <th className="px-2 py-2">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSortKey("data");
                        setSortDir(sortKey === "data" && sortDir === "asc" ? "desc" : "asc");
                      }}
                    >
                      Data
                    </button>
                  </th>
                  <th className="px-2 py-2">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSortKey("tipo");
                        setSortDir(sortKey === "tipo" && sortDir === "asc" ? "desc" : "asc");
                      }}
                    >
                      Tipo
                    </button>
                  </th>
                  <th className="px-2 py-2">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSortKey("descricao");
                        setSortDir(sortKey === "descricao" && sortDir === "asc" ? "desc" : "asc");
                      }}
                    >
                      Descricao
                    </button>
                  </th>
                  <th className="px-2 py-2">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSortKey("categoria");
                        setSortDir(sortKey === "categoria" && sortDir === "asc" ? "desc" : "asc");
                      }}
                    >
                      Categoria
                    </button>
                  </th>
                  <th className="px-2 py-2">
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setSortKey("valor");
                        setSortDir(sortKey === "valor" && sortDir === "asc" ? "desc" : "asc");
                      }}
                    >
                      Valor
                    </button>
                  </th>
                  <th className="px-2 py-2">Atribuicao</th>
                  <th className="px-2 py-2">Quem pagou</th>
                  <th className="px-2 py-2">Legado</th>
                  <th className="px-2 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => {
                  const legado = legacyStatus(item.observacao ?? "");
                  const isEditing = editId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr className={`border-b border-ink/10 ${isEditing ? "bg-sand/30" : ""}`}>
                        <td className="px-2 py-2">{item.data}</td>
                        <td className="px-2 py-2">{item.tipo}</td>
                        <td className="px-2 py-2">{item.descricao}</td>
                        <td className="px-2 py-2">{item.categoria}</td>
                        <td className="px-2 py-2">
                          {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className="px-2 py-2">{item.atribuicao}</td>
                        <td className="px-2 py-2">{item.quem_pagou}</td>
                        <td className={`px-2 py-2 ${legado.color}`}>{legado.label}</td>
                        <td className="px-2 py-2">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded border border-ink/20 px-2 py-1 text-xs"
                              onClick={() => startEdit(item)}
                            >
                              {isEditing ? "Fechar" : "Editar"}
                            </button>
                            <button
                              type="button"
                              className="rounded border border-coral/40 px-2 py-1 text-xs text-coral"
                              onClick={() => deleteLancamento(item.id)}
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isEditing ? (
                        <tr className="border-b border-ink/10 bg-sand/40">
                          <td className="px-2 pb-4 pt-2" colSpan={9}>
                            <div className="rounded-2xl border border-pine/20 bg-white p-4 shadow-sm animate-[bounce_0.45s_ease-in-out_1]">
                              <h3 className="text-sm font-semibold">Editar lancamento</h3>
                              <div className="mt-3 grid gap-3 md:grid-cols-3">
                                <label className="text-sm">
                                  Data
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    type="date"
                                    value={editForm.data}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, data: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm">
                                  Tipo
                                  <select
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.tipo}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, tipo: event.target.value }))}
                                  >
                                    <option value="despesa">Despesa</option>
                                    <option value="receita">Receita</option>
                                  </select>
                                </label>
                                <label className="text-sm">
                                  Valor
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    type="number"
                                    step="0.01"
                                    value={editForm.valor}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, valor: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm md:col-span-2">
                                  Descricao
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.descricao}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, descricao: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm">
                                  Categoria
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.categoria}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, categoria: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm">
                                  Atribuicao
                                  <select
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.atribuicao}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, atribuicao: event.target.value }))}
                                  >
                                    <option value="WALKER">WALKER</option>
                                    <option value="DEA">DEA</option>
                                    <option value="AMBOS">AMBOS</option>
                                    <option value="AMBOS_I">AMBOS_I</option>
                                  </select>
                                </label>
                                <label className="text-sm">
                                  Metodo
                                  <select
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.metodo}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, metodo: event.target.value }))}
                                  >
                                    <option value="pix">pix</option>
                                    <option value="cartao">cartao</option>
                                    <option value="dinheiro">dinheiro</option>
                                    <option value="transferencia">transferencia</option>
                                    <option value="outro">outro</option>
                                  </select>
                                </label>
                                <label className="text-sm">
                                  Quem pagou
                                  <select
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.quem_pagou}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, quem_pagou: event.target.value }))}
                                  >
                                    <option value="WALKER">WALKER</option>
                                    <option value="DEA">DEA</option>
                                  </select>
                                </label>
                                <label className="text-sm">
                                  Parcela total
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    type="number"
                                    min="1"
                                    value={editForm.parcela_total}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm">
                                  Numero da parcela
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    type="number"
                                    min="1"
                                    value={editForm.parcela_numero}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
                                  />
                                </label>
                                <label className="text-sm md:col-span-3">
                                  Observacao
                                  <input
                                    className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                                    value={editForm.observacao}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, observacao: event.target.value }))}
                                  />
                                </label>
                              </div>
                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  className="rounded-lg bg-ink px-4 py-2 text-sand disabled:opacity-50"
                                  onClick={saveEdit}
                                  disabled={savingEdit}
                                >
                                  {savingEdit ? "Salvando..." : "Salvar"}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-ink/30 px-4 py-2"
                                  onClick={cancelEdit}
                                  disabled={savingEdit}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span>
                Pagina {pageSafe} de {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-ink/20 px-3 py-1"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={pageSafe <= 1}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="rounded border border-ink/20 px-3 py-1"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={pageSafe >= totalPages}
                >
                  Proxima
                </button>
              </div>
            </div>
          </div>
        )}
      </article>

      {operationMessage && (
        <div className="fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setOperationMessage("")}
            className="w-full max-w-sm rounded-2xl bg-pine p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl animate-bounce"
          >
            {operationMessage}
          </button>
        </div>
      )}
    </section>
  );
}
