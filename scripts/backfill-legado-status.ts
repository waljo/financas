import { config as loadEnv } from "dotenv";
import { detectMonthBlocks } from "../src/lib/sheets/legacyImporter";
import { readSheetRaw, writeRows } from "../src/lib/sheets/sheetsClient";
import { parseNumber } from "../src/lib/utils";

function hasLegacyTag(observacao: string | undefined): boolean {
  return Boolean(observacao && observacao.includes("[LEGADO:"));
}

function setLegacyTag(observacao: string | undefined, status: "OK" | "SKIPPED"): string {
  const tag = `[LEGADO:${status}]`;
  if (!observacao) return tag;
  if (observacao.includes("[LEGADO:")) return observacao;
  return `${observacao} ${tag}`;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function makeKey(descricao: string, valor: number, dia: number): string {
  return `${normalize(descricao)}|${valor}|${dia}`;
}

async function main() {
  loadEnv({ path: ".env.local" });

  const values = await readSheetRaw("LANCAMENTOS", "A1:ZZ100000");
  if (!values.length) {
    console.log("LANCAMENTOS vazio. Nada a fazer.");
    return;
  }

  const headers = values[0];
  const rows = values.slice(1);

  let updated = 0;
  const output = [];

  const yearSheets = new Map<number, { grid: string[][]; monthSets: Map<string, Set<string>> }>();

  function getMonthSets(year: number) {
    if (yearSheets.has(year)) return yearSheets.get(year)!;
    return null;
  }

  async function loadYear(year: number) {
    const sheetName = String(year);
    const grid = await readSheetRaw(sheetName, "A1:ZZ2000");
    const firstRow = grid[0] ?? [];
    const blocks = detectMonthBlocks(firstRow);
    const monthSets = new Map<string, Set<string>>();

    for (const block of blocks) {
      const startCol = block.startCol;
      const receitas = new Set<string>();
      const despesas = new Set<string>();

      for (let row = 11; row <= 15; row += 1) {
        const desc = grid[row - 1]?.[startCol - 1] ?? "";
        const valor = parseNumber(grid[row - 1]?.[startCol] ?? "", NaN);
        const dia = parseNumber(grid[row - 1]?.[startCol + 1] ?? "", NaN);
        if (!desc || !Number.isFinite(valor) || !Number.isFinite(dia)) continue;
        receitas.add(makeKey(desc, valor, Math.trunc(dia)));
      }

      for (let row = 17; row <= 130; row += 1) {
        const desc = grid[row - 1]?.[startCol - 1] ?? "";
        const valor = parseNumber(grid[row - 1]?.[startCol] ?? "", NaN);
        const dia = parseNumber(grid[row - 1]?.[startCol + 1] ?? "", NaN);
        if (!desc || !Number.isFinite(valor) || !Number.isFinite(dia)) continue;
        despesas.add(makeKey(desc, valor, Math.trunc(dia)));
      }

      monthSets.set(`${block.month}-receita`, receitas);
      monthSets.set(`${block.month}-despesa`, despesas);
    }

    yearSheets.set(year, { grid, monthSets });
    return yearSheets.get(year)!;
  }

  for (const row of rows) {
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) {
      continue;
    }
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? "";
    });
    if (!obj.id) continue;

    if (hasLegacyTag(obj.observacao)) {
      output.push(obj);
      continue;
    }

    const parts = (obj.data ?? "").split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    let exists = false;
    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      let cache = getMonthSets(year);
      if (!cache) {
        try {
          cache = await loadYear(year);
        } catch {
          cache = null;
        }
      }
      if (cache) {
        const key = makeKey(obj.descricao ?? "", parseNumber(obj.valor ?? "", 0), Math.trunc(day));
        const set = cache.monthSets.get(`${month}-${obj.tipo}`);
        exists = Boolean(set && set.has(key));
      }
    }

    obj.observacao = setLegacyTag(obj.observacao, exists ? "OK" : "SKIPPED");
    updated += 1;
    output.push(obj);
  }

  console.log(`Linhas atualizadas com status legado: ${updated}`);

  // Regrava mantendo headers.
  await writeRows("LANCAMENTOS", output);
  console.log("LANCAMENTOS atualizada com tags de legado.");
}

main().catch((error) => {
  console.error("Falha ao backfill de status legado:", error);
  process.exit(1);
});
