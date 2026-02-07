import { describe, expect, it } from "vitest";
import type { CartaoMovimentoComAlocacoes } from "@/lib/types";
import { reconcileImportLines } from "@/domain/cartoes";

function movement(input: {
  id: string;
  cartao_id?: string;
  data: string;
  descricao: string;
  valor: number;
  tx_key: string;
}): CartaoMovimentoComAlocacoes {
  return {
    id: input.id,
    cartao_id: input.cartao_id ?? "c1",
    data: input.data,
    descricao: input.descricao,
    valor: input.valor,
    parcela_total: null,
    parcela_numero: null,
    tx_key: input.tx_key,
    origem: "manual",
    status: "conciliado",
    mes_ref: "2026-02",
    observacao: "",
    created_at: "2026-02-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
    cartao: null,
    alocacoes: []
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
