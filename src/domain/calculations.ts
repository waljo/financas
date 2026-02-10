import { addDays, isWithinInterval, startOfDay, startOfMonth } from "date-fns";
import type {
  CalendarioAnual,
  ContaFixa,
  CartaoMovimentoComAlocacoes,
  DashboardData,
  Lancamento,
  RelatorioParcelaDetalheItem,
  RelatorioParcelasDetalhe,
  ProjecaoNoventaDias,
  ReceitasRegra,
  RelatorioMensal
} from "@/lib/types";
import { splitByAtribuicao, debtToDeaFromAttribution, debtToWalkerFromAttribution } from "@/domain/attribution";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function filterByMonth(lancamentos: Lancamento[], month: string): Lancamento[] {
  return lancamentos.filter((item) => item.data.slice(0, 7) === month);
}

export function totalByCategory(lancamentos: Lancamento[]): Array<{ categoria: string; total: number }> {
  const map = new Map<string, number>();

  for (const item of lancamentos) {
    if (item.tipo !== "despesa") continue;
    map.set(item.categoria, (map.get(item.categoria) ?? 0) + item.valor);
  }

  return [...map.entries()]
    .map(([categoria, total]) => ({ categoria, total }))
    .sort((a, b) => b.total - a.total);
}

export function totalPorAtribuicao(lancamentos: Lancamento[]) {
  const output = {
    WALKER: 0,
    DEA: 0,
    AMBOS: 0,
    AMBOS_I: 0,
    walkerFinal: 0,
    deaFinal: 0
  };

  for (const item of lancamentos) {
    if (item.tipo !== "despesa") continue;

    output[item.atribuicao] += item.valor;
    const split = splitByAtribuicao(item.atribuicao, item.valor);
    output.walkerFinal += split.walker;
    output.deaFinal += split.dea;
  }

  return output;
}

export function computeReceberPagarDEA(lancamentos: Lancamento[]): number {
  let dueToWalker = 0;
  let dueToDea = 0;

  for (const item of lancamentos) {
    if (item.tipo !== "despesa") continue;

    if (item.quem_pagou === "WALKER") {
      dueToWalker += debtToWalkerFromAttribution(item.atribuicao, item.valor);
    } else {
      dueToDea += debtToDeaFromAttribution(item.atribuicao, item.valor);
    }
  }

  return dueToWalker - dueToDea;
}

export function computeComprometimentoParcelas(
  lancamentosMes: Lancamento[],
  receitasMes: number,
  parcelasExtras = 0
): number {
  if (receitasMes <= 0) return 0;

  const parcelasLancamentos = lancamentosMes
    .filter((item) => item.tipo === "despesa" && item.parcela_total && item.parcela_total > 1)
    .reduce((acc, item) => acc + item.valor, 0);
  const parcelas = parcelasLancamentos + Math.max(parcelasExtras, 0);

  return parcelas / receitasMes;
}

type ComprometimentoDetalheInputItem = {
  id: string;
  origem: "lancamentos" | "cartoes";
  descricao: string;
  categoria?: string;
  cartao?: string | null;
  valorParcela: number;
  parcelaTotal: number | null;
  parcelaNumero: number | null;
  mesReferencia: string;
};

function addMonthsYm(baseMonth: string, offset: number): string {
  const [yearRaw, monthRaw] = baseMonth.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return baseMonth;
  }

  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStartDate(month: string): Date {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return startOfDay(new Date());
  }
  return startOfDay(new Date(year, monthNumber - 1, 1));
}

function futureMonths(baseMonth: string, count: number): string[] {
  const items: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    items.push(addMonthsYm(baseMonth, index));
  }
  return items;
}

