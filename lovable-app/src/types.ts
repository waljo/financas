export interface ProjecaoNoventaDias {
  periodoInicio: string;
  periodoFim: string;
  receitasPrevistas: number;
  despesasWalkerPrevistas: number;
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
  projecao90Dias: ProjecaoNoventaDias;
}

export interface Lancamento {
  id: string;
  data: string;
  tipo: "despesa" | "receita";
  descricao: string;
  categoria: string;
  valor: number;
  atribuicao: string;
  metodo: string;
  observacao: string;
}

export interface SyncStatus {
  online: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  pendingOps: number;
  failedOps: number;
}
