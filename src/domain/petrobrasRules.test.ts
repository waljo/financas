import { describe, expect, it } from "vitest";
import { parsePetrobrasRules, projectPetrobrasReceitas } from "@/domain/petrobrasRules";

describe("parsePetrobrasRules", () => {
  it("aceita chaves em formatos variados e valores pt-BR", () => {
    const rules = parsePetrobrasRules({
      SALARIO_D10: "3.500,50",
      "salario d25": "4.200,00",
      amsGrandeRisco: "250,75",
      "assistência suplementar médica": "149,25"
    });

    expect(rules.salario_d10).toBe(3500.5);
    expect(rules.salario_d25).toBe(4200);
    expect(rules.ams_grande_risco).toBe(250.75);
    expect(rules.assistencia_suplementar_medica).toBe(149.25);
  });

  it("soma aliases comuns quando chaves canonicas nao existem", () => {
    const rules = parsePetrobrasRules({
      salario_walker_d10: "2.000,00",
      salario_dea_d10: "1.500,00",
      salario_walker_d25: "2.100,00",
      salario_dea_d25: "1.600,00",
      ams_grande_risco_dea: "300,00",
      assistencia_medica_dea: "120,00"
    });

    expect(rules.salario_d10).toBe(3500);
    expect(rules.salario_d25).toBe(3700);
    expect(rules.ams_grande_risco).toBe(300);
    expect(rules.assistencia_suplementar_medica).toBe(120);
  });
});

describe("projectPetrobrasReceitas", () => {
  it("aplica receitas e despesas compartilhadas em D10 e D25", () => {
    const result = projectPetrobrasReceitas(
      {
        salario_d10: 1000,
        salario_d25: 2000,
        ams_grande_risco: 100,
        assistencia_suplementar_medica: 50
      },
      new Date(2026, 1, 1),
      30
    );

    expect(result.receitas).toBe(3150);
    expect(result.despesasCompartilhadas).toBe(150);
  });
});