export function computeComprometimentoParcelasDetalhe(params: {
  month: string;
  receitasMes: number;
  items: ComprometimentoDetalheInputItem[];
}): RelatorioParcelasDetalhe {
  const compras: RelatorioParcelaDetalheItem[] = params.items
    .filter((item) => item.parcelaTotal !== null && item.parcelaTotal > 1 && item.valorParcela > 0)
    .map((item) => {
      const totalParcelas = Math.trunc(item.parcelaTotal ?? 0);
      const pagasRaw = item.parcelaNumero ?? 1;
      const pagas = clamp(Math.trunc(pagasRaw), 1, totalParcelas);
      const restantes = Math.max(totalParcelas - pagas, 0);
      const valorTotalCompra = roundMoney(item.valorParcela * totalParcelas);
      const saldoEmAberto = roundMoney(item.valorParcela * restantes);
      const baseMonth = /^\d{4}-\d{2}$/.test(item.mesReferencia) ? item.mesReferencia : params.month;

      return {
        id: item.id,
        origem: item.origem,
        descricao: item.descricao.trim(),
        categoria: item.categoria?.trim() || "Sem categoria",
        cartao: item.cartao ?? null,
        valorParcela: roundMoney(item.valorParcela),
        valorTotalCompra,
        totalParcelas,
        pagas,
        restantes,
        saldoEmAberto,
        mesesFuturos: futureMonths(baseMonth, restantes),
        estimado: item.parcelaNumero === null
      };
    })
    .sort((a, b) => {
      if (b.saldoEmAberto !== a.saldoEmAberto) return b.saldoEmAberto - a.saldoEmAberto;
      if (b.restantes !== a.restantes) return b.restantes - a.restantes;
      return b.valorParcela - a.valorParcela;
    });

  const totalParcelasMes = roundMoney(compras.reduce((acc, item) => acc + item.valorParcela, 0));
  const totalParceladoEmAberto = roundMoney(compras.reduce((acc, item) => acc + item.saldoEmAberto, 0));

  return {
    mes: params.month,
    receitasMes: roundMoney(params.receitasMes),
    totalParcelasMes,
    totalParceladoEmAberto,
    comprometimentoParcelas: params.receitasMes > 0 ? totalParcelasMes / params.receitasMes : 0,
    compras
  };
}

export function computeReport(
  month: string,
  lancamentos: Lancamento[],
  options?: { parcelasExtras?: number }
): RelatorioMensal {
  const lancamentosMes = filterByMonth(lancamentos, month);

  const receitas = lancamentosMes
    .filter((item) => item.tipo === "receita")
    .reduce((acc, item) => acc + item.valor, 0);

  const despesas = lancamentosMes
    .filter((item) => item.tipo === "despesa")
    .reduce((acc, item) => acc + item.valor, 0);

  const atribuicaoTotals = totalPorAtribuicao(lancamentosMes);
  const saldoAposAcertoDEA = roundMoney(receitas - atribuicaoTotals.walkerFinal);

  return {
    mes: month,
    receitas,
    despesas,
    saldo: receitas - despesas,
    saldoAposAcertoDEA,
    totalPorCategoria: totalByCategory(lancamentosMes),
    totalPorAtribuicao: atribuicaoTotals,
    receberPagarDEA: computeReceberPagarDEA(lancamentosMes),
    comprometimentoParcelas: computeComprometimentoParcelas(lancamentosMes, receitas, options?.parcelasExtras ?? 0)
  };
}

function parseIsoDateLocal(value: string): Date | null {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return startOfDay(date);
}

function parseDateOrNull(value: string): Date | null {
  const parsedLocal = parseIsoDateLocal(value);
  if (parsedLocal) return parsedLocal;

  const fallback = new Date(value);
  if (Number.isNaN(fallback.getTime())) return null;
  return startOfDay(fallback);
}

function sumReceitasInInterval(lancamentos: Lancamento[], start: Date, end: Date): number {
  return lancamentos
    .filter((item) => item.tipo === "receita")
    .reduce((acc, item) => {
      const date = parseDateOrNull(item.data);
      if (!date || !isWithinInterval(date, { start, end })) return acc;
      return acc + item.valor;
    }, 0);
}

