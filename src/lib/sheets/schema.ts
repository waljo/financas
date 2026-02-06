export const SHEET_SCHEMA = {
  LANCAMENTOS: [
    "id",
    "data",
    "tipo",
    "descricao",
    "categoria",
    "valor",
    "atribuicao",
    "metodo",
    "parcela_total",
    "parcela_numero",
    "observacao",
    "created_at",
    "updated_at",
    "quem_pagou"
  ],
  CONTAS_FIXAS: [
    "id",
    "nome",
    "dia_vencimento",
    "valor_previsto",
    "atribuicao",
    "categoria",
    "avisar_dias_antes",
    "ativo"
  ],
  CALENDARIO_ANUAL: [
    "id",
    "mes",
    "evento",
    "valor_estimado",
    "avisar_dias_antes",
    "atribuicao",
    "categoria",
    "observacao",
    "dia_mes"
  ],
  RECEITAS_REGRAS: ["chave", "valor"]
} as const;

export type SheetName = keyof typeof SHEET_SCHEMA;

export function getSheetHeaders(sheetName: SheetName): string[] {
  return [...SHEET_SCHEMA[sheetName]];
}
