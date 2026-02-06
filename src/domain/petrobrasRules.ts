import { addDays, isWithinInterval } from "date-fns";

export interface PetrobrasRuleSet {
  salario_d10: number;
  salario_d25: number;
  ams_grande_risco: number;
  assistencia_suplementar_medica: number;
}

function parseRule(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parsePetrobrasRules(input: Record<string, string>): PetrobrasRuleSet {
  return {
    salario_d10: parseRule(input.salario_d10),
    salario_d25: parseRule(input.salario_d25),
    ams_grande_risco: parseRule(input.ams_grande_risco),
    assistencia_suplementar_medica: parseRule(input.assistencia_suplementar_medica)
  };
}

export function projectPetrobrasReceitas(
  rules: PetrobrasRuleSet,
  startDate: Date,
  horizonDays = 90
): { receitas: number; despesasCompartilhadas: number } {
  const endDate = addDays(startDate, horizonDays);
  let receitas = 0;
  let despesasCompartilhadas = 0;

  for (let i = 0; i <= horizonDays; i += 1) {
    const date = addDays(startDate, i);
    if (!isWithinInterval(date, { start: startDate, end: endDate })) continue;

    const day = date.getDate();
    if (day === 10) {
      receitas += rules.salario_d10;
    }

    if (day === 25) {
      const extras = rules.ams_grande_risco + rules.assistencia_suplementar_medica;
      receitas += rules.salario_d25 + extras;
      despesasCompartilhadas += extras;
    }
  }

  return { receitas, despesasCompartilhadas };
}
