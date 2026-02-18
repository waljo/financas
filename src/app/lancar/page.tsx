"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ContaFixa, Lancamento } from "@/lib/types";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import type { LocalLancamentoRecord } from "@/lib/mobileOffline/db";
import {
  enqueueLancamentoLocal,
  queueLancamentoDeleteLocal,
  queueLancamentoUpdateLocal,
  readLancamentosLocaisByMonth
} from "@/lib/mobileOffline/queue";
import { MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY } from "@/lib/mobileOffline/storageKeys";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateForMonth(month: string, day: number) {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  const maxDay = new Date(year, monthNumber, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), maxDay);
  return `${month}-${String(safeDay).padStart(2, "0")}`;
}

function dateWithMonth(date: string, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return date;
  }
  const dayRaw = Number(date.slice(8, 10));
  const safeDay = Number.isFinite(dayRaw) && dayRaw > 0 ? dayRaw : 1;
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  const maxDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(safeDay, maxDay)).padStart(2, "0")}`;
}

function parseIsoDate(value: string) {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return new Date(year, month - 1, day);
}

function diffDays(from: string, to: string) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / oneDay);
}

function formatDateBr(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function parseMoneyInput(value: string) {
  return Number(value.replace(",", ".").trim());
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

function writeCachedContasFixas(contas: ContaFixa[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CONTAS_FIXAS_CACHE_KEY, JSON.stringify(contas));
  } catch {
    // Ignora falhas de cache local.
  }
}

function mergeLancamentosById(remote: Lancamento[], localRecords: LocalLancamentoRecord[]) {
  const output = new Map<string, Lancamento>();

  for (const record of remote) {
    output.set(record.id, record);
  }

  for (const record of localRecords) {
    output.set(record.id, {
      ...record.payload,
      id: record.id,
      created_at: record.payload.created_at ?? record.created_at,
      updated_at: record.payload.updated_at ?? record.updated_at
    });
  }

  return [...output.values()];
}

const atribuicoes = ["WALKER", "DEA", "AMBOS", "AMBOS_I"];
const metodos = ["pix", "cartao", "dinheiro", "transferencia", "outro"];

type FormState = {
  data: string;
  tipo: Lancamento["tipo"];
  descricao: string;
  categoria: string;
  valor: string;
  atribuicao: Lancamento["atribuicao"];
  metodo: Lancamento["metodo"];
  parcela_total: string;
  parcela_numero: string;
  observacao: string;
  quem_pagou: Lancamento["quem_pagou"];
};

type LancarMode = "despesa_avulsa" | "despesa_fixa" | "receita";

type FixedStatus = {
  label: string;
  tone: "mint" | "coral" | "amber" | "ink";
};

type ReceitaEditForm = {
  data: string;
  descricao: string;
  categoria: string;
  valor: string;
  observacao: string;
};

const fixedStatusClass: Record<FixedStatus["tone"], string> = {
  mint: "bg-mint/20 text-pine",
  coral: "bg-coral/20 text-coral",
  amber: "bg-amber-100 text-amber-800",
  ink: "bg-ink/10 text-ink/60"
};

export default function LancarPage() {
  const { mobileOfflineMode } = useFeatureFlags();
  const [today] = useState(() => todayIso());
  const currentMonth = useMemo(() => today.slice(0, 7), [today]);
  const [receitasMonth, setReceitasMonth] = useState(currentMonth);

  const initialState = useMemo<FormState>(
    () => ({
      data: today,
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
    }),
    [today]
  );

  const [form, setForm] = useState(initialState);
  const [mode, setMode] = useState<LancarMode | null>(null);
  const [contasFixas, setContasFixas] = useState<ContaFixa[]>([]);
  const [lancamentosMes, setLancamentosMes] = useState<Lancamento[]>([]);
  const [fixedValues, setFixedValues] = useState<Record<string, string>>({});
  const [loadingData, setLoadingData] = useState(false);
  const [savingFixedKey, setSavingFixedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingReceitas, setLoadingReceitas] = useState(false);
  const [receitasMes, setReceitasMes] = useState<Lancamento[]>([]);
  const [editingReceitaId, setEditingReceitaId] = useState<string | null>(null);
  const [savingReceitaId, setSavingReceitaId] = useState<string | null>(null);
  const [receitaEditForm, setReceitaEditForm] = useState<ReceitaEditForm>({
    data: `${currentMonth}-01`,
    descricao: "",
    categoria: "RECEITAS",
    valor: "",
    observacao: ""
  });
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError("");
    try {
      const localRecords = mobileOfflineMode ? await readLancamentosLocaisByMonth(currentMonth) : [];
      const [contasResponse, lancamentosResponse] = await Promise.all([
        fetch("/api/contas-fixas"),
        fetch(`/api/lancamentos?mes=${currentMonth}`)
      ]);

      const contasPayload = await contasResponse.json();
      if (!contasResponse.ok) {
        throw new Error(contasPayload.message ?? "Erro ao carregar contas fixas");
      }

      const lancamentosPayload = await lancamentosResponse.json();
      if (!lancamentosResponse.ok) {
        throw new Error(lancamentosPayload.message ?? "Erro ao carregar lancamentos do mes");
      }

      const activeContas = ((contasPayload.data ?? []) as ContaFixa[]).filter((item) => item.ativo);
      const remoteLancamentos = (lancamentosPayload.data ?? []) as Lancamento[];
      const mergedLancamentos = mobileOfflineMode
        ? mergeLancamentosById(remoteLancamentos, localRecords)
        : remoteLancamentos;

      setContasFixas(activeContas);
      if (mobileOfflineMode) {
        writeCachedContasFixas(activeContas);
      }
      setLancamentosMes(mergedLancamentos);

      setFixedValues((prev) => {
        const next: Record<string, string> = {};
        for (const conta of activeContas) {
          next[conta.id] = prev[conta.id] ?? (conta.valor_previsto !== null ? String(conta.valor_previsto) : "");
        }
        return next;
      });
    } catch (err) {
      let usedLocalFallback = false;
      if (mobileOfflineMode) {
        try {
          const cachedContas = readCachedContasFixas();
          if (cachedContas.length > 0) {
            setContasFixas(cachedContas.filter((item) => item.ativo));
          }

          const localOnly = await readLancamentosLocaisByMonth(currentMonth);
          setLancamentosMes(
            localOnly.map((record) => ({
              ...record.payload,
              id: record.id,
              created_at: record.payload.created_at ?? record.created_at,
              updated_at: record.payload.updated_at ?? record.updated_at
            }))
          );
          usedLocalFallback = localOnly.length > 0 || cachedContas.length > 0;
        } catch {
          // Sem fallback adicional.
        }
      }
      if (!usedLocalFallback) {
        setError(err instanceof Error ? err.message : "Erro ao carregar dados da tela");
      }
    } finally {
      setLoadingData(false);
    }
  }, [currentMonth, mobileOfflineMode]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadReceitas = useCallback(async (month: string) => {
    setLoadingReceitas(true);
    setError("");
    try {
      const localRecords = mobileOfflineMode ? await readLancamentosLocaisByMonth(month) : [];
      const response = await fetch(`/api/lancamentos?mes=${month}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Erro ao carregar receitas");
      }

      const remoteLancamentos = (payload.data ?? []) as Lancamento[];
      const mergedLancamentos = mobileOfflineMode
        ? mergeLancamentosById(remoteLancamentos, localRecords)
        : remoteLancamentos;

      const receitas = mergedLancamentos
        .filter((item) => item.tipo === "receita")
        .sort((a, b) => b.data.localeCompare(a.data));
      setReceitasMes(receitas);
    } catch (err) {
      let usedLocalFallback = false;
      if (mobileOfflineMode) {
        try {
          const localOnly = await readLancamentosLocaisByMonth(month);
          const receitas = localOnly
            .map((record) => ({
              ...record.payload,
              id: record.id,
              created_at: record.payload.created_at ?? record.created_at,
              updated_at: record.payload.updated_at ?? record.updated_at
            }))
            .filter((item) => item.tipo === "receita")
            .sort((a, b) => b.data.localeCompare(a.data));
          setReceitasMes(receitas);
          usedLocalFallback = true;
        } catch {
          // Sem fallback adicional.
        }
      }
      if (!usedLocalFallback) {
        setError(err instanceof Error ? err.message : "Erro ao carregar receitas");
      }
    } finally {
      setLoadingReceitas(false);
    }
  }, [mobileOfflineMode]);

  useEffect(() => {
    if (mode !== "receita") return;
    void loadReceitas(receitasMonth);
  }, [mode, receitasMonth, loadReceitas]);

  const launchCountByConta = useMemo(() => {
    const output = new Map<string, number>();
    for (const lancamento of lancamentosMes) {
      if (lancamento.tipo !== "despesa") continue;
      const match = lancamento.observacao?.match(/\[CONTA_FIXA:([^\]]+)\]/);
      if (!match) continue;
      const contaId = match[1];
      output.set(contaId, (output.get(contaId) ?? 0) + 1);
    }
    return output;
  }, [lancamentosMes]);

  const dueDateByConta = useMemo(() => {
    const output = new Map<string, string>();
    for (const conta of contasFixas) {
      output.set(conta.id, dueDateForMonth(currentMonth, conta.dia_vencimento));
    }
    return output;
  }, [contasFixas, currentMonth]);

  const contasOrdenadas = useMemo(
    () =>
      [...contasFixas].sort((a, b) =>
        (dueDateByConta.get(a.id) ?? "").localeCompare(dueDateByConta.get(b.id) ?? "")
      ),
    [contasFixas, dueDateByConta]
  );

  const contasLancadasNoMes = useMemo(
    () => contasFixas.filter((item) => (launchCountByConta.get(item.id) ?? 0) > 0).length,
    [contasFixas, launchCountByConta]
  );

  function fixedStatus(contaId: string): FixedStatus {
    const launchedCount = launchCountByConta.get(contaId) ?? 0;
    if (launchedCount > 0) {
      return {
        label: launchedCount > 1 ? `Lancada (${launchedCount}x)` : "Lancada",
        tone: "mint"
      };
    }

    const dueDate = dueDateByConta.get(contaId) ?? `${currentMonth}-01`;
    const days = diffDays(today, dueDate);
    if (days < 0) return { label: "Vencida", tone: "coral" };
    if (days === 0) return { label: "Vence hoje", tone: "amber" };
    if (days <= 7) return { label: "Próx. 7 dias", tone: "amber" };
    return { label: "No prazo", tone: "ink" };
  }

  function selectMode(nextMode: LancarMode) {
    setMode(nextMode);
    setMessage("");
    setError("");

    setForm((prev) => {
      if (nextMode === "receita") {
        return {
          ...prev,
          data: dateWithMonth(prev.data || `${receitasMonth}-01`, receitasMonth),
          tipo: "receita",
          atribuicao: "WALKER",
          quem_pagou: "WALKER",
          parcela_total: "",
          parcela_numero: "",
          categoria: prev.categoria || "RECEITAS"
        };
      }

      return {
        ...prev,
        tipo: "despesa",
        categoria: prev.categoria === "RECEITAS" ? "" : prev.categoria
      };
    });
  }

