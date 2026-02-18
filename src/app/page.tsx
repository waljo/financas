"use client";

import { Fragment, useEffect, useState } from "react";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import { computeDashboard, filterByMonth } from "@/domain/calculations";
import { listLocalLancamentos, type LocalLancamentoRecord } from "@/lib/mobileOffline/db";
import { queueLancamentoDeleteLocal, queueLancamentoUpdateLocal } from "@/lib/mobileOffline/queue";
import {
  MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY,
  MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY,
  MOBILE_OFFLINE_LANCAMENTOS_CACHE_KEY,
  MOBILE_OFFLINE_RECEITAS_REGRAS_CACHE_KEY
} from "@/lib/mobileOffline/storageKeys";
import type { CalendarioAnual, ContaFixa, DashboardData, Lancamento, ReceitasRegra } from "@/lib/types";

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

function readCachedLancamentos(): Lancamento[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_LANCAMENTOS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Lancamento[];
  } catch {
    return [];
  }
}

function writeCachedLancamentos(items: Lancamento[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_LANCAMENTOS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function readCachedContasFixas(): ContaFixa[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ContaFixa[];
  } catch {
    return [];
  }
}

function writeCachedContasFixas(items: ContaFixa[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
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

function writeCachedCalendarioAnual(items: CalendarioAnual[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CALENDARIO_ANUAL_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function readCachedReceitasRegras(): ReceitasRegra[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_RECEITAS_REGRAS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ReceitasRegra[];
  } catch {
    return [];
  }
}

function writeCachedReceitasRegras(items: ReceitasRegra[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_RECEITAS_REGRAS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function fromLocalRecord(record: LocalLancamentoRecord): Lancamento {
  return {
    ...record.payload,
    id: record.id,
    created_at: record.payload.created_at ?? record.created_at,
    updated_at: record.payload.updated_at ?? record.updated_at
  };
}

function mergeLancamentosById(remote: Lancamento[], localRecords: LocalLancamentoRecord[]) {
  const byId = new Map<string, Lancamento>();
  for (const item of remote) {
    byId.set(item.id, item);
  }
  for (const record of localRecords) {
    const next = fromLocalRecord(record);
    const current = byId.get(next.id);
    if (!current || current.updated_at <= next.updated_at) {
      byId.set(next.id, next);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const dateDiff = b.data.localeCompare(a.data);
    if (dateDiff !== 0) return dateDiff;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

export default function DashboardPage() {
  const { mobileOfflineMode } = useFeatureFlags();
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
  const [showBalancoBreakdown, setShowBalancoBreakdown] = useState(false);
  const [showReceitasMesDetalhe, setShowReceitasMesDetalhe] = useState(false);
  const [showProjecaoDetalhe, setShowProjecaoDetalhe] = useState(false);
  const [showProjecaoReceitasMes, setShowProjecaoReceitasMes] = useState(false);
  const [showProjecaoDespesasDetalhe, setShowProjecaoDespesasDetalhe] = useState(false);
  const [receitaEditId, setReceitaEditId] = useState<string | null>(null);
  const [receitaEditForm, setReceitaEditForm] = useState({
    data: "",
    descricao: "",
    categoria: "",
    valor: "",
    observacao: ""
  });
  const [savingReceitaEdit, setSavingReceitaEdit] = useState(false);
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

  async function loadMobileOfflineSnapshot(
    nextMonth: string,
    overrides?: { bankBalances?: BankBalances; saldoCarteira?: string }
  ) {
    const localRecords = await listLocalLancamentos();
    const cachedLancamentos = readCachedLancamentos();
    const cachedContasFixas = readCachedContasFixas();
    const cachedCalendarioAnual = readCachedCalendarioAnual();
    const cachedReceitasRegras = readCachedReceitasRegras();
    const online = typeof navigator === "undefined" ? true : navigator.onLine;

    let remoteLancamentos: Lancamento[] | null = null;
    let remoteContasFixas: ContaFixa[] | null = null;
    let remoteCalendarioAnual: CalendarioAnual[] | null = null;
    let remoteReceitasRegras: ReceitasRegra[] | null = null;

    if (online) {
      try {
        const response = await fetch("/api/lancamentos");
        const payload = await response.json();
        if (response.ok) {
          remoteLancamentos = (payload.data ?? []) as Lancamento[];
          writeCachedLancamentos(remoteLancamentos);
        }
      } catch {
        remoteLancamentos = null;
      }

      try {
        const response = await fetch("/api/contas-fixas");
        const payload = await response.json();
        if (response.ok) {
          remoteContasFixas = (payload.data ?? []) as ContaFixa[];
          writeCachedContasFixas(remoteContasFixas);
        }
      } catch {
        remoteContasFixas = null;
      }

      try {
        const response = await fetch("/api/calendario-anual");
        const payload = await response.json();
        if (response.ok) {
          remoteCalendarioAnual = (payload.data ?? []) as CalendarioAnual[];
          writeCachedCalendarioAnual(remoteCalendarioAnual);
        }
      } catch {
        remoteCalendarioAnual = null;
      }

      try {
        const response = await fetch("/api/receitas-regras");
        const payload = await response.json();
        if (response.ok) {
          remoteReceitasRegras = (payload.data ?? []) as ReceitasRegra[];
          writeCachedReceitasRegras(remoteReceitasRegras);
        }
      } catch {
        remoteReceitasRegras = null;
      }
    }

    const baseLancamentos = remoteLancamentos ?? cachedLancamentos;
    const contasFixas = remoteContasFixas ?? cachedContasFixas;
    const calendarioAnual = remoteCalendarioAnual ?? cachedCalendarioAnual;
    const receitasRegras = remoteReceitasRegras ?? cachedReceitasRegras;
    const lancamentosAll = mergeLancamentosById(baseLancamentos, localRecords);
    const lancamentosMes = filterByMonth(lancamentosAll, nextMonth);

    if (lancamentosAll.length === 0 && contasFixas.length === 0) {
      throw new Error("Sem dados locais para montar o dashboard. Conecte uma vez para carregar a base inicial.");
    }

    const currentBankBalances = overrides?.bankBalances ?? bankBalances;
    const currentSaldoCarteira = overrides?.saldoCarteira ?? saldoCarteira;
    const saldoBanco = BANK_BALANCE_FIELDS.reduce(
      (acc, item) => acc + parseInputNumber(currentBankBalances[item.key]),
      0
    );
    const saldoCarteiraNum = parseInputNumber(currentSaldoCarteira);

    const dashboard = computeDashboard({
      month: nextMonth,
      lancamentos: lancamentosAll,
      cartaoMovimentos: [],
      contasFixas,
      calendarioAnual,
      receitasRegras,
      saldoBanco,
      saldoCarteira: saldoCarteiraNum,
      fonteSaldoReal: "manual"
    });

    return {
      dashboard,
      lancamentosMes
    };
  }

  async function fetchDashboard(
    nextMonth: string,
    options?: { skipLoading?: boolean; bankBalances?: BankBalances; saldoCarteira?: string }
  ) {
    const shouldManageLoading = !options?.skipLoading;
    if (shouldManageLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      if (mobileOfflineMode) {
        const snapshot = await loadMobileOfflineSnapshot(nextMonth, {
          bankBalances: options?.bankBalances,
          saldoCarteira: options?.saldoCarteira
        });
        setData(snapshot.dashboard);
        setLancamentos(snapshot.lancamentosMes);
        setPage(1);
        return;
      }

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
      if (mobileOfflineMode) {
        saveManualBalance(month, bankBalances, saldoCarteira);
        await fetchDashboard(month, { skipLoading: true });
        setOperationMessage("Saldo atualizado localmente.");
        return;
      }

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
      if (mobileOfflineMode) {
        const snapshot = await loadMobileOfflineSnapshot(nextMonth);
        setLancamentos(snapshot.lancamentosMes);
        setPage(1);
        return;
      }

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
    const nextBankBalances = stored?.bankBalances ?? createEmptyBankBalances();
    const nextSaldoCarteira = stored?.saldoCarteira ?? "";
    if (stored) {
      setBankBalances(stored.bankBalances);
      setSaldoCarteira(stored.saldoCarteira);
    } else {
      setBankBalances(createEmptyBankBalances());
      setSaldoCarteira("");
    }
    setShowBalancoBreakdown(false);
    setShowReceitasMesDetalhe(false);
    setShowProjecaoDetalhe(false);
    setShowProjecaoReceitasMes(false);
    setShowProjecaoDespesasDetalhe(false);
    setReceitaEditId(null);
    setEditId(null);
    void fetchDashboard(month, {
      bankBalances: nextBankBalances,
      saldoCarteira: nextSaldoCarteira
    });
    if (!mobileOfflineMode) {
      void fetchLancamentos(month);
    }
  }, [month, mobileOfflineMode]);

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

  function startReceitaEdit(item: Lancamento) {
    if (item.tipo !== "receita") return;
    setError(null);
    setReceitaEditId(item.id);
    setReceitaEditForm({
      data: item.data,
      descricao: item.descricao,
      categoria: item.categoria,
      valor: String(item.valor),
      observacao: item.observacao ?? ""
    });
  }

  function cancelReceitaEdit() {
    setReceitaEditId(null);
  }

  async function saveReceitaEdit(item: Lancamento) {
    if (savingReceitaEdit || item.tipo !== "receita") return;

    try {
      setSavingReceitaEdit(true);
      setError(null);
      const valor = Number(receitaEditForm.valor);
      if (!Number.isFinite(valor) || valor === 0) {
        throw new Error("Informe um valor valido para continuar.");
      }

      const payload = {
        id: item.id,
        data: receitaEditForm.data,
        tipo: "receita" as const,
        descricao: receitaEditForm.descricao,
        categoria: receitaEditForm.categoria,
        valor,
        atribuicao: item.atribuicao,
        metodo: item.metodo,
        parcela_total: null,
        parcela_numero: null,
        observacao: receitaEditForm.observacao,
        quem_pagou: item.quem_pagou
      };

      if (mobileOfflineMode) {
        await queueLancamentoUpdateLocal({
          ...item,
          ...payload,
          created_at: item.created_at,
          updated_at: new Date().toISOString()
        });
        setReceitaEditId(null);
        setOperationMessage("Receita atualizada localmente. Use Sync para enviar.");
        await fetchDashboard(month);
        return;
      }

      const response = await fetch("/api/lancamentos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Falha ao atualizar receita");
      }
      setReceitaEditId(null);
      setOperationMessage("Receita atualizada com sucesso.");
      await fetchLancamentos(month);
      await fetchDashboard(month);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar receita");
    } finally {
      setSavingReceitaEdit(false);
    }
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

      if (mobileOfflineMode) {
        const current = lancamentos.find((item) => item.id === editId);
        if (!current) {
          throw new Error("Lancamento nao encontrado para edicao local.");
        }
        await queueLancamentoUpdateLocal({
          ...current,
          data: payload.data,
          tipo: payload.tipo as Lancamento["tipo"],
          descricao: payload.descricao,
          categoria: payload.categoria,
          valor: payload.valor,
          atribuicao: payload.atribuicao as Lancamento["atribuicao"],
          metodo: payload.metodo as Lancamento["metodo"],
          parcela_total: payload.parcela_total,
          parcela_numero: payload.parcela_numero,
          observacao: payload.observacao,
          quem_pagou: payload.quem_pagou as Lancamento["quem_pagou"],
          created_at: current.created_at,
          updated_at: new Date().toISOString()
        });
        setEditId(null);
        setOperationMessage("Lancamento atualizado localmente. Use Sync para enviar.");
        await fetchDashboard(month);
        return;
      }

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

      if (mobileOfflineMode) {
        await queueLancamentoDeleteLocal(id);
        await fetchDashboard(month);
        setOperationMessage("Lancamento excluido localmente. Use Sync para enviar.");
        return;
      }

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
  const receitasMesDetalhe = lancamentos
    .filter((item) => item.tipo === "receita")
    .sort((a, b) => b.data.localeCompare(a.data));

  const cards = [
    { id: "receitas_mes", label: "Receitas do mes", value: data?.receitasMes ?? 0 },
    { id: "despesas_mes", label: "Despesas do mes", value: data?.despesasMes ?? 0 },
    { id: "saldo_mes", label: "Saldo do mes", value: data?.saldoMes ?? 0 },
    { id: "dea", label: deaLabel, value: deaValue },
    { id: "saldo_apos_dea", label: "Saldo apos acerto DEA", value: data?.saldoAposAcertoDEA ?? 0 },
    { id: "saldo_sistema", label: "Saldo sistema", value: data?.balancoSistema ?? 0 },
    {
      id: "saldo_real",
      label: mobileOfflineMode ? "SALDO REAL (LOCAL)" : "SALDO REAL (VEM DA PLANILHA)",
      value: data?.balancoReal ?? 0
    },
    { id: "projecao_90", label: "Projecao 90 dias", value: data?.projecao90Dias?.saldoProjetado ?? 0 }
  ] as const;

  const balancoBreakdownCards = cards.filter((card) => card.id === "saldo_sistema" || card.id === "saldo_real");
  const secondaryCards = cards.filter(
    (card) =>
      !["receitas_mes", "despesas_mes", "saldo_sistema", "saldo_real", "projecao_90"].includes(card.id)
  );

  return (
    <section className="space-y-8 pb-20">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Início</h1>
          <p className="text-sm font-medium text-ink/50">Bom dia, Walker</p>
          {mobileOfflineMode ? (
            <p className="mt-2 inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink/70">
              Dashboard local-first ativo
            </p>
          ) : null}
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
          <button
            type="button"
            aria-expanded={showBalancoBreakdown}
            aria-controls="balanco-breakdown"
            onClick={() => setShowBalancoBreakdown((prev) => !prev)}
            className={`relative w-full overflow-hidden rounded-[2rem] p-8 text-left shadow-2xl transition-all focus:outline-none focus:ring-2 focus:ring-white/80 ${
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
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wider text-white/75">
                {showBalancoBreakdown ? "Ocultar saldos de auditoria" : "Toque para ver saldo sistema e saldo real"}
              </p>
            </div>
            {/* Abstract shapes for premium feel */}
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-black/10 blur-3xl" />
          </button>

          {showBalancoBreakdown ? (
            <div id="balanco-breakdown" className="grid gap-4 md:grid-cols-2 animate-[bounce_0.45s_ease-in-out_1]">
              {balancoBreakdownCards.map((card) => (
                <article key={card.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink/35">{card.label}</p>
                  <p className="mt-2 text-xl font-black tracking-tight text-ink">
                    {card.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </p>
                </article>
              ))}
            </div>
          ) : null}

          {/* Quick Summary Grid */}
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              aria-expanded={showReceitasMesDetalhe}
              aria-controls="receitas-mes-detalhe"
              onClick={() => setShowReceitasMesDetalhe((prev) => !prev)}
              className="rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Receitas</p>
              <p className="mt-1 text-lg font-bold text-pine">
                {data?.receitasMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) ?? "R$ 0,00"}
              </p>
              <p className="mt-2 text-[11px] font-semibold text-ink/45">
                {showReceitasMesDetalhe ? "Ocultar detalhamento" : "Toque para detalhar receitas"}
              </p>
            </button>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Despesas</p>
              <p className="mt-1 text-lg font-bold text-coral">
                {data?.despesasMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) ?? "R$ 0,00"}
              </p>
            </div>
          </div>

          {showReceitasMesDetalhe ? (
            <div id="receitas-mes-detalhe" className="rounded-2xl border border-pine/20 bg-pine/5 p-4 animate-[bounce_0.45s_ease-in-out_1]">
              <p className="text-xs font-bold uppercase tracking-wider text-pine">Detalhamento das receitas do mes</p>
              {loadingLanc ? (
                <p className="mt-2 text-sm text-ink/60">Carregando receitas...</p>
              ) : receitasMesDetalhe.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">Sem receitas lançadas para este mês.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {receitasMesDetalhe.map((item) => (
                    <li key={item.id} className="rounded-lg bg-white/70 px-3 py-2">
                      {receitaEditId === item.id ? (
                        <div className="space-y-2">
                          <div className="grid gap-2 md:grid-cols-2">
                            <label className="text-xs">
                              Data
                              <input
                                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                                type="date"
                                value={receitaEditForm.data}
                                onChange={(event) =>
                                  setReceitaEditForm((prev) => ({ ...prev, data: event.target.value }))
                                }
                              />
                            </label>
                            <label className="text-xs">
                              Valor
                              <input
                                className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                                type="number"
                                step="0.01"
                                value={receitaEditForm.valor}
                                onChange={(event) =>
                                  setReceitaEditForm((prev) => ({ ...prev, valor: event.target.value }))
                                }
                              />
                            </label>
                          </div>
                          <label className="block text-xs">
                            Descricao
                            <input
                              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                              value={receitaEditForm.descricao}
                              onChange={(event) =>
                                setReceitaEditForm((prev) => ({ ...prev, descricao: event.target.value }))
                              }
                            />
                          </label>
                          <label className="block text-xs">
                            Categoria
                            <input
                              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                              value={receitaEditForm.categoria}
                              onChange={(event) =>
                                setReceitaEditForm((prev) => ({ ...prev, categoria: event.target.value }))
                              }
                            />
                          </label>
                          <label className="block text-xs">
                            Observacao
                            <input
                              className="mt-1 w-full rounded-lg border border-ink/20 px-2 py-1"
                              value={receitaEditForm.observacao}
                              onChange={(event) =>
                                setReceitaEditForm((prev) => ({ ...prev, observacao: event.target.value }))
                              }
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-sand disabled:opacity-50"
                              onClick={() => saveReceitaEdit(item)}
                              disabled={savingReceitaEdit}
                            >
                              {savingReceitaEdit ? "Salvando..." : "Salvar"}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-ink/30 px-3 py-1 text-xs"
                              onClick={cancelReceitaEdit}
                              disabled={savingReceitaEdit}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-ink/70">
                            {item.data} - {item.descricao}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink">
                              {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                            <button
                              type="button"
                              className="rounded border border-ink/20 px-2 py-1 text-xs"
                              onClick={() => startReceitaEdit(item)}
                            >
                              Editar
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}

      {/* Secondary Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        {secondaryCards.map((card) => (
          <article key={card.id} className="group rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink/30 group-hover:text-ink/50 transition-colors">{card.label}</p>
            <p className="mt-2 text-xl font-black tracking-tight text-ink">
              {card.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </article>
        ))}
      </div>

      {data?.projecao90Dias ? (
        <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
          <button
            type="button"
            aria-expanded={showProjecaoDetalhe}
            aria-controls="projecao-90-detalhe"
            onClick={() => setShowProjecaoDetalhe((prev) => !prev)}
            className="w-full text-left"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Projecao 90 dias</h2>
                <p className="text-sm text-ink/70">
                  {data.projecao90Dias.periodoInicio} ate {data.projecao90Dias.periodoFim}
                </p>
                <p className="mt-1 text-xs text-ink/50">
                  Base historica: {data.projecao90Dias.periodoBaseInicio} ate {data.projecao90Dias.periodoBaseFim}
                </p>
              </div>
              <p className="text-xl font-black tracking-tight text-ink">
                {data.projecao90Dias.saldoProjetado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
            </div>
            <p className="mt-2 text-xs font-semibold text-ink/45">
              {showProjecaoDetalhe ? "Ocultar detalhamento" : "Toque para detalhar receitas e despesas"}
            </p>
          </button>

          <div
            id="projecao-90-detalhe"
            className={showProjecaoDetalhe ? "mt-4 space-y-3 animate-[bounce_0.45s_ease-in-out_1]" : "hidden"}
          >
            <button
              type="button"
              aria-expanded={showProjecaoReceitasMes}
              aria-controls="projecao-90-receitas"
              onClick={() => setShowProjecaoReceitasMes((prev) => !prev)}
              className="w-full rounded-xl border border-pine/20 bg-pine/5 px-4 py-3 text-left"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-pine">Receitas WALKER (ano anterior)</p>
              <p className="mt-1 text-lg font-black text-ink">
                {data.projecao90Dias.receitasPrevistas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-ink/55">
                {showProjecaoReceitasMes ? "Ocultar receitas por mes" : "Toque para ver receitas por mes"}
              </p>
            </button>

            {showProjecaoReceitasMes ? (
              <div id="projecao-90-receitas" className="rounded-xl border border-pine/15 bg-pine/5 p-3">
                {data.projecao90Dias.receitasWalkerPorMesAnoAnterior.length === 0 ? (
                  <p className="text-sm text-ink/70">Sem receitas no periodo base.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {data.projecao90Dias.receitasWalkerPorMesAnoAnterior.map((item) => (
                      <li key={item.mes} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                        <span className="font-semibold text-ink/70">{item.mes}</span>
                        <span className="font-bold text-ink">
                          {item.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            <button
              type="button"
              aria-expanded={showProjecaoDespesasDetalhe}
              aria-controls="projecao-90-despesas"
              onClick={() => setShowProjecaoDespesasDetalhe((prev) => !prev)}
              className="w-full rounded-xl border border-coral/20 bg-coral/5 px-4 py-3 text-left"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-coral">Despesas WALKER (composicao projetada)</p>
              <p className="mt-1 text-lg font-black text-ink">
                {data.projecao90Dias.despesasWalkerPrevistas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-ink/55">
                {showProjecaoDespesasDetalhe ? "Ocultar composicao" : "Toque para ver avulsas (cartao/parcelas) e fixas"}
              </p>
            </button>

            {showProjecaoDespesasDetalhe ? (
              <div id="projecao-90-despesas" className="rounded-xl border border-coral/15 bg-coral/5 p-3">
                <ul className="space-y-1 text-sm">
                  <li className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                    <span className="font-semibold text-ink/70">Despesas avulsas (ano anterior)</span>
                    <span className="text-right font-bold text-ink">
                      {data.projecao90Dias.despesasWalkerDetalhe.avulsas.total.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL"
                      })}{" "}
                      ({(data.projecao90Dias.despesasWalkerDetalhe.avulsas.percentual * 100).toFixed(1)}%)
                    </span>
                  </li>
                  <li className="ml-4 flex items-center justify-between rounded-lg bg-white/60 px-3 py-2">
                    <span className="font-semibold text-ink/65">Gastos com cartao</span>
                    <span className="text-right font-bold text-ink">
                      {data.projecao90Dias.despesasWalkerDetalhe.avulsas.cartao.total.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL"
                      })}
                    </span>
                  </li>
                  <li className="ml-8 flex items-center justify-between rounded-lg bg-white/50 px-3 py-2">
                    <span className="font-semibold text-ink/60">Valor parcelas</span>
                    {data.projecao90Dias.despesasWalkerDetalhe.avulsas.cartao.semDadosParcelas ||
                    data.projecao90Dias.despesasWalkerDetalhe.avulsas.cartao.valorParcelas === null ? (
                      <span className="font-bold text-ink/65">S/D</span>
                    ) : (
                      <span className="text-right font-bold text-ink">
                        {data.projecao90Dias.despesasWalkerDetalhe.avulsas.cartao.valorParcelas.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL"
                        })}
                      </span>
                    )}
                  </li>
                  <li className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                    <span className="font-semibold text-ink/70">Despesas fixas (periodo atual)</span>
                    <span className="text-right font-bold text-ink">
                      {data.projecao90Dias.despesasWalkerDetalhe.fixas.total.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL"
                      })}{" "}
                      ({(data.projecao90Dias.despesasWalkerDetalhe.fixas.percentual * 100).toFixed(1)}%)
                    </span>
                  </li>
                </ul>
                <div className="mt-3 rounded-lg bg-white/60 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-ink/55">Divisao por mes</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {data.projecao90Dias.despesasWalkerPorMes.map((item) => (
                      <li key={item.mes} className="rounded-lg bg-white/80 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-ink/75">
                            {item.mes} (base {item.mesBaseAnoAnterior})
                          </span>
                          <span className="font-black text-ink">
                            {item.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink/60">
                          Avulsas:{" "}
                          {item.avulsas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} | Fixas:{" "}
                          {item.fixas.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                        <p className="text-xs text-ink/55">
                          Cartao: {item.cartao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} |
                          Parcelas:{" "}
                          {item.semDadosParcelasCartao || item.valorParcelasCartao === null
                            ? "S/D"
                            : item.valorParcelasCartao.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL"
                              })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

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
        </div>

        {error && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-center text-xs font-bold text-coral">{error}</p>}
        {saldoConsistencyAlert && (
          <p className="mt-3 rounded-xl bg-amber-100 p-3 text-center text-xs font-bold text-amber-800">
            {saldoConsistencyAlert}
          </p>
        )}
      </section>

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
