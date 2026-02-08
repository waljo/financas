"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { ContaFixa, Lancamento } from "@/lib/types";
import { CategoryPicker } from "@/components/CategoryPicker";

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

const fixedStatusClass: Record<FixedStatus["tone"], string> = {
  mint: "bg-mint/40 text-ink",
  coral: "bg-coral/20 text-coral",
  amber: "bg-amber-100 text-amber-800",
  ink: "bg-ink/10 text-ink"
};

export default function LancarPage() {
  const [today] = useState(() => todayIso());
  const currentMonth = useMemo(() => today.slice(0, 7), [today]);

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
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError("");
    try {
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
      setContasFixas(activeContas);
      setLancamentosMes((lancamentosPayload.data ?? []) as Lancamento[]);

      setFixedValues((prev) => {
        const next: Record<string, string> = {};
        for (const conta of activeContas) {
          next[conta.id] = prev[conta.id] ?? (conta.valor_previsto !== null ? String(conta.valor_previsto) : "");
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados da tela");
    } finally {
      setLoadingData(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        label: launchedCount > 1 ? `Ja lancada (${launchedCount}x)` : "Ja lancada",
        tone: "mint"
      };
    }

    const dueDate = dueDateByConta.get(contaId) ?? `${currentMonth}-01`;
    const days = diffDays(today, dueDate);
    if (days < 0) return { label: "Vencida", tone: "coral" };
    if (days === 0) return { label: "Vence hoje", tone: "amber" };
    if (days <= 7) return { label: "Prox. 7 dias", tone: "amber" };
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

  async function launchFixed(conta: ContaFixa, action: "today" | "due") {
    setError("");
    setMessage("");

    const value = parseMoneyInput(fixedValues[conta.id] ?? "");
    if (!Number.isFinite(value) || value === 0) {
      setError(`Informe um valor valido para ${conta.nome} antes de lancar.`);
      return;
    }

    const dueDate = dueDateByConta.get(conta.id) ?? dueDateForMonth(currentMonth, conta.dia_vencimento);
    const targetDate = action === "today" ? today : dueDate;
    const launchedCount = launchCountByConta.get(conta.id) ?? 0;
    if (launchedCount > 0) {
      const confirmed = confirm(`${conta.nome} ja foi lancada neste mes. Deseja lancar novamente?`);
      if (!confirmed) return;
    }

    const saveKey = `${conta.id}:${action}`;
    setSavingFixedKey(saveKey);

    try {
      const payload = {
        data: targetDate,
        tipo: "despesa",
        descricao: conta.nome,
        categoria: conta.categoria || "CONTAS_FIXAS",
        valor: value,
        atribuicao: conta.atribuicao,
        metodo: "outro",
        parcela_total: null,
        parcela_numero: null,
        observacao: `[CONTA_FIXA:${conta.id}] Lancado pelo quadro de contas fixas`,
        quem_pagou: "WALKER"
      };

      const response = await fetch("/api/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao lancar conta fixa");
      }

      setMessage(`Conta fixa "${conta.nome}" lancada para ${formatDateBr(targetDate)}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao lancar conta fixa");
    } finally {
      setSavingFixedKey("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode !== "despesa_avulsa" && mode !== "receita") {
      setError("Selecione Despesas avulsas ou Receitas para abrir o formulario.");
      return;
    }

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
        tipo,
        atribuicao: tipo === "receita" ? "WALKER" : form.atribuicao,
        quem_pagou: tipo === "receita" ? "WALKER" : form.quem_pagou,
        valor,
        parcela_total: tipo === "despesa" && form.parcela_total ? Number(form.parcela_total) : null,
        parcela_numero: tipo === "despesa" && form.parcela_numero ? Number(form.parcela_numero) : null
      };

      const response = await fetch("/api/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao salvar lancamento");
      }

      setMessage("Lancamento salvo com sucesso.");
      setForm(
        mode === "receita"
          ? {
              ...initialState,
              tipo: "receita",
              atribuicao: "WALKER",
              quem_pagou: "WALKER",
              categoria: "RECEITAS"
            }
          : { ...initialState, tipo: "despesa" }
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Novo lancamento</h1>
        <p className="text-sm text-ink/70">Escolha o tipo de lancamento para ver apenas o fluxo necessario.</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Como voce quer lancar?</h2>
        <div className="grid gap-2 md:grid-cols-3">
          <button
            type="button"
            onClick={() => selectMode("despesa_avulsa")}
            className={[
              "rounded-lg border px-3 py-3 text-left text-sm transition",
              mode === "despesa_avulsa" ? "border-ink bg-ink text-sand" : "border-ink/20 bg-white"
            ].join(" ")}
          >
            <p className="font-semibold">Despesas avulsas</p>
            <p className={mode === "despesa_avulsa" ? "text-sand/80" : "text-ink/70"}>
              Compras e pagamentos fora da rotina fixa.
            </p>
          </button>

          <button
            type="button"
            onClick={() => selectMode("despesa_fixa")}
            className={[
              "rounded-lg border px-3 py-3 text-left text-sm transition",
              mode === "despesa_fixa" ? "border-ink bg-ink text-sand" : "border-ink/20 bg-white"
            ].join(" ")}
          >
            <p className="font-semibold">Despesas fixas</p>
            <p className={mode === "despesa_fixa" ? "text-sand/80" : "text-ink/70"}>
              Vencimentos do mes com lancamento rapido.
            </p>
          </button>

          <button
            type="button"
            onClick={() => selectMode("receita")}
            className={[
              "rounded-lg border px-3 py-3 text-left text-sm transition",
              mode === "receita" ? "border-ink bg-ink text-sand" : "border-ink/20 bg-white"
            ].join(" ")}
          >
            <p className="font-semibold">Receitas</p>
            <p className={mode === "receita" ? "text-sand/80" : "text-ink/70"}>Salarios, repasses e entradas.</p>
          </button>
        </div>
        <p className="text-sm text-ink/70">
          {mode === "despesa_avulsa"
            ? "Fluxo ativo: despesas avulsas."
            : mode === "despesa_fixa"
              ? "Fluxo ativo: despesas fixas."
              : mode === "receita"
                ? "Fluxo ativo: receitas."
                : "Selecione um fluxo para continuar."}
        </p>
      </section>

      {mode === "despesa_fixa" ? (
        <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Contas fixas do mes ({currentMonth})</h2>
            <p className="text-sm text-ink/70">
              Veja vencimentos e lance com 1 clique sem abrir a planilha legada.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            onClick={loadData}
            disabled={loadingData || Boolean(savingFixedKey)}
          >
            {loadingData ? "Atualizando..." : "Atualizar quadro"}
          </button>
        </div>

        <p className="text-sm text-ink/70">
          {contasLancadasNoMes} de {contasFixas.length} conta(s) fixa(s) ja lancada(s) neste mes.
        </p>

        {contasFixas.length === 0 ? (
          <p className="rounded-lg bg-sand p-3 text-sm text-ink/70">Nenhuma conta fixa ativa encontrada.</p>
        ) : (
          <div className="space-y-3">
            {contasOrdenadas.map((conta) => {
              const dueDate = dueDateByConta.get(conta.id) ?? dueDateForMonth(currentMonth, conta.dia_vencimento);
              const daysUntilDue = diffDays(today, dueDate);
              const status = fixedStatus(conta.id);
              const launchedCount = launchCountByConta.get(conta.id) ?? 0;
              const savingToday = savingFixedKey === `${conta.id}:today`;
              const savingDue = savingFixedKey === `${conta.id}:due`;

              return (
                <article key={conta.id} className="rounded-xl border border-ink/10 bg-sand p-3">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_220px_auto] md:items-end">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{conta.nome}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${fixedStatusClass[status.tone]}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-sm text-ink/70">
                        Vencimento: {formatDateBr(dueDate)}
                        {daysUntilDue === 0
                          ? " (hoje)"
                          : daysUntilDue > 0
                            ? ` (em ${daysUntilDue} dia(s))`
                            : ` (${Math.abs(daysUntilDue)} dia(s) atrasada)`}
                      </p>
                      <p className="text-xs text-ink/60">
                        Categoria: {conta.categoria || "-"} | Atribuicao: {conta.atribuicao}
                        {launchedCount > 0 ? ` | Lancamentos no mes: ${launchedCount}` : ""}
                      </p>
                    </div>

                    <label className="text-sm">
                      Valor para lancar
                      <input
                        className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                        type="number"
                        step="0.01"
                        value={fixedValues[conta.id] ?? ""}
                        onChange={(event) =>
                          setFixedValues((prev) => ({ ...prev, [conta.id]: event.target.value }))
                        }
                        placeholder="0.00"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <button
                        type="button"
                        className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-sand"
                        onClick={() => launchFixed(conta, "today")}
                        disabled={Boolean(savingFixedKey)}
                      >
                        {savingToday ? "Salvando..." : "Lancar hoje"}
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
                        onClick={() => launchFixed(conta, "due")}
                        disabled={Boolean(savingFixedKey)}
                      >
                        {savingDue ? "Salvando..." : "Lancar no vencimento"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        </section>
      ) : null}

      {mode === "despesa_avulsa" || mode === "receita" ? (
        <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <header className="mb-3">
          <h2 className="text-lg font-semibold">
            {mode === "receita" ? "Lancamento de receita" : "Lancamento de despesa avulsa"}
          </h2>
          <p className="text-sm text-ink/70">
            {mode === "receita"
              ? "Formulario simplificado para entradas de dinheiro."
              : "Use para despesas fora do quadro de contas fixas."}
          </p>
        </header>

        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="text-sm">
              Data
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="date"
                value={form.data}
                onChange={(event) => setForm((prev) => ({ ...prev, data: event.target.value }))}
                required
              />
            </label>

            <p className="rounded-lg bg-sand px-3 py-2 text-sm text-ink/70">
              Tipo selecionado: <strong>{mode === "receita" ? "Receita" : "Despesa avulsa"}</strong>
            </p>
          </div>

          <label className="text-sm">
            Descricao
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.descricao}
              onChange={(event) => setForm((prev) => ({ ...prev, descricao: event.target.value }))}
              required
              placeholder="Ex.: Condominio"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <CategoryPicker
              label="Categoria"
              value={form.categoria}
              onChange={(value) => setForm((prev) => ({ ...prev, categoria: value }))}
              required
              allowCreate
              placeholder={mode === "receita" ? "RECEITAS" : "Moradia, Saude..."}
            />

            <label className="text-sm">
              Valor
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(event) => setForm((prev) => ({ ...prev, valor: event.target.value }))}
                required
              />
              <span className="text-xs text-ink/60">
                Valores podem ser negativos para ajustes de reconciliacao.
              </span>
            </label>
          </div>

          {mode === "despesa_avulsa" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Atribuicao
                <select
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  value={form.atribuicao}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, atribuicao: event.target.value as Lancamento["atribuicao"] }))
                  }
                >
                  {atribuicoes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Metodo
                <select
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  value={form.metodo}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, metodo: event.target.value as Lancamento["metodo"] }))
                  }
                >
                  {metodos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Quem pagou
                <select
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  value={form.quem_pagou}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, quem_pagou: event.target.value as Lancamento["quem_pagou"] }))
                  }
                >
                  <option value="WALKER">WALKER</option>
                  <option value="DEA">DEA</option>
                </select>
              </label>
            </div>
          ) : null}

          {mode === "despesa_avulsa" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                Parcela total (opcional)
                <input
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  type="number"
                  min="1"
                  value={form.parcela_total}
                  onChange={(event) => setForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
                />
              </label>

              <label className="text-sm">
                Numero da parcela (opcional)
                <input
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  type="number"
                  min="1"
                  value={form.parcela_numero}
                  onChange={(event) => setForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
                />
              </label>
            </div>
          ) : null}

          <label className="text-sm">
            Observacao
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={form.observacao}
              onChange={(event) => setForm((prev) => ({ ...prev, observacao: event.target.value }))}
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-ink px-4 py-3 font-semibold text-sand md:w-auto"
            disabled={saving}
          >
            {saving ? "Salvando..." : "Salvar lancamento"}
          </button>
        </form>
        </section>
      ) : null}

      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}
    </section>
  );
}
