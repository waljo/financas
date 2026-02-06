import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { detectMonthBlocks, previewLegacyImport } from "@/lib/sheets/legacyImporter";
import { appendRows, ensureSchemaSheets, readLancamentos, readSheetRaw } from "@/lib/sheets/sheetsClient";
import { importRunSchema } from "@/lib/validation/schemas";

const MONTH_LABELS = [
  "JANEIRO",
  "FEVEREIRO",
  "MARCO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO"
] as const;

export const runtime = "nodejs";

function normalizeMonthCols(input: { monthStartCols?: number[]; monthStartCol?: number }): number[] {
  const values = input.monthStartCols?.length ? input.monthStartCols : input.monthStartCol ? [input.monthStartCol] : [];
  const unique = [...new Set(values.map((item) => Math.trunc(item)).filter((item) => item > 0))].sort(
    (a, b) => a - b
  );

  if (!unique.length) {
    throw new AppError("Selecione ao menos um mes para importar", 400, "MISSING_MONTH_SELECTION");
  }

  return unique;
}

function computeBaseStartCol(firstRow: string[]): number {
  const blocks = detectMonthBlocks(firstRow);
  const january = blocks.find((item) => item.month === 1);
  if (january) return january.startCol;
  return blocks[0]?.startCol ?? 2;
}

function shiftMapping(
  mapping: {
    descricaoCol: number;
    valorCol: number;
    diaCol: number;
    atribuicaoCol?: number;
    quemPagouCol?: number;
    categoriaCol?: number;
  },
  offset: number
) {
  return {
    descricaoCol: mapping.descricaoCol + offset,
    valorCol: mapping.valorCol + offset,
    diaCol: mapping.diaCol + offset,
    ...(mapping.atribuicaoCol ? { atribuicaoCol: mapping.atribuicaoCol + offset } : {}),
    ...(mapping.quemPagouCol ? { quemPagouCol: mapping.quemPagouCol + offset } : {}),
    ...(mapping.categoriaCol ? { categoriaCol: mapping.categoriaCol + offset } : {})
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = importRunSchema.parse(body);
    const monthStartCols = normalizeMonthCols(parsed);

    const [grid, lancamentos] = await Promise.all([
      readSheetRaw(parsed.sourceSheet, "A1:ZZ2000"),
      readLancamentos()
    ]);
    const baseStartCol = computeBaseStartCol(grid[0] ?? []);

    const existingByMonth = new Map<number, number>();
    const existingByMonthTipo = new Map<string, number>();
    for (const item of lancamentos) {
      const [yearRaw, monthRaw] = item.data.split("-");
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      if (year !== parsed.year || !Number.isInteger(month)) continue;
      existingByMonth.set(month, (existingByMonth.get(month) ?? 0) + 1);
      const key = `${month}-${item.tipo}`;
      existingByMonthTipo.set(key, (existingByMonthTipo.get(key) ?? 0) + 1);
    }

    const monthRuns = monthStartCols.map((startCol) => {
      const offset = startCol - baseStartCol;
      const preview = previewLegacyImport({
        grid,
        tipo: parsed.tipo,
        year: parsed.year,
        monthStartCol: startCol,
        startRow: parsed.startRow,
        endRow: parsed.endRow,
        onlyNegative: parsed.onlyNegative,
        mapping: shiftMapping(parsed.mapping, offset),
        defaults: parsed.defaults
      });

      const existingCount = existingByMonth.get(preview.month) ?? 0;
      const existingCountTipo = existingByMonthTipo.get(`${preview.month}-${parsed.tipo}`) ?? 0;
      const alreadyImported = existingCount > 0;
      const alreadyImportedTipo = existingCountTipo > 0;
      const skipped = parsed.onlyNegative ? false : parsed.skipMonthsAlreadyImported && alreadyImportedTipo;

      return {
        month: preview.month,
        monthLabel: MONTH_LABELS[preview.month - 1] ?? String(preview.month),
        startCol,
        count: preview.count,
        existingCount,
        existingCountTipo,
        alreadyImported,
        alreadyImportedTipo,
        skipped,
        rows: skipped ? [] : preview.rows
      };
    });

    const rowsToImport = monthRuns.flatMap((item) => item.rows);

    if (!parsed.dryRun && rowsToImport.length > 0) {
      await ensureSchemaSheets();
      await appendRows("LANCAMENTOS", rowsToImport);
    }

    const monthResults = monthRuns.map((item) => ({
      month: item.month,
      monthLabel: item.monthLabel,
      startCol: item.startCol,
      previewCount: item.count,
      existingCount: item.existingCount,
      existingCountTipo: item.existingCountTipo,
      imported: parsed.dryRun ? 0 : item.rows.length,
      skipped: item.skipped,
      skipReason: item.skipped ? "month_already_imported" : null
    }));

    return jsonOk({
      data: {
        year: parsed.year,
        tipo: parsed.tipo,
        onlyNegative: parsed.onlyNegative,
        dryRun: parsed.dryRun,
        skipMonthsAlreadyImported: parsed.skipMonthsAlreadyImported,
        previewCount: monthResults.reduce((acc, item) => acc + item.previewCount, 0),
        importableCount: monthRuns.reduce((acc, item) => acc + item.rows.length, 0),
        imported: parsed.dryRun ? 0 : rowsToImport.length,
        monthResults
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
