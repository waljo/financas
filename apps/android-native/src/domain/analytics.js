function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function splitByAtribuicao(atribuicao, valor) {
  const amount = Number(valor || 0);
  switch (String(atribuicao || "").toUpperCase()) {
    case "WALKER":
      return { walker: amount, dea: 0 };
    case "DEA":
      return { walker: 0, dea: amount };
    case "AMBOS":
      return { walker: amount * 0.6, dea: amount * 0.4 };
    case "AMBOS_I":
      return { walker: amount * 0.4, dea: amount * 0.6 };
    default:
      return { walker: 0, dea: 0 };
  }
}

function debtToWalkerFromAttribution(atribuicao, valor) {
  const amount = Number(valor || 0);
  const safe = String(atribuicao || "").toUpperCase();
  if (safe === "DEA") return amount;
  if (safe === "AMBOS") return amount * 0.4;
  if (safe === "AMBOS_I") return amount * 0.6;
  return 0;
}

function debtToDeaFromAttribution(atribuicao, valor) {
  const amount = Number(valor || 0);
  const safe = String(atribuicao || "").toUpperCase();
  if (safe === "WALKER") return amount;
  if (safe === "AMBOS") return amount * 0.6;
  if (safe === "AMBOS_I") return amount * 0.4;
  return 0;
}

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseIsoDateLocal(value) {
  if (!isValidYmd(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = String(value).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next;
}

function shiftYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function buildFixedLookups(contasFixas) {
  const nomes = new Set();
  const categorias = new Set();
  for (const conta of contasFixas || []) {
    const nome = normalizeMatchText(conta?.nome);
    const categoria = normalizeMatchText(conta?.categoria);
    if (nome) nomes.add(nome);
    if (categoria) categorias.add(categoria);
  }
  return { nomes, categorias };
}

function isContaFixaLancamento(item, fixedLookups) {
  const descricaoNorm = normalizeMatchText(item?.descricao);
  const categoriaNorm = normalizeMatchText(item?.categoria);
  return fixedLookups.nomes.has(descricaoNorm) || fixedLookups.categorias.has(categoriaNorm);
}

function isCartaoLancamento(item) {
  const metodo = String(item?.metodo || "").toLowerCase();
  if (metodo === "cartao") return true;
  const categoriaNorm = normalizeMatchText(item?.categoria);
  if (categoriaNorm.startsWith("C_")) return true;
  if (categoriaNorm.includes("CARTAO")) return true;
  return false;
}

function monthStartFromKey(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;
  const [yearRaw, monthRaw] = String(month).split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  const date = new Date(year, monthNumber - 1, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function monthRangeInclusive(start, end) {
  const out = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  cursor.setHours(0, 0, 0, 0);
  const limit = new Date(end.getFullYear(), end.getMonth(), 1);
  limit.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= limit.getTime()) {
    out.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  return out;
}

function addMonthsYm(baseMonth, offset) {
  if (!/^\d{4}-\d{2}$/.test(String(baseMonth || ""))) return String(baseMonth || "");
  const [yearRaw, monthRaw] = String(baseMonth).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return String(baseMonth || "");
  const date = new Date(year, month - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthsWindowEndingAt(referenceMonth, size) {
  const output = [];
  const safeSize = Number.isInteger(size) && size > 0 ? size : 12;
  for (let offset = safeSize - 1; offset >= 0; offset -= 1) {
    output.push(addMonthsYm(referenceMonth, -offset));
  }
  return output;
}

function futureMonths(baseMonth, count) {
  const items = [];
  for (let index = 1; index <= count; index += 1) {
    items.push(addMonthsYm(baseMonth, index));
  }
  return items;
}

function shiftMonthKeyYears(month, years) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return String(month || "");
  const [yearRaw, monthRaw] = String(month).split("-");
  return `${Number(yearRaw) + years}-${monthRaw}`;
}

export function computeMonthlySnapshotLocal(lancamentos, month) {
  const safeMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : formatYmd(new Date()).slice(0, 7);
  const monthRows = (lancamentos || []).filter((item) => String(item?.data || "").slice(0, 7) === safeMonth);
  const receitas = roundMoney(
    monthRows.filter((item) => item?.tipo === "receita").reduce((acc, item) => acc + Number(item?.valor || 0), 0)
  );
  const despesas = roundMoney(
    monthRows.filter((item) => item?.tipo === "despesa").reduce((acc, item) => acc + Number(item?.valor || 0), 0)
  );

  let walkerFinal = 0;
  let dueToWalker = 0;
  let dueToDea = 0;
  for (const item of monthRows) {
    if (item?.tipo !== "despesa") continue;
    walkerFinal += splitByAtribuicao(item?.atribuicao, Number(item?.valor || 0)).walker;
    if (item?.quem_pagou === "WALKER") {
      dueToWalker += debtToWalkerFromAttribution(item?.atribuicao, Number(item?.valor || 0));
    } else {
      dueToDea += debtToDeaFromAttribution(item?.atribuicao, Number(item?.valor || 0));
    }
  }

  return {
    mes: safeMonth,
    receitasMes: receitas,
    despesasMes: despesas,
    saldoMes: roundMoney(receitas - despesas),
    saldoAposAcertoDEA: roundMoney(receitas - walkerFinal),
    receberPagarDEA: roundMoney(dueToWalker - dueToDea)
  };
}

export function filterByMonthLocal(lancamentos, month) {
  const safeMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : currentMonthKey();
  return (lancamentos || []).filter((item) => String(item?.data || "").slice(0, 7) === safeMonth);
}

function currentMonthKey() {
  return formatYmd(new Date()).slice(0, 7);
}

export function totalByCategoryLocal(lancamentosMes) {
  const map = new Map();
  for (const item of lancamentosMes || []) {
    if (item?.tipo !== "despesa") continue;
    const categoria = String(item?.categoria || "").trim() || "SEM_CATEGORIA";
    map.set(categoria, (map.get(categoria) || 0) + Number(item?.valor || 0));
  }
  return [...map.entries()]
    .map(([categoria, total]) => ({ categoria, total: roundMoney(total) }))
    .sort((a, b) => b.total - a.total);
}

export function totalPorAtribuicaoLocal(lancamentosMes) {
  const output = {
    WALKER: 0,
    DEA: 0,
    AMBOS: 0,
    AMBOS_I: 0,
    walkerFinal: 0,
    deaFinal: 0
  };
  for (const item of lancamentosMes || []) {
    if (item?.tipo !== "despesa") continue;
    const atrib = String(item?.atribuicao || "AMBOS").toUpperCase();
    const valor = Number(item?.valor || 0);
    if (Object.prototype.hasOwnProperty.call(output, atrib)) {
      output[atrib] += valor;
    }
    const split = splitByAtribuicao(atrib, valor);
    output.walkerFinal += split.walker;
    output.deaFinal += split.dea;
  }
  return {
    WALKER: roundMoney(output.WALKER),
    DEA: roundMoney(output.DEA),
    AMBOS: roundMoney(output.AMBOS),
    AMBOS_I: roundMoney(output.AMBOS_I),
    walkerFinal: roundMoney(output.walkerFinal),
    deaFinal: roundMoney(output.deaFinal)
  };
}

export function computeReceberPagarDEALocal(lancamentosMes) {
  let dueToWalker = 0;
  let dueToDea = 0;
  for (const item of lancamentosMes || []) {
    if (item?.tipo !== "despesa") continue;
    const valor = Number(item?.valor || 0);
    const atribuicao = String(item?.atribuicao || "AMBOS").toUpperCase();
    const quemPagou = String(item?.quem_pagou || "WALKER").toUpperCase();
    if (quemPagou === "WALKER") {
      dueToWalker += debtToWalkerFromAttribution(atribuicao, valor);
    } else {
      dueToDea += debtToDeaFromAttribution(atribuicao, valor);
    }
  }
  return roundMoney(dueToWalker - dueToDea);
}

function parcelasWalkerLancamentosMes(lancamentosMes) {
  return roundMoney(
    (lancamentosMes || [])
      .filter((item) => item?.tipo === "despesa")
      .filter((item) => Number(item?.parcela_total || 0) > 1)
      .filter((item) => String(item?.metodo || "").toLowerCase() === "cartao")
      .reduce((acc, item) => acc + splitByAtribuicao(item?.atribuicao, Number(item?.valor || 0)).walker, 0)
  );
}

function parcelasWalkerCartaoMovimentosMes(cartaoMovimentos, month) {
  return roundMoney(
    (cartaoMovimentos || [])
      .filter((item) => String(item?.mes_ref || "") === String(month))
      .filter((item) => Number(item?.parcela_total || 0) > 1)
      .reduce((acc, item) => {
        const totalWalker = (item?.alocacoes || []).reduce(
          (sum, alocacao) => sum + splitByAtribuicao(alocacao?.atribuicao, Number(alocacao?.valor || 0)).walker,
          0
        );
        return acc + totalWalker;
      }, 0)
  );
}

export function computeRelatorioMensalLocal(month, lancamentos, cartaoMovimentos) {
  const safeMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : currentMonthKey();
  const lancamentosMes = filterByMonthLocal(lancamentos, safeMonth);
  const receitas = roundMoney(
    lancamentosMes.filter((item) => item?.tipo === "receita").reduce((acc, item) => acc + Number(item?.valor || 0), 0)
  );
  const despesas = roundMoney(
    lancamentosMes.filter((item) => item?.tipo === "despesa").reduce((acc, item) => acc + Number(item?.valor || 0), 0)
  );
  const atribuicaoTotals = totalPorAtribuicaoLocal(lancamentosMes);
  const parcelasWalker =
    parcelasWalkerLancamentosMes(lancamentosMes) +
    parcelasWalkerCartaoMovimentosMes(cartaoMovimentos || [], safeMonth);

  return {
    mes: safeMonth,
    receitas,
    despesas,
    saldo: roundMoney(receitas - despesas),
    saldoAposAcertoDEA: roundMoney(receitas - atribuicaoTotals.walkerFinal),
    totalPorCategoria: totalByCategoryLocal(lancamentosMes),
    totalPorAtribuicao: atribuicaoTotals,
    receberPagarDEA: computeReceberPagarDEALocal(lancamentosMes),
    comprometimentoParcelas: receitas > 0 ? roundMoney(parcelasWalker / receitas) : 0
  };
}

export function computeParcelasDetalheLocal(month, lancamentos, cartaoMovimentos) {
  const safeMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : currentMonthKey();
  const lancamentosMes = filterByMonthLocal(lancamentos, safeMonth);
  const receitasMes = roundMoney(
    lancamentosMes.filter((item) => item?.tipo === "receita").reduce((acc, item) => acc + Number(item?.valor || 0), 0)
  );

  const items = [];
  for (const item of lancamentosMes) {
    if (item?.tipo !== "despesa") continue;
    if (!(Number(item?.parcela_total || 0) > 1)) continue;
    if (String(item?.metodo || "").toLowerCase() !== "cartao") continue;
    const valorParcela = splitByAtribuicao(item?.atribuicao, Number(item?.valor || 0)).walker;
    if (!(valorParcela > 0.009)) continue;
    items.push({
      id: item.id,
      origem: "lancamentos",
      descricao: item.descricao,
      categoria: item.categoria,
      cartao: null,
      valorParcela,
      parcelaTotal: item.parcela_total,
      parcelaNumero: item.parcela_numero,
      mesReferencia: safeMonth
    });
  }

  for (const item of cartaoMovimentos || []) {
    if (String(item?.mes_ref || "") !== safeMonth) continue;
    if (!(Number(item?.parcela_total || 0) > 1)) continue;
    const valorParcela = (item?.alocacoes || []).reduce(
      (acc, alocacao) => acc + splitByAtribuicao(alocacao?.atribuicao, Number(alocacao?.valor || 0)).walker,
      0
    );
    if (!(valorParcela > 0.009)) continue;
    items.push({
      id: item.id,
      origem: "cartoes",
      descricao: item.descricao,
      categoria: "CARTAO_CREDITO",
      cartao: item?.cartao?.nome || null,
      valorParcela,
      parcelaTotal: item.parcela_total,
      parcelaNumero: item.parcela_numero,
      mesReferencia: item.mes_ref
    });
  }

  const compras = items
    .filter((item) => item.parcelaTotal !== null && item.parcelaTotal > 1 && item.valorParcela > 0)
    .map((item) => {
      const totalParcelas = Math.trunc(item.parcelaTotal || 0);
      const pagasRaw = item.parcelaNumero || 1;
      const pagas = clamp(Math.trunc(pagasRaw), 1, totalParcelas);
      const restantes = Math.max(totalParcelas - pagas, 0);
      const valorTotalCompra = roundMoney(item.valorParcela * totalParcelas);
      const saldoEmAberto = roundMoney(item.valorParcela * restantes);
      return {
        id: item.id,
        origem: item.origem,
        descricao: String(item.descricao || "").trim(),
        categoria: String(item.categoria || "").trim() || "Sem categoria",
        cartao: item.cartao || null,
        valorParcela: roundMoney(item.valorParcela),
        valorTotalCompra,
        totalParcelas,
        pagas,
        restantes,
        saldoEmAberto,
        mesesFuturos: futureMonths(item.mesReferencia, restantes),
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
    mes: safeMonth,
    receitasMes,
    totalParcelasMes,
    totalParceladoEmAberto,
    comprometimentoParcelas: receitasMes > 0 ? totalParcelasMes / receitasMes : 0,
    compras
  };
}

export function computeComparativoMensalLocal(params) {
  const referenceMonth = /^\d{4}-\d{2}$/.test(String(params?.referenceMonth || ""))
    ? String(params.referenceMonth)
    : currentMonthKey();
  const months = monthsWindowEndingAt(referenceMonth, params?.windowSize || 12);
  const rows = months.map((mes) => {
    const report = computeRelatorioMensalLocal(mes, params?.lancamentos || [], params?.cartaoMovimentos || []);
    return {
      mes,
      receitas: report.receitas,
      despesas: report.despesas,
      saldo: report.saldo,
      saldoAposAcertoDEA: report.saldoAposAcertoDEA,
      comprometimentoParcelas: report.comprometimentoParcelas
    };
  });

  const totais = rows.reduce(
    (acc, item) => {
      acc.receitas += Number(item.receitas || 0);
      acc.despesas += Number(item.despesas || 0);
      acc.saldo += Number(item.saldo || 0);
      return acc;
    },
    { receitas: 0, despesas: 0, saldo: 0 }
  );

  return {
    referenceMonth,
    windowSize: rows.length,
    rows,
    totals: {
      receitas: roundMoney(totais.receitas),
      despesas: roundMoney(totais.despesas),
      saldo: roundMoney(totais.saldo)
    }
  };
}

export function computeProjection90DaysLocal(params) {
  const lancamentos = params?.lancamentos || [];
  const contasFixas = params?.contasFixas || [];
  const start = params?.fromDate ? new Date(params.fromDate) : new Date();
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 90);
  const baseStart = shiftYears(start, -1);
  const baseEnd = shiftYears(end, -1);
  const baseMonthsSet = new Set(monthRangeInclusive(baseStart, baseEnd));

  const receitasPorMes = new Map();
  for (const item of lancamentos) {
    if (item?.tipo !== "receita") continue;
    const date = parseIsoDateLocal(item?.data);
    if (!date) continue;
    const key = monthKey(date);
    if (!baseMonthsSet.has(key)) continue;
    const walker = splitByAtribuicao(item?.atribuicao, Number(item?.valor || 0)).walker;
    receitasPorMes.set(key, (receitasPorMes.get(key) || 0) + walker);
  }
  const receitasWalkerPorMesAnoAnterior = [...receitasPorMes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, total]) => ({ mes, total: roundMoney(total) }));
  const receitasPrevistas = roundMoney(
    receitasWalkerPorMesAnoAnterior.reduce((acc, item) => acc + Number(item.total || 0), 0)
  );

  const fixedLookups = buildFixedLookups(contasFixas);
  let avulsasTotal = 0;
  let cartaoTotal = 0;
  let cartaoValorParcelas = 0;
  let hasAnyCardParcelaInfo = false;
  const avulsasPorMes = new Map();

  for (const item of lancamentos) {
    if (item?.tipo !== "despesa") continue;
    const date = parseIsoDateLocal(item?.data);
    if (!date) continue;
    const key = monthKey(date);
    if (!baseMonthsSet.has(key)) continue;
    if (isContaFixaLancamento(item, fixedLookups)) continue;

    const walker = splitByAtribuicao(item?.atribuicao, Number(item?.valor || 0)).walker;
    avulsasTotal += walker;
    avulsasPorMes.set(key, (avulsasPorMes.get(key) || 0) + walker);

    if (isCartaoLancamento(item)) {
      cartaoTotal += walker;
      if (item?.parcela_total != null || item?.parcela_numero != null) hasAnyCardParcelaInfo = true;
      if (Number(item?.parcela_total || 0) > 1) cartaoValorParcelas += walker;
    }
  }

  const monthsCurrent = monthRangeInclusive(start, end);
  const despesasFixasPorMes = new Map();
  let despesasFixasPrevistas = 0;
  for (const mes of monthsCurrent) {
    let totalMes = 0;
    for (const conta of contasFixas) {
      if (!conta?.ativo) continue;
      const valorPrevisto = Number(conta?.valor_previsto || 0);
      if (!(valorPrevisto > 0)) continue;
      totalMes += splitByAtribuicao(conta?.atribuicao, valorPrevisto).walker;
    }
    const rounded = roundMoney(totalMes);
    despesasFixasPorMes.set(mes, rounded);
    despesasFixasPrevistas += rounded;
  }
  despesasFixasPrevistas = roundMoney(despesasFixasPrevistas);

  const despesasSazonaisPrevistas = roundMoney(avulsasTotal);
  const despesasWalkerPrevistas = roundMoney(despesasSazonaisPrevistas + despesasFixasPrevistas);
  const saldoProjetado = roundMoney(receitasPrevistas - despesasWalkerPrevistas);

  const valorParcelas = cartaoTotal <= 0 ? 0 : hasAnyCardParcelaInfo ? roundMoney(cartaoValorParcelas) : null;
  const despesasWalkerPorMes = monthsCurrent.map((mesAtual) => {
    const mesBaseAnoAnterior = shiftMonthKeyYears(mesAtual, -1);
    const avulsas = roundMoney(avulsasPorMes.get(mesBaseAnoAnterior) || 0);
    const fixas = roundMoney(despesasFixasPorMes.get(mesAtual) || 0);
    return {
      mes: mesAtual,
      mesBaseAnoAnterior,
      avulsas,
      fixas,
      cartao: 0,
      valorParcelasCartao: 0,
      semDadosParcelasCartao: false,
      total: roundMoney(avulsas + fixas)
    };
  });

  return {
    periodoInicio: formatYmd(start),
    periodoFim: formatYmd(end),
    periodoBaseInicio: formatYmd(baseStart),
    periodoBaseFim: formatYmd(baseEnd),
    receitasPrevistas,
    despesasFixasPrevistas,
    despesasWalkerPrevistas,
    despesasSazonaisPrevistas,
    parcelasPrevistas: valorParcelas,
    receitasWalkerPorMesAnoAnterior,
    despesasWalkerDetalhe: {
      avulsas: {
        total: despesasSazonaisPrevistas,
        percentual: despesasWalkerPrevistas > 0 ? despesasSazonaisPrevistas / despesasWalkerPrevistas : 0,
        cartao: {
          total: roundMoney(cartaoTotal),
          valorParcelas: valorParcelas,
          semDadosParcelas: cartaoTotal > 0 ? !hasAnyCardParcelaInfo : false
        }
      },
      fixas: {
        total: despesasFixasPrevistas,
        percentual: despesasWalkerPrevistas > 0 ? despesasFixasPrevistas / despesasWalkerPrevistas : 0
      }
    },
    despesasWalkerPorMes,
    saldoProjetado
  };
}

export function getMonthStartFromMonthKey(month) {
  return monthStartFromKey(month);
}
