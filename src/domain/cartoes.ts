import type {
  Atribuicao,
  BancoCartao,
  CartaoCredito,
  CartaoMovimentoComAlocacoes,
  Lancamento,
  PessoaPagadora,
  TotalizadoresCartao
} from "@/lib/types";
import { buildCartaoTxKey } from "@/lib/sheets/cartoesClient";
import { randomUUID } from "node:crypto";

export interface CartaoImportLine {
  data: string;
  descricao: string;
  valor: number;
  parcela_total?: number | null;
  parcela_numero?: number | null;
  final_cartao?: string;
  observacao?: string;
}

export interface CartaoReconcileItem extends CartaoImportLine {
  tx_key: string;
  status: "ja_lancado" | "novo";
  movimentoId?: string;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function descriptionsCompatible(left: string, right: string): boolean {
  const a = normalizeForMatch(left);
  const b = normalizeForMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;

  const tokensA = a.split(" ").filter((item) => item.length >= 3);
  const tokensB = new Set(b.split(" ").filter((item) => item.length >= 3));
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
    if (overlap >= 2) return true;
  }
  return false;
}

function findLooseMatch(input: {
  line: CartaoImportLine;
  existing: CartaoMovimentoComAlocacoes[];
  matchedIds: Set<string>;
}): CartaoMovimentoComAlocacoes | null {
  const candidates = input.existing.filter((movimento) => {
    if (input.matchedIds.has(movimento.id)) return false;
    if (movimento.data !== input.line.data) return false;
    if (Math.abs(movimento.valor - input.line.valor) > 0.01) return false;
    return descriptionsCompatible(input.line.descricao, movimento.descricao);
  });

  if (candidates.length === 1) return candidates[0];
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function monthLastDay(month: string): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${pad2(lastDay)}`;
}

export function defaultAtribuicaoForCard(cartao: CartaoCredito | null): Atribuicao {
  if (!cartao) return "AMBOS";
  if (cartao.titular === "JULIA") return "AMBOS";
  if (cartao.titular === "DEA") return "AMBOS";
  return cartao.padrao_atribuicao;
}

export function reconcileImportLines(params: {
  cartao: CartaoCredito;
  lines: CartaoImportLine[];
  existing: CartaoMovimentoComAlocacoes[];
}): {
  preview: CartaoReconcileItem[];
  total: number;
  novos: number;
  conciliados: number;
} {
  const existingByKey = new Map<string, CartaoMovimentoComAlocacoes[]>();
  const existingByCard: CartaoMovimentoComAlocacoes[] = [];
  for (const movimento of params.existing) {
    if (movimento.cartao_id !== params.cartao.id) continue;
    existingByCard.push(movimento);
    if (!movimento.tx_key) continue;
    const list = existingByKey.get(movimento.tx_key) ?? [];
    list.push(movimento);
    existingByKey.set(movimento.tx_key, list);
  }

  const matchedIds = new Set<string>();
  const preview = params.lines.map((line) => {
    const tx_key = buildCartaoTxKey({
      cartao_id: params.cartao.id,
      data: line.data,
      descricao: line.descricao,
      valor: line.valor,
      parcela_total: line.parcela_total,
      parcela_numero: line.parcela_numero
    });
    const exactCandidates = existingByKey.get(tx_key) ?? [];
    const exact = exactCandidates.find((item) => !matchedIds.has(item.id)) ?? null;
    const loose = exact
      ? null
      : findLooseMatch({
          line,
          existing: existingByCard,
          matchedIds
        });
    const existing = exact ?? loose;
    if (existing) matchedIds.add(existing.id);
    return {
      ...line,
      tx_key,
      status: existing ? "ja_lancado" : "novo",
      movimentoId: existing?.id
    } satisfies CartaoReconcileItem;
  });

  const total = preview.length;
  const conciliados = preview.filter((item) => item.status === "ja_lancado").length;
  const novos = total - conciliados;

  return { preview, total, novos, conciliados };
}

export function computeCartaoTotalizadores(params: {
  movimentos: CartaoMovimentoComAlocacoes[];
  mes: string;
  banco: BancoCartao;
}): TotalizadoresCartao & { pendentes: number } {
  const total = {
    WALKER: 0,
    AMBOS: 0,
    DEA: 0
  };

  let pendentes = 0;
  for (const movimento of params.movimentos) {
    if (movimento.mes_ref !== params.mes) continue;
    if (!movimento.cartao || movimento.cartao.banco !== params.banco) continue;
    if (movimento.status !== "conciliado") {
      pendentes += 1;
      continue;
    }

    for (const alocacao of movimento.alocacoes) {
      if (alocacao.atribuicao === "WALKER") total.WALKER += alocacao.valor;
      if (alocacao.atribuicao === "AMBOS") total.AMBOS += alocacao.valor;
      if (alocacao.atribuicao === "DEA") total.DEA += alocacao.valor;
    }
  }

  return {
    mes: params.mes,
    banco: params.banco,
    porAtribuicao: total,
    pendentes
  };
}

export function totalizadoresToLancamentos(params: {
  totalizadores: TotalizadoresCartao;
  quem_pagou: PessoaPagadora;
  categoria: string;
}): Lancamento[] {
  const now = new Date().toISOString();
  const baseData = monthLastDay(params.totalizadores.mes);
  const bank = params.totalizadores.banco;
  const items: Array<{ suffix: "WALKER" | "AMBOS" | "DEA"; atribuicao: Atribuicao; valor: number }> = [
    { suffix: "WALKER", atribuicao: "WALKER", valor: params.totalizadores.porAtribuicao.WALKER },
    { suffix: "AMBOS", atribuicao: "AMBOS", valor: params.totalizadores.porAtribuicao.AMBOS },
    { suffix: "DEA", atribuicao: "DEA", valor: params.totalizadores.porAtribuicao.DEA }
  ];

  return items
    .filter((item) => Math.abs(item.valor) > 0.009)
    .map((item) => ({
      id: randomUUID(),
      data: baseData,
      tipo: "despesa",
      descricao: `${bank}_${item.suffix}`,
      categoria: params.categoria,
      valor: Number(item.valor.toFixed(2)),
      atribuicao: item.atribuicao,
      metodo: "cartao",
      parcela_total: null,
      parcela_numero: null,
      observacao: `[CARTAO_TOTALIZADOR:${bank}:${params.totalizadores.mes}]`,
      created_at: now,
      updated_at: now,
      quem_pagou: params.quem_pagou
    }));
}
