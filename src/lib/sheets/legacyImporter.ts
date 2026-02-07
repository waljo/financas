import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import type { Lancamento, MetodoPagamento, PessoaPagadora } from "@/lib/types";
import { parseNumber, toIsoNow } from "@/lib/utils";

export interface LegacyMonthBlock {
  label: string;
  month: number;
  startCol: number;
}

export interface LegacyImportMapping {
  descricaoCol: number;
  valorCol: number;
  diaCol: number;
  atribuicaoCol?: number;
  quemPagouCol?: number;
  categoriaCol?: number;
}

export interface LegacyImportPreviewInput {
  grid: string[][];
  tipo: Lancamento["tipo"];
  year: number;
  monthStartCol: number;
  startRow: number;
  endRow: number;
  onlyNegative?: boolean;
  mapping: LegacyImportMapping;
  defaults?: {
    categoria?: string;
    atribuicao?: Lancamento["atribuicao"];
    metodo?: MetodoPagamento;
    quem_pagou?: PessoaPagadora;
  };
}

const MONTHS: Record<string, number> = {
  JANEIRO: 1,
  FEVEREIRO: 2,
  MARCO: 3,
  "MARÇO": 3,
  ABRIL: 4,
  MAIO: 5,
  JUNHO: 6,
  JULHO: 7,
  AGOSTO: 8,
  SETEMBRO: 9,
  OUTUBRO: 10,
  NOVEMBRO: 11,
  DEZEMBRO: 12
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function detectMonthBlocks(firstRow: string[]): LegacyMonthBlock[] {
  const blocks: LegacyMonthBlock[] = [];

  firstRow.forEach((value, index) => {
    const key = normalize(value ?? "");
    const month = MONTHS[key];
    if (month) {
      blocks.push({
        label: key,
        month,
        startCol: index + 1
      });
    }
  });

  return blocks.sort((a, b) => a.startCol - b.startCol);
}

function getCell(grid: string[][], row: number, col: number): string {
  return grid[row - 1]?.[col - 1]?.trim() ?? "";
}

function monthFromBlock(grid: string[][], monthStartCol: number): number {
  const firstRow = grid[0] ?? [];
  const monthText = firstRow[monthStartCol - 1] ?? "";
  const month = MONTHS[normalize(monthText)];
  if (!month) {
    throw new AppError(`Nao foi possivel detectar o mes para coluna ${monthStartCol}`, 400, "INVALID_MONTH");
  }
  return month;
}

function clampDay(year: number, month: number, day: number): number {
  const maxDay = new Date(year, month, 0).getDate();
  if (day < 1) return 1;
  if (day > maxDay) return maxDay;
  return day;
}

export function previewLegacyImport(input: LegacyImportPreviewInput): {
  month: number;
  count: number;
  sample: Lancamento[];
  rows: Lancamento[];
} {
  if (input.endRow < input.startRow) {
    throw new AppError("endRow deve ser maior ou igual a startRow", 400, "INVALID_RANGE");
  }

  const month = monthFromBlock(input.grid, input.monthStartCol);
  const tipo = input.tipo ?? "despesa";
  const now = toIsoNow();
  const onlyNegative = Boolean(input.onlyNegative);
  const rows: Lancamento[] = [];

  for (let row = input.startRow; row <= input.endRow; row += 1) {
    const descricao = getCell(input.grid, row, input.mapping.descricaoCol);
    const valor = parseNumber(getCell(input.grid, row, input.mapping.valorCol), 0);

    if (!descricao || valor === 0) {
      continue;
    }
    if (onlyNegative && valor >= 0) {
      continue;
    }

    const day = Math.trunc(parseNumber(getCell(input.grid, row, input.mapping.diaCol), 1));
    const diaAjustado = clampDay(input.year, month, day || 1);
    const atribuicaoRaw = input.mapping.atribuicaoCol
      ? normalize(getCell(input.grid, row, input.mapping.atribuicaoCol))
      : "";
    const quemRaw = input.mapping.quemPagouCol
      ? normalize(getCell(input.grid, row, input.mapping.quemPagouCol))
      : "";
    const categoriaRaw = input.mapping.categoriaCol
      ? getCell(input.grid, row, input.mapping.categoriaCol)
      : "";

    const atribuicao = ["WALKER", "DEA", "AMBOS", "AMBOS_I"].includes(atribuicaoRaw)
      ? (atribuicaoRaw as Lancamento["atribuicao"])
      : input.defaults?.atribuicao ?? (tipo === "receita" ? "WALKER" : "AMBOS");

    const quem_pagou = ["WALKER", "DEA"].includes(quemRaw)
      ? (quemRaw as Lancamento["quem_pagou"])
      : input.defaults?.quem_pagou ?? "WALKER";

    const date = `${input.year}-${String(month).padStart(2, "0")}-${String(diaAjustado).padStart(2, "0")}`;
    const lancamento: Lancamento = {
      id: randomUUID(),
      data: date,
      tipo,
      descricao,
      categoria: categoriaRaw || input.defaults?.categoria || (tipo === "receita" ? "RECEITAS" : descricao),
      valor,
      atribuicao,
      metodo: input.defaults?.metodo ?? "outro",
      parcela_total: null,
      parcela_numero: null,
      observacao: `Importado da planilha legada (linha ${row})`,
      created_at: now,
      updated_at: now,
      quem_pagou
    };

    rows.push(lancamento);
  }

  return {
    month,
    count: rows.length,
    sample: rows.slice(0, 10),
    rows
  };
}

function extractLegacyLine(observacao: string | undefined): number | null {
  if (!observacao) return null;
  const match = observacao.match(/Importado da planilha legada \\(linha (\\d+)\\)/i);
  if (!match) return null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

export function legacyImportKey(
  lancamento: Pick<Lancamento, "data" | "tipo" | "descricao" | "valor" | "observacao">
): string | null {
  const line = extractLegacyLine(lancamento.observacao);
  if (!line) return null;
  const descricao = lancamento.descricao?.trim().toUpperCase() ?? "";
  return `${lancamento.data}|${lancamento.tipo}|${descricao}|${lancamento.valor}|${line}`;
}
