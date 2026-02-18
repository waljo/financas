import type {
  CalendarioAnual,
  CartaoCredito,
  CartaoMovimentoComAlocacoes,
  Categoria,
  ContaFixa,
  Lancamento,
  ReceitasRegra
} from "@/lib/types";

export const MOBILE_BOOTSTRAP_SCHEMA_VERSION = 1;

export interface MobileBootstrapData {
  lancamentos: Lancamento[];
  contas_fixas: ContaFixa[];
  calendario_anual: CalendarioAnual[];
  receitas_regras: ReceitasRegra[];
  categorias: Categoria[];
  cartoes: CartaoCredito[];
  cartao_movimentos: CartaoMovimentoComAlocacoes[];
}

export interface MobileBootstrapResponse {
  ok: true;
  schema_version: typeof MOBILE_BOOTSTRAP_SCHEMA_VERSION;
  generated_at: string;
  counts: {
    lancamentos: number;
    contas_fixas: number;
    calendario_anual: number;
    receitas_regras: number;
    categorias: number;
    cartoes: number;
    cartao_movimentos: number;
  };
  data: MobileBootstrapData;
}

