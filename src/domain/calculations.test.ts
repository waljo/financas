import { describe, expect, it } from "vitest";
import { computeComprometimentoParcelasDetalhe, computeProjection90Days } from "@/domain/calculations";
import type { ContaFixa, Lancamento } from "@/lib/types";

function receita(
  id: string,
  data: string,
  valor: number,
  atribuicao: Lancamento["atribuicao"] = "WALKER"
): Lancamento {
  return {
    id,
    data,
    tipo: "receita",
    descricao: `Receita ${id}`,
    categoria: "RECEITAS",
    valor,
    atribuicao,
    metodo: "pix",
    parcela_total: null,
    parcela_numero: null,
    observacao: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    quem_pagou: "WALKER"
  };
}

function despesa(
  id: string,
  data: string,
  valor: number,
  atribuicao: Lancamento["atribuicao"],
  options?: {
    descricao?: string;
    categoria?: string;
    metodo?: Lancamento["metodo"];
    parcela_total?: number | null;
    parcela_numero?: number | null;
  }
): Lancamento {
  return {
    id,
    data,
    tipo: "despesa",
    descricao: options?.descricao ?? `Despesa ${id}`,
    categoria: options?.categoria ?? "GERAL",
    valor,
    atribuicao,
    metodo: options?.metodo ?? "pix",
    parcela_total: options?.parcela_total ?? null,
    parcela_numero: options?.parcela_numero ?? null,
    observacao: "",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    quem_pagou: "WALKER"
  };
}

describe("computeComprometimentoParcelasDetalhe", () => {
  it("monta detalhe com pagas/restantes e meses futuros", () => {
    const result = computeComprometimentoParcelasDetalhe({
      month: "2026-02",
      receitasMes: 2000,
      items: [
        {
          id: "a",
          origem: "cartoes",
          descricao: "Notebook",
          categoria: "CARTAO_CREDITO",
          cartao: "C6 BLACK",
          valorParcela: 120,
          parcelaTotal: 10,
          parcelaNumero: 3,
          mesReferencia: "2026-02"
        },
        {
          id: "b",
          origem: "lancamentos",
          descricao: "Curso",
          categoria: "EDUCACAO",
          valorParcela: 80,
          parcelaTotal: 5,
          parcelaNumero: null,
          mesReferencia: "2026-02"
        }
      ]
    });

    expect(result.totalParcelasMes).toBe(200);
    expect(result.totalParceladoEmAberto).toBe(1160);
    expect(result.comprometimentoParcelas).toBe(0.1);
    expect(result.compras[0]?.descricao).toBe("Notebook");
    expect(result.compras[0]?.pagas).toBe(3);
    expect(result.compras[0]?.restantes).toBe(7);
    expect(result.compras[0]?.mesesFuturos[0]).toBe("2026-03");
    expect(result.compras[1]?.estimado).toBe(true);
    expect(result.compras[1]?.pagas).toBe(1);
    expect(result.compras[1]?.restantes).toBe(4);
  });
});

