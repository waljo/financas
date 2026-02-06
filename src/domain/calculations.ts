import { addDays, endOfMonth, isWithinInterval, setDate, startOfDay } from "date-fns";
import type {
  CalendarioAnual,
  ContaFixa,
  DashboardData,
  Lancamento,
  ProjecaoNoventaDias,
  ReceitasRegra,
  RelatorioMensal
} from "@/lib/types";
import { splitByAtribuicao, debtToDeaFromAttribution, debtToWalkerFromAttribution } from "@/domain/attribution";
import { parsePetrobrasRules, projectPetrobrasReceitas } from "@/domain/petrobrasRules";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

export function computeComprometimentoParcelas(lancamentosMes: Lancamento[], receitasMes: number): number {
  if (receitasMes <= 0) return 0;

  const parcelas = lancamentosMes
    .filter((item) => item.tipo === "despesa" && item.parcela_total && item.parcela_total > 1)
    .reduce((acc, item) => acc + item.valor, 0);

  return parcelas / receitasMes;
}

export function computeReport(month: string, lancamentos: Lancamento[]): RelatorioMensal {
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
    comprometimentoParcelas: computeComprometimentoParcelas(lancamentosMes, receitas)
  };
}

function dueDateForMonth(reference: Date, day: number): Date {
  const base = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const monthEnd = endOfMonth(base).getDate();
  return setDate(base, Math.min(day, monthEnd));
}

function computeContasFixasProjection(contasFixas: ContaFixa[], start: Date, end: Date): number {
  let total = 0;

  const monthCursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (monthCursor <= end) {
    for (const conta of contasFixas) {
      if (!conta.ativo || conta.valor_previsto === null) continue;
      const dueDate = dueDateForMonth(monthCursor, conta.dia_vencimento);
      if (isWithinInterval(dueDate, { start, end })) {
        total += conta.valor_previsto;
      }
    }
    monthCursor.setMonth(monthCursor.getMonth() + 1);
  }

  return total;
}

function computeSazonaisProjection(calendario: CalendarioAnual[], start: Date, end: Date): number {
  let total = 0;

  const years = [start.getFullYear(), end.getFullYear()];
  for (const item of calendario) {
    const day = item.dia_mes && item.dia_mes > 0 ? item.dia_mes : 1;
    for (const year of years) {
      const candidate = new Date(year, item.mes - 1, day);
      if (isWithinInterval(candidate, { start, end })) {
        total += item.valor_estimado;
      }
    }
  }

  return total;
}

function computeParcelasProjection(lancamentos: Lancamento[], start: Date, end: Date): number {
  return lancamentos
    .filter((item) => item.tipo === "despesa" && item.parcela_total && item.parcela_total > 1)
    .filter((item) => {
      const date = new Date(item.data);
      return isWithinInterval(date, { start, end });
    })
    .reduce((acc, item) => acc + item.valor, 0);
}

export function computeProjection90Days(params: {
  lancamentos: Lancamento[];
  contasFixas: ContaFixa[];
  calendarioAnual: CalendarioAnual[];
  receitasRegras: ReceitasRegra[];
  fromDate?: Date;
}): ProjecaoNoventaDias {
  const start = startOfDay(params.fromDate ?? new Date());
  const end = addDays(start, 90);

  const receitasFromLancamentos = params.lancamentos
    .filter((item) => item.tipo === "receita")
    .filter((item) => {
      const date = new Date(item.data);
      return isWithinInterval(date, { start, end });
    })
    .reduce((acc, item) => acc + item.valor, 0);

  const rulesMap: Record<string, string> = {};
  for (const rule of params.receitasRegras) {
    rulesMap[rule.chave] = rule.valor;
  }

  const petrobras = projectPetrobrasReceitas(parsePetrobrasRules(rulesMap), start, 90);
  const contasFixas = computeContasFixasProjection(params.contasFixas, start, end);
  const sazonais = computeSazonaisProjection(params.calendarioAnual, start, end) + petrobras.despesasCompartilhadas;
  const parcelas = computeParcelasProjection(params.lancamentos, start, end);

  const receitasPrevistas = receitasFromLancamentos + petrobras.receitas;
  const saldoProjetado = receitasPrevistas - contasFixas - sazonais - parcelas;

  return {
    periodoInicio: start.toISOString().slice(0, 10),
    periodoFim: end.toISOString().slice(0, 10),
    receitasPrevistas,
    despesasFixasPrevistas: contasFixas,
    despesasSazonaisPrevistas: sazonais,
    parcelasPrevistas: parcelas,
    saldoProjetado
  };
}

export function computeDashboard(params: {
  month: string;
  lancamentos: Lancamento[];
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
      contasFixas: params.contasFixas,
      calendarioAnual: params.calendarioAnual,
      receitasRegras: params.receitasRegras,
      fromDate: startOfDay(new Date(`${params.month}-01`))
    })
  };
}