function formatYmd(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function shiftYears(value: Date, years: number): Date {
  return startOfDay(new Date(value.getFullYear() + years, value.getMonth(), value.getDate()));
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function walkerShare(atribuicao: Lancamento["atribuicao"], valor: number): number {
  return splitByAtribuicao(atribuicao, valor).walker;
}

function buildFixedLookups(contasFixas: ContaFixa[]): { nomes: Set<string>; categorias: Set<string> } {
  const nomes = new Set<string>();
  const categorias = new Set<string>();

  for (const conta of contasFixas) {
    if (conta.nome?.trim()) nomes.add(normalizeMatchText(conta.nome));
    if (conta.categoria?.trim()) categorias.add(normalizeMatchText(conta.categoria));
  }

  return { nomes, categorias };
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetweenInclusive(start: Date, end: Date): string[] {
  const output: string[] = [];
  const cursor = startOfMonth(start);
  const limit = startOfMonth(end);

  while (cursor.getTime() <= limit.getTime()) {
    output.push(monthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }

  return output;
}

function shiftMonthKeyYears(monthKey: string, years: number): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return monthKey;
  return `${year + years}-${String(month).padStart(2, "0")}`;
}

function isContaFixaLancamento(item: Lancamento, fixedLookups: { nomes: Set<string>; categorias: Set<string> }): boolean {
  const descricaoNorm = normalizeMatchText(item.descricao ?? "");
  const categoriaNorm = normalizeMatchText(item.categoria ?? "");
  return fixedLookups.nomes.has(descricaoNorm) || fixedLookups.categorias.has(categoriaNorm);
}

function isCartaoLancamento(item: Lancamento): boolean {
  if (item.metodo === "cartao") return true;
  const categoriaNorm = normalizeMatchText(item.categoria ?? "");
  if (categoriaNorm.startsWith("C_")) return true;
  if (categoriaNorm.includes("CARTAO")) return true;
  return false;
}

function receitaWalkerPorMesNoIntervalo(
  lancamentos: Lancamento[],
  start: Date,
  end: Date
): Array<{ mes: string; total: number }> {
  const map = new Map<string, number>();
  const monthsInRange = new Set(monthsBetweenInclusive(start, end));

  for (const item of lancamentos) {
    if (item.tipo !== "receita") continue;
    const date = parseDateOrNull(item.data);
    if (!date) continue;

    const monthKey = monthKeyFromDate(date);
    if (!monthsInRange.has(monthKey)) continue;
    map.set(monthKey, (map.get(monthKey) ?? 0) + walkerShare(item.atribuicao, item.valor));
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, total]) => ({ mes, total: roundMoney(total) }));
}

function despesasAvulsasWalkerAnoAnteriorNoIntervalo(
  lancamentos: Lancamento[],
  contasFixas: ContaFixa[],
  start: Date,
  end: Date
): {
  total: number;
  cartaoTotal: number;
  cartaoValorParcelas: number | null;
  cartaoSemDadosParcelas: boolean;
} {
  const fixedLookups = buildFixedLookups(contasFixas);
  const monthsInRange = new Set(monthsBetweenInclusive(start, end));

  let total = 0;
  let cartaoTotal = 0;
  let cartaoValorParcelas = 0;
  let hasAnyCardParcelaInfo = false;

  for (const item of lancamentos) {
    if (item.tipo !== "despesa") continue;
    const date = parseDateOrNull(item.data);
    if (!date) continue;
    const monthKey = monthKeyFromDate(date);
    if (!monthsInRange.has(monthKey)) continue;
    if (isContaFixaLancamento(item, fixedLookups)) continue;

    const walker = walkerShare(item.atribuicao, item.valor);
    total += walker;

    if (!isCartaoLancamento(item)) continue;

    cartaoTotal += walker;
    const hasParcelaInfo = item.parcela_total !== null || item.parcela_numero !== null;
    if (hasParcelaInfo) hasAnyCardParcelaInfo = true;
    const isParcelada = Boolean(item.parcela_total && item.parcela_total > 1);
    if (isParcelada) cartaoValorParcelas += walker;
  }

  const valorParcelas =
    cartaoTotal <= 0 ? 0 : hasAnyCardParcelaInfo ? roundMoney(cartaoValorParcelas) : null;

  return {
    total: roundMoney(total),
    cartaoTotal: roundMoney(cartaoTotal),
    cartaoValorParcelas: valorParcelas,
    cartaoSemDadosParcelas: cartaoTotal > 0 ? !hasAnyCardParcelaInfo : false
  };
}

function despesasAvulsasWalkerAnoAnteriorPorMesNoIntervalo(
  lancamentos: Lancamento[],
  contasFixas: ContaFixa[],
  start: Date,
  end: Date
): Map<
  string,
  {
    total: number;
    cartaoTotal: number;
    cartaoValorParcelas: number | null;
    cartaoSemDadosParcelas: boolean;
  }
> {
  const fixedLookups = buildFixedLookups(contasFixas);
  const monthsInRange = new Set(monthsBetweenInclusive(start, end));
  const months = new Map<
    string,
    { total: number; cartaoTotal: number; cartaoValorParcelas: number; hasAnyCardParcelaInfo: boolean }
  >();

  for (const item of lancamentos) {
    if (item.tipo !== "despesa") continue;
    const date = parseDateOrNull(item.data);
    if (!date) continue;
    const mes = monthKeyFromDate(date);
    if (!monthsInRange.has(mes)) continue;
    if (isContaFixaLancamento(item, fixedLookups)) continue;

    const current = months.get(mes) ?? { total: 0, cartaoTotal: 0, cartaoValorParcelas: 0, hasAnyCardParcelaInfo: false };
    const walker = walkerShare(item.atribuicao, item.valor);
    current.total += walker;

    if (isCartaoLancamento(item)) {
      current.cartaoTotal += walker;
      const hasParcelaInfo = item.parcela_total !== null || item.parcela_numero !== null;
      if (hasParcelaInfo) current.hasAnyCardParcelaInfo = true;
      const isParcelada = Boolean(item.parcela_total && item.parcela_total > 1);
      if (isParcelada) current.cartaoValorParcelas += walker;
    }

    months.set(mes, current);
  }

  const output = new Map<
    string,
    {
      total: number;
      cartaoTotal: number;
      cartaoValorParcelas: number | null;
      cartaoSemDadosParcelas: boolean;
    }
  >();

  for (const [mes, values] of months.entries()) {
    const cartaoValorParcelas =
      values.cartaoTotal <= 0
        ? 0
        : values.hasAnyCardParcelaInfo
          ? roundMoney(values.cartaoValorParcelas)
          : null;
    output.set(mes, {
      total: roundMoney(values.total),
      cartaoTotal: roundMoney(values.cartaoTotal),
      cartaoValorParcelas,
      cartaoSemDadosParcelas: values.cartaoTotal > 0 ? !values.hasAnyCardParcelaInfo : false
    });
  }

  return output;
}

function despesasFixasWalkerPeriodoAtualNoIntervalo(contasFixas: ContaFixa[], start: Date, end: Date): number {
  let total = 0;
  const months = monthsBetweenInclusive(start, end);

  for (const _month of months) {
    for (const conta of contasFixas) {
      if (!conta.ativo) continue;
      if (conta.valor_previsto === null || conta.valor_previsto <= 0) continue;
      total += walkerShare(conta.atribuicao, conta.valor_previsto);
    }
  }

  return roundMoney(total);
}

function despesasFixasWalkerPorMesPeriodoAtualNoIntervalo(
  contasFixas: ContaFixa[],
  start: Date,
  end: Date
): Map<string, number> {
  const output = new Map<string, number>();
  const months = monthsBetweenInclusive(start, end);

  for (const monthKey of months) {
    let monthTotal = 0;
    for (const conta of contasFixas) {
      if (!conta.ativo) continue;
      if (conta.valor_previsto === null || conta.valor_previsto <= 0) continue;
      const walker = walkerShare(conta.atribuicao, conta.valor_previsto);
      monthTotal += walker;
    }
    output.set(monthKey, roundMoney(monthTotal));
  }

  return output;
}

export function computeProjection90Days(params: {
  lancamentos: Lancamento[];
  cartaoMovimentos?: CartaoMovimentoComAlocacoes[];
  contasFixas: ContaFixa[];
  calendarioAnual: CalendarioAnual[];
  receitasRegras: ReceitasRegra[];
  fromDate?: Date;
}): ProjecaoNoventaDias {
  const start = startOfDay(params.fromDate ?? new Date());
  const end = addDays(start, 90);
  const baseStart = shiftYears(start, -1);
  const baseEnd = shiftYears(end, -1);

  const receitasPorMes = receitaWalkerPorMesNoIntervalo(params.lancamentos, baseStart, baseEnd);
  const receitasWalkerTotal = roundMoney(receitasPorMes.reduce((acc, item) => acc + item.total, 0));
  const despesasAvulsasAnoAnterior = despesasAvulsasWalkerAnoAnteriorNoIntervalo(
    params.lancamentos,
    params.contasFixas,
    baseStart,
    baseEnd
  );
  const despesasAvulsasPorMesAnoAnterior = despesasAvulsasWalkerAnoAnteriorPorMesNoIntervalo(
    params.lancamentos,
    params.contasFixas,
    baseStart,
    baseEnd
  );
  const despesasFixasAtuais = despesasFixasWalkerPeriodoAtualNoIntervalo(params.contasFixas, start, end);
  const despesasFixasPorMesAtuais = despesasFixasWalkerPorMesPeriodoAtualNoIntervalo(params.contasFixas, start, end);
  const despesasWalkerTotal = roundMoney(despesasAvulsasAnoAnterior.total + despesasFixasAtuais);
  const saldoProjetado = receitasWalkerTotal - despesasWalkerTotal;

  const avulsasPercentual = despesasWalkerTotal !== 0 ? despesasAvulsasAnoAnterior.total / despesasWalkerTotal : 0;
  const fixasPercentual = despesasWalkerTotal !== 0 ? despesasFixasAtuais / despesasWalkerTotal : 0;
  const despesasWalkerPorMes = monthsBetweenInclusive(start, end).map((mesAtual) => {
    const mesBaseAnoAnterior = shiftMonthKeyYears(mesAtual, -1);
    const avulsas = despesasAvulsasPorMesAnoAnterior.get(mesBaseAnoAnterior);
    const fixas = despesasFixasPorMesAtuais.get(mesAtual) ?? 0;
    const avulsasTotal = avulsas?.total ?? 0;
    return {
      mes: mesAtual,
      mesBaseAnoAnterior,
      avulsas: roundMoney(avulsasTotal),
      fixas: roundMoney(fixas),
      cartao: roundMoney(avulsas?.cartaoTotal ?? 0),
      valorParcelasCartao: avulsas?.cartaoValorParcelas ?? 0,
      semDadosParcelasCartao: avulsas?.cartaoSemDadosParcelas ?? false,
      total: roundMoney(avulsasTotal + fixas)
    };
  });

  return {
    periodoInicio: formatYmd(start),
    periodoFim: formatYmd(end),
    periodoBaseInicio: formatYmd(baseStart),
    periodoBaseFim: formatYmd(baseEnd),
    receitasPrevistas: receitasWalkerTotal,
    despesasFixasPrevistas: despesasFixasAtuais,
    despesasWalkerPrevistas: despesasWalkerTotal,
    despesasSazonaisPrevistas: despesasAvulsasAnoAnterior.total,
    parcelasPrevistas: despesasAvulsasAnoAnterior.cartaoValorParcelas,
    receitasWalkerPorMesAnoAnterior: receitasPorMes,
    despesasWalkerDetalhe: {
      avulsas: {
        total: despesasAvulsasAnoAnterior.total,
        percentual: avulsasPercentual,
        cartao: {
          total: despesasAvulsasAnoAnterior.cartaoTotal,
          valorParcelas: despesasAvulsasAnoAnterior.cartaoValorParcelas,
          semDadosParcelas: despesasAvulsasAnoAnterior.cartaoSemDadosParcelas
        }
      },
      fixas: {
        total: despesasFixasAtuais,
        percentual: fixasPercentual
      }
    },
    despesasWalkerPorMes,
    saldoProjetado: roundMoney(saldoProjetado)
  };
}

export function computeDashboard(params: {
  month: string;
  lancamentos: Lancamento[];
  cartaoMovimentos?: CartaoMovimentoComAlocacoes[];
  contasFixas: ContaFixa[];
  calendarioAnual: CalendarioAnual[];
  receitasRegras: ReceitasRegra[];
  saldoBanco: number;
  saldoCarteira: number;
  fonteSaldoReal?: "manual" | "legacy" | "mixed";
}): DashboardData {
  const report = computeReport(params.month, params.lancamentos);
  const monthLancamentos = filterByMonth(params.lancamentos, params.month);

  const pagamentosWalker = monthLancamentos
    .filter((item) => item.tipo === "despesa" && item.quem_pagou === "WALKER")
    .reduce((acc, item) => acc + item.valor, 0);

  const saldoSistema = roundMoney(report.receitas - pagamentosWalker);
  const saldoReal = roundMoney(params.saldoBanco + params.saldoCarteira);
  const diferencaBalanco = roundMoney(saldoReal - saldoSistema);

  return {
    mes: params.month,
    saldoMes: report.saldo,
    receitasMes: report.receitas,
    despesasMes: report.despesas,
    saldoAposAcertoDEA: report.saldoAposAcertoDEA,
    receberPagarDEA: report.receberPagarDEA,
    balancoSistema: saldoSistema,
    balancoReal: saldoReal,
    diferencaBalanco,
    saldoBancoReferencia: params.saldoBanco,
    saldoCarteiraReferencia: params.saldoCarteira,
    fonteSaldoReal: params.fonteSaldoReal ?? "manual",
    projecao90Dias: computeProjection90Days({
      lancamentos: params.lancamentos,
      cartaoMovimentos: params.cartaoMovimentos ?? [],
      contasFixas: params.contasFixas,
      calendarioAnual: params.calendarioAnual,
      receitasRegras: params.receitasRegras,
      fromDate: monthStartDate(params.month)
    })
  };
}