function handleReceitasMonthChange(nextMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(nextMonth)) return;
    setReceitasMonth(nextMonth);
    setEditingReceitaId(null);
    setForm((prev) =>
      mode === "receita"
        ? {
            ...prev,
            data: dateWithMonth(prev.data || `${nextMonth}-01`, nextMonth)
          }
        : prev
    );
  }

  function startEditReceita(item: Lancamento) {
    setEditingReceitaId(item.id);
    setReceitaEditForm({
      data: item.data,
      descricao: item.descricao,
      categoria: item.categoria || "RECEITAS",
      valor: String(item.valor),
      observacao: item.observacao ?? ""
    });
  }

  function cancelEditReceita() {
    setEditingReceitaId(null);
  }

  async function saveReceitaEdit(id: string) {
    const receitaAtual = receitasMes.find((item) => item.id === id);
    if (!receitaAtual) {
      setError("Receita não encontrada para edição.");
      return;
    }

    const valor = parseMoneyInput(receitaEditForm.valor);
    if (!Number.isFinite(valor) || valor === 0) {
      setError("Valor precisa ser diferente de zero.");
      return;
    }

    setSavingReceitaId(id);
    setError("");
    setMessage("");

    try {
      const payload = {
        id,
        data: dateWithMonth(receitaEditForm.data || `${receitasMonth}-01`, receitasMonth),
        tipo: "receita" as const,
        descricao: receitaEditForm.descricao.trim(),
        categoria: receitaEditForm.categoria.trim() || "RECEITAS",
        valor,
        atribuicao: "WALKER" as const,
        metodo: receitaAtual.metodo || "outro",
        parcela_total: null,
        parcela_numero: null,
        observacao: receitaEditForm.observacao ?? "",
        quem_pagou: "WALKER" as const
      };

      if (mobileOfflineMode) {
        await queueLancamentoUpdateLocal({
          ...receitaAtual,
          ...payload,
          created_at: receitaAtual.created_at,
          updated_at: new Date().toISOString()
        });
        setMessage("Receita atualizada localmente. Use Sync para enviar.");
        setEditingReceitaId(null);
        await Promise.all([loadReceitas(receitasMonth), loadData()]);
        return;
      }

      const response = await fetch("/api/lancamentos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao atualizar receita");
      }

      setMessage("Receita atualizada com sucesso.");
      setEditingReceitaId(null);
      await Promise.all([loadReceitas(receitasMonth), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar receita");
    } finally {
      setSavingReceitaId(null);
    }
  }

  async function deleteReceita(id: string) {
    const confirmed = confirm("Excluir esta receita?");
    if (!confirmed) return;

    setError("");
    setMessage("");
    setSavingReceitaId(id);

    try {
      if (mobileOfflineMode) {
        await queueLancamentoDeleteLocal(id);
        setMessage("Receita removida localmente. Use Sync para enviar.");
        if (editingReceitaId === id) {
          setEditingReceitaId(null);
        }
        await Promise.all([loadReceitas(receitasMonth), loadData()]);
        return;
      }

      const response = await fetch(`/api/lancamentos?id=${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao excluir receita");
      }

      setMessage("Receita excluída com sucesso.");
      if (editingReceitaId === id) {
        setEditingReceitaId(null);
      }
      await Promise.all([loadReceitas(receitasMonth), loadData()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir receita");
    } finally {
      setSavingReceitaId(null);
    }
  }

  async function launchFixed(conta: ContaFixa, action: "today" | "due") {
    setError("");
    setMessage("");

    const value = parseMoneyInput(fixedValues[conta.id] ?? "");
    if (!Number.isFinite(value) || value === 0) {
      setError(`Informe um valor válido para ${conta.nome}.`);
      return;
    }

    const dueDate = dueDateByConta.get(conta.id) ?? dueDateForMonth(currentMonth, conta.dia_vencimento);
    const targetDate = action === "today" ? today : dueDate;
    const launchedCount = launchCountByConta.get(conta.id) ?? 0;
    if (launchedCount > 0) {
      const confirmed = confirm(`${conta.nome} já foi lançada. Lançar novamente?`);
      if (!confirmed) return;
    }

    const saveKey = `${conta.id}:${action}`;
    setSavingFixedKey(saveKey);

    try {
      const payload: Omit<Lancamento, "id" | "created_at" | "updated_at"> = {
        data: targetDate,
        tipo: "despesa",
        descricao: conta.nome,
        categoria: conta.categoria || "CONTAS_FIXAS",
        valor: value,
        atribuicao: conta.atribuicao,
        metodo: "outro",
        parcela_total: null,
        parcela_numero: null,
        observacao: `[CONTA_FIXA:${conta.id}] Lançado pelo quadro de contas fixas`,
        quem_pagou: conta.quem_pagou || "WALKER"
      };

      if (mobileOfflineMode) {
        await enqueueLancamentoLocal(payload);
      } else {
        const response = await fetch("/api/lancamentos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message ?? "Erro ao lançar conta fixa");
        }
      }

      setMessage(
        mobileOfflineMode
          ? `"${conta.nome}" salva localmente. Abra Sync para sincronizar.`
          : `"${conta.nome}" salva com sucesso.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao lançar conta fixa");
    } finally {
      setSavingFixedKey("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode !== "despesa_avulsa" && mode !== "receita") return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const tipo: Lancamento["tipo"] = mode === "receita" ? "receita" : "despesa";
      const valor = parseMoneyInput(form.valor);
      if (!Number.isFinite(valor) || valor === 0) {
        throw new Error("Valor precisa ser diferente de zero.");
      }

      const payload = {
        ...form,
        data: tipo === "receita" ? dateWithMonth(form.data, receitasMonth) : form.data,
        tipo,
        atribuicao: tipo === "receita" ? "WALKER" : form.atribuicao,
        quem_pagou: tipo === "receita" ? "WALKER" : form.quem_pagou,
        valor,
        parcela_total: tipo === "despesa" && form.parcela_total ? Number(form.parcela_total) : null,
        parcela_numero: tipo === "despesa" && form.parcela_numero ? Number(form.parcela_numero) : null
      };

      if (mobileOfflineMode) {
        await enqueueLancamentoLocal(payload);
      } else {
        const response = await fetch("/api/lancamentos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.message ?? "Erro ao salvar lançamento");
        }
      }

      setMessage(
        mobileOfflineMode
          ? "Lançamento salvo localmente. Use Sync para enviar ao Google Sheets."
          : "Lançamento salvo com sucesso."
      );
      setForm(
        mode === "receita"
          ? {
              ...initialState,
              data: dateWithMonth(initialState.data, receitasMonth),
              tipo: "receita",
              atribuicao: "WALKER",
              quem_pagou: "WALKER",
              categoria: "RECEITAS"
            }
          : { ...initialState, tipo: "despesa" }
      );
      await Promise.all([loadData(), tipo === "receita" ? loadReceitas(receitasMonth) : Promise.resolve()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-8 pb-20">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Novo lançamento</h1>
        <p className="text-sm font-medium text-ink/50">Como você quer registrar hoje?</p>
        {mobileOfflineMode ? (
          <p className="mt-2 inline-flex rounded-full bg-ink/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink/70">
            Mobile offline ativo: salva local e sincroniza sob demanda
          </p>
        ) : null}
      </header>

      {/* Mode Selector - Premium Cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => selectMode("despesa_avulsa")}
          className={[
            "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all active:scale-95",
            mode === "despesa_avulsa" 
              ? "border-ink bg-ink text-sand shadow-lg" 
              : "border-ink/5 bg-white text-ink shadow-sm hover:border-ink/20"
          ].join(" ")}
        >
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-widest opacity-50 group-hover:opacity-80">Avulsa</p>
            <p className="mt-1 text-lg font-black tracking-tight">Despesa</p>
          </div>
          {mode === "despesa_avulsa" && (
            <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/10 blur-xl" />
          )}
        </button>

        <button
          type="button"
          onClick={() => selectMode("despesa_fixa")}
          className={[
            "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all active:scale-95",
            mode === "despesa_fixa" 
              ? "border-pine bg-pine text-white shadow-lg" 
              : "border-ink/5 bg-white text-ink shadow-sm hover:border-ink/20"
          ].join(" ")}
        >
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-widest opacity-50 group-hover:opacity-80">Fixa</p>
            <p className="mt-1 text-lg font-black tracking-tight">Vencimento</p>
          </div>
          {mode === "despesa_fixa" && (
            <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/10 blur-xl" />
          )}
        </button>

        <button
          type="button"
          onClick={() => selectMode("receita")}
          className={[
            "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all active:scale-95",
            mode === "receita" 
              ? "border-emerald-600 bg-emerald-600 text-white shadow-lg" 
              : "border-ink/5 bg-white text-ink shadow-sm hover:border-ink/20"
          ].join(" ")}
        >
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-widest opacity-50 group-hover:opacity-80">Entrada</p>
            <p className="mt-1 text-lg font-black tracking-tight">Receita</p>
          </div>
          {mode === "receita" && (
            <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-white/10 blur-xl" />
          )}
        </button>
      </section>

      {mode === "despesa_fixa" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40">Contas do Mês</h2>
              <p className="text-[10px] font-bold text-pine uppercase tracking-wider">
                {contasLancadasNoMes} de {contasFixas.length} lançadas
              </p>
            </div>
            <button
              type="button"
              className="h-8 rounded-full bg-ink/5 px-3 text-[10px] font-bold uppercase tracking-wider text-ink/60 transition-colors hover:bg-ink/10"
              onClick={loadData}
              disabled={loadingData}
            >
              {loadingData ? "Atualizando..." : "Sincronizar"}
            </button>
          </div>

          <div className="grid gap-4">
            {contasOrdenadas.map((conta) => {
              const dueDate = dueDateByConta.get(conta.id) ?? dueDateForMonth(currentMonth, conta.dia_vencimento);
              const daysUntilDue = diffDays(today, dueDate);
              const status = fixedStatus(conta.id);
              const savingToday = savingFixedKey === `${conta.id}:today`;
              const savingDue = savingFixedKey === `${conta.id}:due`;

              return (
                <article key={conta.id} className="relative overflow-hidden rounded-3xl bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-black tracking-tight text-ink">{conta.nome}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${fixedStatusClass[status.tone]}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-ink/40">
                        Vence {formatDateBr(dueDate)} 
                        <span className="ml-1 opacity-50">
                          {daysUntilDue === 0 ? " (hoje)" : daysUntilDue > 0 ? ` (em ${daysUntilDue} dias)` : ` (${Math.abs(daysUntilDue)}d atrasada)`}
                        </span>
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-ink/35">
                        Quem paga: {conta.quem_pagou}
                      </p>
                    </div>

                    <div className="w-full sm:w-40">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-ink/30 ml-1">Valor</label>
                      <input
                        className="mt-1 h-12 w-full rounded-xl bg-sand/50 px-4 text-sm font-bold ring-1 ring-ink/5 focus:ring-2 focus:ring-pine outline-none transition-all"
                        type="number"
                        step="0.01"
                        value={fixedValues[conta.id] ?? ""}
                        onChange={(event) => setFixedValues((prev) => ({ ...prev, [conta.id]: event.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="mt-6 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 h-12 rounded-xl bg-ink text-[10px] font-bold uppercase tracking-widest text-sand shadow-lg active:scale-95 transition-all disabled:opacity-50"
                      onClick={() => launchFixed(conta, "today")}
                      disabled={Boolean(savingFixedKey)}
                    >
                      {savingToday ? "Salvando..." : "Lançar Hoje"}
                    </button>
                    <button
                      type="button"
                      className="flex-1 h-12 rounded-xl bg-white text-[10px] font-bold uppercase tracking-widest text-ink ring-1 ring-ink/10 active:scale-95 transition-all disabled:opacity-50"
                      onClick={() => launchFixed(conta, "due")}
                      disabled={Boolean(savingFixedKey)}
                    >
                      {savingDue ? "Salvando..." : "Vencimento"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {(mode === "despesa_avulsa" || mode === "receita") && (
        <section className="rounded-[2.5rem] bg-white p-8 shadow-sm ring-1 ring-ink/5">
          <header className="mb-8">
            <h2 className="text-xl font-black tracking-tight text-ink">
              {mode === "receita" ? "Detalhes da Receita" : "Detalhes da Despesa"}
            </h2>
            <p className="text-sm font-bold text-ink/30">Preencha os campos abaixo com atenção.</p>
          </header>

          {mode === "receita" && (
            <section className="mb-8 space-y-4 rounded-3xl bg-sand/50 p-5 ring-1 ring-ink/5">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex-1 space-y-1">
                  <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                    Mês das receitas
                  </span>
                  <input
                    className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 transition-all focus:ring-2 focus:ring-pine outline-none"
                    type="month"
                    value={receitasMonth}
                    onChange={(event) => handleReceitasMonthChange(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="h-12 rounded-xl bg-white px-4 text-xs font-bold uppercase tracking-widest text-ink shadow-sm ring-1 ring-ink/10 active:scale-95 transition-all"
                  onClick={() => void loadReceitas(receitasMonth)}
                  disabled={loadingReceitas}
                >
                  {loadingReceitas ? "Atualizando..." : "Atualizar"}
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink/45">
                  Receitas do mês selecionado ({receitasMes.length})
                </p>
                {loadingReceitas ? (
                  <p className="text-xs font-bold text-ink/50">Carregando receitas...</p>
                ) : receitasMes.length === 0 ? (
                  <p className="rounded-2xl bg-white p-4 text-xs font-bold text-ink/50 ring-1 ring-ink/10">
                    Sem receitas lançadas neste mês.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {receitasMes.map((item) => {
                      const isEditing = editingReceitaId === item.id;
                      const isSaving = savingReceitaId === item.id;

                      if (isEditing) {
                        return (
                          <article key={item.id} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-ink/10">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="space-y-1">
                                <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                  Data
                                </span>
                                <input
                                  className="h-11 w-full rounded-xl bg-sand/30 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                                  type="date"
                                  value={receitaEditForm.data}
                                  onChange={(event) =>
                                    setReceitaEditForm((prev) => ({ ...prev, data: event.target.value }))
                                  }
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                  Valor
                                </span>
                                <input
                                  className="h-11 w-full rounded-xl bg-sand/30 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                                  type="number"
                                  step="0.01"
                                  value={receitaEditForm.valor}
                                  onChange={(event) =>
                                    setReceitaEditForm((prev) => ({ ...prev, valor: event.target.value }))
                                  }
                                />
                              </label>
                            </div>
                            <label className="space-y-1">
                              <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                Descrição
                              </span>
                              <input
                                className="h-11 w-full rounded-xl bg-sand/30 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                                value={receitaEditForm.descricao}
                                onChange={(event) =>
                                  setReceitaEditForm((prev) => ({ ...prev, descricao: event.target.value }))
                                }
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                Categoria
                              </span>
                              <input
                                className="h-11 w-full rounded-xl bg-sand/30 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                                value={receitaEditForm.categoria}
                                onChange={(event) =>
                                  setReceitaEditForm((prev) => ({ ...prev, categoria: event.target.value }))
                                }
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-ink/40">
                                Observação
                              </span>
                              <input
                                className="h-11 w-full rounded-xl bg-sand/30 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                                value={receitaEditForm.observacao}
                                onChange={(event) =>
                                  setReceitaEditForm((prev) => ({ ...prev, observacao: event.target.value }))
                                }
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="h-11 flex-1 rounded-xl bg-ink text-[10px] font-bold uppercase tracking-widest text-sand disabled:opacity-50"
                                onClick={() => void saveReceitaEdit(item.id)}
                                disabled={isSaving}
                              >
                                {isSaving ? "Salvando..." : "Salvar alterações"}
                              </button>
                              <button
                                type="button"
                                className="h-11 rounded-xl bg-white px-4 text-[10px] font-bold uppercase tracking-widest text-ink ring-1 ring-ink/15"
                                onClick={cancelEditReceita}
                                disabled={isSaving}
                              >
                                Cancelar
                              </button>
                            </div>
                          </article>
                        );
                      }

                      return (
                        <article key={item.id} className="rounded-2xl bg-white p-4 ring-1 ring-ink/10">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-black text-ink">{item.descricao}</p>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-ink/45">
                                {formatDateBr(item.data)} • {item.categoria}
                              </p>
                            </div>
                            <p className="text-sm font-black text-pine">
                              {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </p>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              className="h-10 flex-1 rounded-xl bg-white text-[10px] font-bold uppercase tracking-widest text-ink ring-1 ring-ink/15"
                              onClick={() => startEditReceita(item)}
                              disabled={Boolean(savingReceitaId)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="h-10 flex-1 rounded-xl bg-coral/10 text-[10px] font-bold uppercase tracking-widest text-coral ring-1 ring-coral/30"
                              onClick={() => void deleteReceita(item.id)}
                              disabled={Boolean(savingReceitaId)}
                            >
                              {savingReceitaId === item.id ? "Excluindo..." : "Excluir"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          <form onSubmit={submit} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Data</label>
                <input
                  className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                  type="date"
                  value={form.data}
                  onChange={(event) => setForm((prev) => ({ ...prev, data: event.target.value }))}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Valor</label>
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-xs font-black text-ink/20">R$</span>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 pl-11 pr-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    type="number"
                    step="0.01"
                    value={form.valor}
                    onChange={(event) => setForm((prev) => ({ ...prev, valor: event.target.value }))}
                    required
                    placeholder="0,00"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Descrição</label>
              <input
                className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                value={form.descricao}
                onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
                required
                placeholder="Ex.: Mercado Semanal"
              />
            </div>

            <div className="space-y-1">
              <CategoryPicker
                label="Categoria"
                value={form.categoria}
                onChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
                required
                allowCreate
                placeholder={mode === "receita" ? "RECEITAS" : "Selecione..."}
              />
            </div>

            {mode === "despesa_avulsa" && (
              <>
                <div className="grid gap-6 sm:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Atribuição</label>
                    <select
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                      value={form.atribuicao}
                      onChange={(event) => setForm((prev) => ({ ...prev, atribuicao: event.target.value as Lancamento["atribuicao"] }))}
                    >
                      {atribuicoes.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Método</label>
                    <select
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                      value={form.metodo}
                      onChange={(event) => setForm((prev) => ({ ...prev, metodo: event.target.value as Lancamento["metodo"] }))}
                    >
                      {metodos.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Quem Pagou</label>
                    <select
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                      value={form.quem_pagou}
                      onChange={(event) => setForm((prev) => ({ ...prev, quem_pagou: event.target.value as Lancamento["quem_pagou"] }))}
                    >
                      <option value="WALKER">WALKER</option>
                      <option value="DEA">DEA</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Total de Parcelas</label>
                    <input
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                      type="number"
                      min="1"
                      value={form.parcela_total}
                      onChange={(event) => setForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Parcela Atual</label>
                    <input
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                      type="number"
                      min="1"
                      value={form.parcela_numero}
                      onChange={(event) => setForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
                      placeholder="1"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Observação</label>
              <textarea
                className="min-h-32 w-full rounded-2xl bg-sand/30 p-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all resize-none"
                value={form.observacao}
                onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
                placeholder="Algo mais a registrar?"
              />
            </div>

            <button
              type="submit"
              className="h-16 w-full rounded-2xl bg-ink text-sm font-black uppercase tracking-widest text-sand shadow-2xl shadow-ink/20 active:scale-[0.98] transition-all disabled:opacity-50"
              disabled={saving}
            >
              {saving ? "Salvando..." : "Finalizar Lançamento"}
            </button>
          </form>
        </section>
      )}

      {message && (
        <div className="fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setMessage("")}
            className="w-full max-w-sm rounded-2xl bg-pine p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl animate-bounce"
          >
            {message}
          </button>
        </div>
      )}
      {error && (
        <div className="fixed inset-x-0 bottom-24 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setError("")}
            className="w-full max-w-sm rounded-2xl bg-coral p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl"
          >
            {error}
          </button>
        </div>
      )}
    </section>
  );
}
