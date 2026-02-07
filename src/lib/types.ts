export const TIPO_LANCAMENTO = ["despesa", "receita"] as const;
export type TipoLancamento = (typeof TIPO_LANCAMENTO)[number];

export const ATRIBUICOES = ["WALKER", "DEA", "AMBOS", "AMBOS_I"] as const;
export type Atribuicao = (typeof ATRIBUICOES)[number];

export const METODOS = ["pix", "cartao", "dinheiro", "transferencia", "outro"] as const;
export type MetodoPagamento = (typeof METODOS)[number];

export const PESSOA_PAGADORA = ["WALKER", "DEA"] as const;
export type PessoaPagadora = (typeof PESSOA_PAGADORA)[number];

export const BANCOS_CARTAO = ["C6", "BB", "OUTRO"] as const;
export type BancoCartao = (typeof BANCOS_CARTAO)[number];

export const TITULARES_CARTAO = ["WALKER", "DEA", "JULIA", "OUTRO"] as const;
export type TitularCartao = (typeof TITULARES_CARTAO)[number];

export const ORIGENS_CARTAO_MOVIMENTO = ["manual", "fatura"] as const;
export type OrigemCartaoMovimento = (typeof ORIGENS_CARTAO_MOVIMENTO)[number];

export const STATUS_CARTAO_MOVIMENTO = ["pendente", "conciliado"] as const;
export type StatusCartaoMovimento = (typeof STATUS_CARTAO_MOVIMENTO)[number];

export interface Lancamento {
  id: string;
  data: string;
  tipo: TipoLancamento;
  descricao: string;
  categoria: string;
  valor: number;
  atribuicao: Atribuicao;
  metodo: MetodoPagamento;
  parcela_total: number | null;
  parcela_numero: number | null;
  observacao: string;
  created_at: string;
  updated_at: string;
  quem_pagou: PessoaPagadora;
}

export interface ContaFixa {
  id: string;
  nome: string;
  dia_vencimento: number;
  valor_previsto: number | null;
  atribuicao: Atribuicao;
  categoria: string;
  avisar_dias_antes: string;
  ativo: boolean;
}

export interface CalendarioAnual {
  id: string;
  mes: number;
  evento: string;
  valor_estimado: number;
  avisar_dias_antes: string;
  atribuicao: Atribuicao;
  categoria: string;
  observacao: string;
  dia_mes: number | null;
}

export interface ReceitasRegra {
  chave: string;
  valor: string;
}

export interface RelatorioMensal {
  mes: string;
  receitas: number;
  despesas: number;
  saldo: number;
  saldoAposAcertoDEA: number;
  totalPorCategoria: Array<{ categoria: string; total: number }>;
  totalPorAtribuicao: {
    WALKER: number;
    DEA: number;
    AMBOS: number;
    AMBOS_I: number;
    walkerFinal: number;
    deaFinal: number;
  };
  receberPagarDEA: number;
  comprometimentoParcelas: number;
}

export interface ProjecaoNoventaDias {
  periodoInicio: string;
  periodoFim: string;
  receitasPrevistas: number;
  despesasFixasPrevistas: number;
  despesasSazonaisPrevistas: number;
  parcelasPrevistas: number;
  saldoProjetado: number;
}

export interface DashboardData {
  mes: string;
  saldoMes: number;
  receitasMes: number;
  despesasMes: number;
  saldoAposAcertoDEA: number;
  receberPagarDEA: number;
  balancoSistema: number;
  balancoReal: number;
  diferencaBalanco: number;
  saldoBancoReferencia: number;
  saldoCarteiraReferencia: number;
  fonteSaldoReal: "manual" | "legacy" | "mixed";
  projecao90Dias: ProjecaoNoventaDias;
}

export interface CartaoCredito {
  id: string;
  nome: string;
  banco: BancoCartao;
  titular: TitularCartao;
  final_cartao: string;
  padrao_atribuicao: Atribuicao;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CartaoMovimento {
  id: string;
  cartao_id: string;
  data: string;
  descricao: string;
  valor: number;
  parcela_total: number | null;
  parcela_numero: number | null;
  tx_key: string;
  origem: OrigemCartaoMovimento;
  status: StatusCartaoMovimento;
  mes_ref: string;
  observacao: string;
  created_at: string;
  updated_at: string;
}

export interface CartaoAlocacao {
  id: string;
  movimento_id: string;
  atribuicao: Atribuicao;
  valor: number;
  created_at: string;
  updated_at: string;
}

export interface CartaoMovimentoComAlocacoes extends CartaoMovimento {
  cartao: CartaoCredito | null;
  alocacoes: CartaoAlocacao[];
}

export interface TotalizadoresCartao {
  mes: string;
  banco: BancoCartao;
  porAtribuicao: {
    WALKER: number;
    AMBOS: number;
    DEA: number;
  };
}