describe("computeProjection90Days", () => {
  it("usa ano anterior para receitas/despesas WALKER e retorna saldo projetado", () => {
    const lancamentos: Lancamento[] = [
      receita("r1", "2025-02-05", 1000, "WALKER"),
      receita("r2", "2025-03-10", 2000, "AMBOS"),
      receita("r3", "2025-04-01", 3000, "AMBOS_I"),
      despesa("d1", "2025-02-15", 500, "WALKER")
    ];

    const result = computeProjection90Days({
      lancamentos,
      contasFixas: [],
      calendarioAnual: [],
      receitasRegras: [],
      fromDate: new Date(2026, 1, 1)
    });

    expect(result.periodoInicio).toBe("2026-02-01");
    expect(result.periodoFim).toBe("2026-05-02");
    expect(result.periodoBaseInicio).toBe("2025-02-01");
    expect(result.periodoBaseFim).toBe("2025-05-02");
    expect(result.receitasPrevistas).toBe(3400);
    expect(result.despesasWalkerPrevistas).toBe(500);
    expect(result.saldoProjetado).toBe(2900);
    expect(result.receitasWalkerPorMesAnoAnterior).toEqual([
      { mes: "2025-02", total: 1000 },
      { mes: "2025-03", total: 1200 },
      { mes: "2025-04", total: 1200 }
    ]);
    expect(result.despesasWalkerPorMes[0]).toMatchObject({
      mes: "2026-02",
      mesBaseAnoAnterior: "2025-02",
      total: 500
    });
  });

  it("combina avulsas do ano anterior com fixas atuais e detalha cartao/parcelas dentro de avulsas", () => {
    const contasFixas: ContaFixa[] = [
      {
        id: "cf-1",
        nome: "ALUGUEL",
        dia_vencimento: 5,
        valor_previsto: 1000,
        atribuicao: "AMBOS",
        quem_pagou: "WALKER",
        categoria: "MORADIA",
        avisar_dias_antes: "5,2",
        ativo: true
      }
    ];

    const lancamentos: Lancamento[] = [
      despesa("f1", "2025-02-10", 1000, "AMBOS", { descricao: "ALUGUEL", categoria: "MORADIA" }),
      despesa("a1", "2025-03-10", 400, "WALKER", { descricao: "FARMACIA", categoria: "SAUDE" }),
      despesa("p1", "2025-04-10", 300, "AMBOS_I", {
        descricao: "NOTEBOOK",
        categoria: "ELETRONICOS",
        metodo: "cartao",
        parcela_total: 3,
        parcela_numero: 1
      })
    ];

    const result = computeProjection90Days({
      lancamentos,
      contasFixas,
      calendarioAnual: [],
      receitasRegras: [],
      fromDate: new Date(2026, 1, 1)
    });

    expect(result.despesasWalkerPrevistas).toBe(2920);
    expect(result.despesasFixasPrevistas).toBe(2400);
    expect(result.despesasSazonaisPrevistas).toBe(520);
    expect(result.parcelasPrevistas).toBe(120);
    expect(result.despesasWalkerDetalhe.fixas.percentual).toBeCloseTo(2400 / 2920, 5);
    expect(result.despesasWalkerDetalhe.avulsas.percentual).toBeCloseTo(520 / 2920, 5);
    expect(result.despesasWalkerDetalhe.avulsas.cartao.total).toBe(120);
    expect(result.despesasWalkerDetalhe.avulsas.cartao.valorParcelas).toBe(120);
    expect(result.despesasWalkerDetalhe.avulsas.cartao.semDadosParcelas).toBe(false);
    expect(result.despesasWalkerPorMes).toEqual([
      expect.objectContaining({ mes: "2026-02", total: 600, avulsas: 0, fixas: 600 }),
      expect.objectContaining({ mes: "2026-03", total: 1000, avulsas: 400, fixas: 600 }),
      expect.objectContaining({ mes: "2026-04", total: 720, avulsas: 120, fixas: 600 }),
      expect.objectContaining({ mes: "2026-05", total: 600, avulsas: 0, fixas: 600 })
    ]);
  });

  it("retorna S/D para valor parcelas quando cartao no ano anterior nao possui dados de parcela", () => {
    const lancamentos: Lancamento[] = [
      despesa("d1", "2025-02-10", 800, "AMBOS", { categoria: "C_C6-WALKER" }),
      despesa("d2", "2025-03-10", 200, "WALKER", { categoria: "SAUDE" })
    ];

    const result = computeProjection90Days({
      lancamentos,
      contasFixas: [],
      calendarioAnual: [],
      receitasRegras: [],
      fromDate: new Date(2026, 1, 1)
    });

    expect(result.parcelasPrevistas).toBeNull();
    expect(result.despesasWalkerDetalhe.avulsas.cartao.total).toBe(480);
    expect(result.despesasWalkerDetalhe.avulsas.cartao.semDadosParcelas).toBe(true);
    expect(result.despesasWalkerDetalhe.avulsas.cartao.valorParcelas).toBeNull();
    expect(result.despesasWalkerPorMes).toEqual([
      expect.objectContaining({ mes: "2026-02", total: 480, cartao: 480 }),
      expect.objectContaining({ mes: "2026-03", total: 200, cartao: 0 }),
      expect.objectContaining({ mes: "2026-04", total: 0, cartao: 0 }),
      expect.objectContaining({ mes: "2026-05", total: 0, cartao: 0 })
    ]);
  });

  it("considera o mes completo no detalhamento de receitas do periodo-base", () => {
    const lancamentos: Lancamento[] = [
      receita("r1", "2025-03-10", 1000, "WALKER"),
      receita("r2", "2025-05-30", 2000, "WALKER"),
      receita("r3", "2025-05-31", 3000, "WALKER")
    ];

    const result = computeProjection90Days({
      lancamentos,
      contasFixas: [],
      calendarioAnual: [],
      receitasRegras: [],
      fromDate: new Date(2026, 2, 1)
    });

    expect(result.receitasWalkerPorMesAnoAnterior).toEqual([
      { mes: "2025-03", total: 1000 },
      { mes: "2025-05", total: 5000 }
    ]);
    expect(result.receitasPrevistas).toBe(6000);
  });
});
