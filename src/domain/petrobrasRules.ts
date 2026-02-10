import { addDays, isWithinInterval } from "date-fns";
import { parseNumber } from "@/lib/utils";

export interface PetrobrasRuleSet {
  salario_d10: number;
  salario_d25: number;
  ams_grande_risco: number;
  assistencia_suplementar_medica: number;
}

function parseRule(value: string | undefined): number {
  if (!value) return 0;
  return parseNumber(value, 0);
}

function normalizeRuleKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parsePetrobrasRules(input: Record<string, string>): PetrobrasRuleSet {
  const entries = Object.entries(input).map(([rawKey, rawValue]) => ({
    key: normalizeRuleKey(rawKey),
    value: parseRule(rawValue)
  }));

  function hasExact(key: string): boolean {
    return entries.some((item) => item.key === key);
  }

  function sumExact(key: string): number {
    return entries.filter((item) => item.key === key).reduce((acc, item) => acc + item.value, 0);
  }

  function sumByPattern(pattern: RegExp): number {
    return entries.filter((item) => pattern.test(item.key)).reduce((acc, item) => acc + item.value, 0);
  }

  // If canonical keys exist, they win; otherwise, fallback to common aliases/patterns.
  const salarioD10 = hasExact("salario_d10")
    ? sumExact("salario_d10")
    : sumByPattern(/salario.*(?:d_?10|dia_?10|_10$|10$)/);
  const salarioD25 = hasExact("salario_d25")
    ? sumExact("salario_d25")
    : sumByPattern(/salario.*(?:d_?25|dia_?25|_25$|25$)/);
  const amsGrandeRisco = hasExact("ams_grande_risco")
    ? sumExact("ams_grande_risco")
    : sumByPattern(/(?:^|_)ams(?:_|$).*grande.*risco|grande.*risco.*(?:^|_)ams(?:_|$)/);
  const assistenciaSuplementarMedica = hasExact("assistencia_suplementar_medica")
    ? sumExact("assistencia_suplementar_medica")
    : sumByPattern(/assistencia.*suplementar.*medic|assistencia.*medic|suplementar.*medic/);

  return {
    salario_d10: salarioD10,
    salario_d25: salarioD25,
    ams_grande_risco: amsGrandeRisco,
    assistencia_suplementar_medica: assistenciaSuplementarMedica
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
