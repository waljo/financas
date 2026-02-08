import { describe, expect, it } from "vitest";
import { computeComprometimentoParcelasDetalhe } from "@/domain/calculations";

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
