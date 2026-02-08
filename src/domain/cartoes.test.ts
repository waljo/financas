import { describe, expect, it } from "vitest";
import type { CartaoMovimentoComAlocacoes } from "@/lib/types";
import { computeCartaoTotalizadores, reconcileImportLines } from "@/domain/cartoes";

function movement(input: {
  id: string;
  cartao_id?: string;
  data: string;
  descricao: string;
  valor: number;
  tx_key: string;
  parcela_total?: number | null;
  parcela_numero?: number | null;
  status?: CartaoMovimentoComAlocacoes["status"];
  mes_ref?: string;
  banco?: "C6" | "BB" | "OUTRO";
  alocacoes?: Array<{ atribuicao: "WALKER" | "AMBOS" | "DEA" | "AMBOS_I"; valor: number }>;
}): CartaoMovimentoComAlocacoes {
  const cartaoId = input.cartao_id ?? "c1";
  const banco = input.banco ?? "C6";
  return {
    id: input.id,
    cartao_id: cartaoId,
    data: input.data,
    descricao: input.descricao,
    valor: input.valor,
    parcela_total: input.parcela_total ?? null,
    parcela_numero: input.parcela_numero ?? null,
    tx_key: input.tx_key,
    origem: "manual",
    status: input.status ?? "conciliado",
    mes_ref: input.mes_ref ?? "2026-02",
    observacao: "",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    cartao: {
      id: cartaoId,
      nome: `${banco} CARD`,
      banco,
      titular: "WALKER",
      final_cartao: "",
      padrao_atribuicao: "AMBOS",
      ativo: true,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z"
    },
    alocacoes: (input.alocacoes ?? []).map((item, index) => ({
      id: `${input.id}-a${index + 1}`,
      movimento_id: input.id,
      atribuicao: item.atribuicao,
      valor: item.valor,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z"
    }))
  };
}

describe("reconcileImportLines", () => {
  const cartao = {
    id: "c1",
    nome: "C6 JULIA",
    banco: "C6" as const,
    titular: "JULIA" as const,
    final_cartao: "4985",
    padrao_atribuicao: "AMBOS" as const,
    ativo: true,
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z"
  };

  it("marca como ja_lancado quando descricao parcial bate com data e valor", () => {
    const existing = [
      movement({
        id: "m1",
        data: "2026-01-10",
        descricao: "UBER",
        valor: 36.72,
        tx_key: "c1|2026-01-10|UBER|36.72|1/1"
      })
    ];

    const result = reconcileImportLines({
      cartao,
      existing,
      lines: [
        {
          data: "2026-01-10",
          descricao: "UBER UBER *TRIP HELP.U",
          valor: 36.72
        }
      ]
    });

    expect(result.conciliados).toBe(1);
    expect(result.novos).toBe(0);
    expect(result.preview[0]?.status).toBe("ja_lancado");
    expect(result.preview[0]?.movimentoId).toBe("m1");
  });

  it("nao faz conciliacao frouxa quando ha ambiguidade", () => {
    const existing = [
      movement({
        id: "m1",
        data: "2026-01-10",
        descricao: "UBER",
        valor: 36.72,
        tx_key: "c1|2026-01-10|UBER|36.72|1/1"
      }),
      movement({
        id: "m2",
        data: "2026-01-10",
        descricao: "UBER TRIP",
        valor: 36.72,
        tx_key: "c1|2026-01-10|UBER TRIP|36.72|1/1"
      })
    ];

    const result = reconcileImportLines({
      cartao,
      existing,
      lines: [
        {
          data: "2026-01-10",
          descricao: "UBER UBER *TRIP HELP.U",
          valor: 36.72
        }
      ]
    });

    expect(result.conciliados).toBe(0);
    expect(result.novos).toBe(1);
    expect(result.preview[0]?.status).toBe("novo");
  });

  it("suporta compras duplicadas com mesma data/descricao/valor", () => {
    const existing = [
      movement({
        id: "m1",
        data: "2026-01-10",
        descricao: "UBER UBER *TRIP HELP.U",
        valor: 36.72,
        tx_key: "c1|2026-01-10|UBER UBER *TRIP HELP.U|36.72|1/1"
      }),
      movement({
        id: "m2",
        data: "2026-01-10",
        descricao: "UBER UBER *TRIP HELP.U",
        valor: 36.72,
        tx_key: "c1|2026-01-10|UBER UBER *TRIP HELP.U|36.72|1/1"
      })
    ];

    const result = reconcileImportLines({
      cartao,
      existing,
      lines: [
        {
          data: "2026-01-10",
          descricao: "UBER UBER *TRIP HELP.U",
          valor: 36.72
        },
        {
          data: "2026-01-10",
          descricao: "UBER UBER *TRIP HELP.U",
          valor: 36.72
        }
      ]
    });

    expect(result.conciliados).toBe(2);
    expect(result.novos).toBe(0);
    expect(result.preview[0]?.movimentoId).not.toBe(result.preview[1]?.movimentoId);
  });
});

describe("computeCartaoTotalizadores", () => {
  it("calcula parcelas do mes e total parcelado em aberto", () => {
    const movimentos = [
      movement({
        id: "p1",
        data: "2026-02-05",
        descricao: "Notebook",
        valor: 100,
        tx_key: "k1",
        parcela_numero: 3,
        parcela_total: 10,
        status: "conciliado",
        banco: "C6",
        alocacoes: [{ atribuicao: "WALKER", valor: 100 }]
      }),
      movement({
        id: "p2",
        data: "2026-02-12",
        descricao: "Passagem",
        valor: 50,
        tx_key: "k2",
        parcela_numero: 2,
        parcela_total: 5,
        status: "pendente",
        banco: "C6"
      }),
      movement({
        id: "x1",
        data: "2026-02-20",
        descricao: "Restaurante",
        valor: 70,
        tx_key: "k3",
        status: "conciliado",
        banco: "C6",
        alocacoes: [{ atribuicao: "AMBOS", valor: 70 }]
      }),
      movement({
        id: "z1",
        data: "2026-02-08",
        descricao: "Compra BB",
        valor: 40,
        tx_key: "k4",
        parcela_numero: 1,
        parcela_total: 4,
        status: "conciliado",
        banco: "BB",
        alocacoes: [{ atribuicao: "DEA", valor: 40 }]
      }),
      movement({
        id: "z2",
        data: "2026-01-08",
        descricao: "Compra mes anterior",
        valor: 60,
        tx_key: "k5",
        parcela_numero: 1,
        parcela_total: 3,
        status: "conciliado",
        mes_ref: "2026-01",
        banco: "C6",
        alocacoes: [{ atribuicao: "DEA", valor: 60 }]
      })
    ];

    const result = computeCartaoTotalizadores({
      movimentos,
      mes: "2026-02",
      banco: "C6"
    });

    expect(result.parcelasDoMes).toBe(150);
    expect(result.totalParceladoEmAberto).toBe(970);
    expect(result.totalParceladoEmAbertoProjetado).toBe(910);
    expect(result.pendentes).toBe(1);
    expect(result.porAtribuicao.WALKER).toBe(100);
    expect(result.porAtribuicao.AMBOS).toBe(70);
    expect(result.porAtribuicao.DEA).toBe(0);
  });
});
