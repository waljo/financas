import type { Atribuicao } from "@/lib/types";

export interface SplitResult {
  walker: number;
  dea: number;
}

export function splitByAtribuicao(atribuicao: Atribuicao, valor: number): SplitResult {
  switch (atribuicao) {
    case "WALKER":
      return { walker: valor, dea: 0 };
    case "DEA":
      return { walker: 0, dea: valor };
    case "AMBOS":
      return { walker: valor * 0.6, dea: valor * 0.4 };
    case "AMBOS_I":
      return { walker: valor * 0.4, dea: valor * 0.6 };
    default:
      return { walker: 0, dea: 0 };
  }
}

export function debtToWalkerFromAttribution(atribuicao: Atribuicao, valor: number): number {
  if (atribuicao === "DEA") return valor;
  if (atribuicao === "AMBOS") return valor * 0.4;
  if (atribuicao === "AMBOS_I") return valor * 0.6;
  return 0;
}

export function debtToDeaFromAttribution(atribuicao: Atribuicao, valor: number): number {
  if (atribuicao === "WALKER") return valor;
  if (atribuicao === "AMBOS") return valor * 0.6;
  if (atribuicao === "AMBOS_I") return valor * 0.4;
  return 0;
}
