import { config as loadEnv } from "dotenv";
import { detectMonthBlocks, previewLegacyImport } from "../src/lib/sheets/legacyImporter";
import { appendRows, ensureSchemaSheets, listSheetNames, readSheetRaw, writeRows } from "../src/lib/sheets/sheetsClient";

type ImportTipo = "receita" | "despesa";

type Mapping = {
  descricaoCol: number;
  valorCol: number;
  diaCol: number;
  atribuicaoCol?: number;
  quemPagouCol?: number;
  categoriaCol?: number;
};

function computeBaseStartCol(firstRow: string[]): number {
  const blocks = detectMonthBlocks(firstRow);
  const january = blocks.find((item) => item.month === 1);
  if (january) return january.startCol;
  return blocks[0]?.startCol ?? 2;
}

function shiftMapping(mapping: Mapping, offset: number): Mapping {
  return {
    descricaoCol: mapping.descricaoCol + offset,
    valorCol: mapping.valorCol + offset,
    diaCol: mapping.diaCol + offset,
    ...(mapping.atribuicaoCol ? { atribuicaoCol: mapping.atribuicaoCol + offset } : {}),
    ...(mapping.quemPagouCol ? { quemPagouCol: mapping.quemPagouCol + offset } : {}),
    ...(mapping.categoriaCol ? { categoriaCol: mapping.categoriaCol + offset } : {})
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function importYear(sheetName: string, tipo: ImportTipo) {
  const year = Number(sheetName);
  const grid = await readSheetRaw(sheetName, "A1:ZZ2000");
  const firstRow = grid[0] ?? [];
  const monthBlocks = detectMonthBlocks(firstRow);
  if (!monthBlocks.length) {
    console.log(`Ano ${sheetName}: nenhum bloco de mes detectado.`);
    return { imported: 0 };
  }

  const baseStartCol = computeBaseStartCol(firstRow);
  const monthStartCols = monthBlocks.map((item) => item.startCol);

  const mapping: Mapping =
    tipo === "receita"
      ? { descricaoCol: baseStartCol, valorCol: baseStartCol + 1, diaCol: baseStartCol + 2 }
      : {
          descricaoCol: baseStartCol,
          valorCol: baseStartCol + 1,
          diaCol: baseStartCol + 2,
          atribuicaoCol: baseStartCol + 3,
          quemPagouCol: baseStartCol + 4
        };

  const startRow = tipo === "receita" ? 11 : 17;
  const endRow = tipo === "receita" ? 15 : 130;

  const rows = monthStartCols.flatMap((startCol) => {
    const offset = startCol - baseStartCol;
    const preview = previewLegacyImport({
      grid,
      tipo,
      year,
      monthStartCol: startCol,
      startRow,
      endRow,
      mapping: shiftMapping(mapping, offset),
      defaults: {
        categoria: tipo === "receita" ? "RECEITAS" : undefined,
        atribuicao: tipo === "receita" ? "WALKER" : "AMBOS",
        quem_pagou: "WALKER",
        metodo: "outro"
      }
    });
    return preview.rows;
  });

  for (const batch of chunk(rows, 500)) {
    await appendRows("LANCAMENTOS", batch);
  }

  console.log(`Ano ${sheetName} (${tipo}): ${rows.length} linha(s) importadas.`);
  return { imported: rows.length };
}

async function main() {
  loadEnv({ path: ".env.local" });

  const sheets = await listSheetNames();
  console.log(`Abas disponiveis: ${sheets.length ? sheets.join(", ") : "nenhuma"}`);
  const yearSheets = sheets
    .filter((name) => /^\s*\d{4}\s*$/.test(name))
    .sort((a, b) => Number(a.trim()) - Number(b.trim()));
  console.log(`Abas ano detectadas: ${yearSheets.length ? yearSheets.join(", ") : "nenhuma"}`);
  if (!yearSheets.length) {
    throw new Error("Nenhuma aba de ano detectada. Abortando para evitar apagar dados.");
  }

  await ensureSchemaSheets();
  await writeRows("LANCAMENTOS", []);
  console.log("LANCAMENTOS limpa.");

  let total = 0;
  for (const sheetName of yearSheets) {
    const receitas = await importYear(sheetName, "receita");
    const despesas = await importYear(sheetName, "despesa");
    total += receitas.imported + despesas.imported;
  }

  console.log(`Total importado: ${total}`);
}

main().catch((error) => {
  console.error("Falha na reimportacao total:", error);
  process.exit(1);
});
