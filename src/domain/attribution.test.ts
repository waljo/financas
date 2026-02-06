import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { splitByAtribuicao } from "@/domain/attribution";
import { computeReceberPagarDEA } from "@/domain/calculations";
import type { Lancamento } from "@/lib/types";

describe("splitByAtribuicao", () => {
  it("aplica regra 60/40 em AMBOS", () => {
    const split = splitByAtribuicao("AMBOS", 1000);
    expect(split.walker).toBe(600);
    expect(split.dea).toBe(400);
  });

  it("aplica regra invertida 40/60 em AMBOS_I", () => {
    const split = splitByAtribuicao("AMBOS_I", 1000);
    expect(split.walker).toBe(400);
    expect(split.dea).toBe(600);
  });
});

describe("computeReceberPagarDEA", () => {
  it("replica formula RECEBER/PAGAR DEA", () => {
    const base: Omit<Lancamento, "id" | "data" | "descricao" | "categoria" | "metodo" | "parcela_total" | "parcela_numero" | "observacao" | "created_at" | "updated_at"> = {
      tipo: "despesa",
      valor: 0,
      atribuicao: "AMBOS",
      quem_pagou: "WALKER"
    };

    const lancamentos: Lancamento[] = [
      {
        ...base,
        id: randomUUID(),
        data: "2026-01-05",
        descricao: "Conta DEA paga por WALKER",
        categoria: "teste",
        metodo: "pix",
        parcela_total: null,
        parcela_numero: null,
        observacao: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        atribuicao: "DEA",
        valor: 100,
        quem_pagou: "WALKER"
      },
      {
        ...base,
        id: randomUUID(),
        data: "2026-01-06",
        descricao: "Ambos pago por WALKER",
        categoria: "teste",
        metodo: "pix",
        parcela_total: null,
        parcela_numero: null,
        observacao: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        atribuicao: "AMBOS",
        valor: 100,
        quem_pagou: "WALKER"
      },
      {
        ...base,
        id: randomUUID(),
        data: "2026-01-07",
        descricao: "Walker pago por DEA",
        categoria: "teste",
        metodo: "pix",
        parcela_total: null,
        parcela_numero: null,
        observacao: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        atribuicao: "WALKER",
        valor: 50,
        quem_pagou: "DEA"
      }
    ];

    const result = computeReceberPagarDEA(lancamentos);

    // 100 (DEA/WALKER) + 40 (AMBOS/WALKER) - 50 (WALKER/DEA) = 90
    expect(result).toBe(90);
  });
});
