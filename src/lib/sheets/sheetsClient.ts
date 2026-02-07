import { AppError } from "@/lib/errors";
import { getConfig } from "@/lib/config";
import { getSheetsApi } from "@/lib/sheets/auth";
import { detectMonthBlocks, legacyImportKey, type LegacyMonthBlock } from "@/lib/sheets/legacyImporter";
import { getSheetHeaders, SHEET_SCHEMA, type SheetName } from "@/lib/sheets/schema";
import type { CalendarioAnual, ContaFixa, Lancamento, ReceitasRegra } from "@/lib/types";
import { parseBoolean, parseNumber } from "@/lib/utils";

function colToLetter(col: number): string {
  let n = col;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

function normalizeRow<T extends object>(headers: string[], row: T): string[] {
  const values = row as Record<string, unknown>;
  return headers.map((header) => cleanCell(values[header]));
}

function toObjectRows(values: string[][]): Record<string, string>[] {
  if (values.length === 0) return [];
  const headers = values[0];
  const rows = values.slice(1);

  return rows
    .filter((row) => row.some((cell) => cleanCell(cell) !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, idx) => {
        obj[header] = cleanCell(row[idx]);
      });
      return obj;
    });
}

async function getSpreadsheetMeta() {
  const config = getConfig();
  const sheets = getSheetsApi();

  const response = await sheets.spreadsheets.get({
    spreadsheetId: config.googleSpreadsheetId,
    fields: "sheets(properties(sheetId,title))"
  });

  return response.data;
}

type MergeRange = {
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

async function getSheetMerges(sheetName: string): Promise<MergeRange[]> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();

  const response = await sheetsApi.spreadsheets.get({
    spreadsheetId: config.googleSpreadsheetId,
    fields: "sheets(properties(title),merges)"
  });

  const sheet = response.data.sheets?.find((item) => item.properties?.title === sheetName);
  return (sheet?.merges ?? []) as MergeRange[];
}

function findMerge(merges: MergeRange[], row: number, col: number): MergeRange | null {
  const rowIndex = row - 1;
  const colIndex = col - 1;
  return (
    merges.find(
      (merge) =>
        rowIndex >= merge.startRowIndex &&
        rowIndex < merge.endRowIndex &&
        colIndex >= merge.startColumnIndex &&
        colIndex < merge.endColumnIndex
    ) ?? null
  );
}

function isMergedNonTopLeft(merge: MergeRange | null, row: number, col: number): boolean {
  if (!merge) return false;
  return merge.startRowIndex !== row - 1 || merge.startColumnIndex !== col - 1;
}

function resolveMergedRow(merge: MergeRange | null): number | null {
  if (!merge) return null;
  return merge.startRowIndex + 1;
}

async function getSheetIdByName(sheetName: string): Promise<number> {
  const meta = await getSpreadsheetMeta();
  const match = meta.sheets?.find((sheet) => sheet.properties?.title === sheetName);
  const sheetId = match?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new AppError(`Aba ${sheetName} nao encontrada`, 404, "SHEET_NOT_FOUND");
  }
  return sheetId;
}

export async function listSheetNames(): Promise<string[]> {
  const meta = await getSpreadsheetMeta();
  return (
    meta.sheets
      ?.map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title)) ?? []
  );
}

function monthBlocksForYear(firstRow: string[]): LegacyMonthBlock[] {
  return detectMonthBlocks(firstRow);
}

export async function readLegacyMonthRealBalance(
  month: string
): Promise<{ saldoBanco: number; saldoCarteira: number } | null> {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthNumber = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return null;
  }

  const yearSheet = String(year);
  const sheetNames = await listSheetNames();
  if (!sheetNames.includes(yearSheet)) {
    return null;
  }

  const firstRowOnly = await readSheetRaw(yearSheet, "A1:ZZ1");
  const monthBlocks = detectMonthBlocks(firstRowOnly[0] ?? []);
  const monthBlock = monthBlocks.find((item) => item.month === monthNumber);
  if (!monthBlock) {
    return null;
  }

  const valueCol = monthBlock.startCol + 1;
  const col = colToLetter(valueCol);
  const values = await readSheetRaw(yearSheet, `${col}7:${col}8`);

  const saldoBanco = parseNumber(values[0]?.[0], 0);
  const saldoCarteira = parseNumber(values[1]?.[0], 0);

  return { saldoBanco, saldoCarteira };
}

export async function appendLegacyLancamento(
  lancamento: Lancamento
): Promise<{
  status: "ok" | "skipped" | "no_space" | "error";
  message?: string;
  sheet?: string;
  range?: string;
  row?: number;
  month?: number;
}> {
  const parsed = parseYmd(lancamento.data);
  if (!parsed) {
    return { status: "skipped", message: "Data invalida para espelhar no layout legado." };
  }
  const { year, month, day } = parsed;

  const yearSheet = String(year);
  const sheetNames = await listSheetNames();
  if (!sheetNames.includes(yearSheet)) {
    return { status: "skipped", message: `Aba ${yearSheet} nao encontrada para espelhamento.` };
  }

  const firstRowOnly = await readSheetRaw(yearSheet, "A1:ZZ1");
  const monthBlocks = monthBlocksForYear(firstRowOnly[0] ?? []);
  const monthBlock = monthBlocks.find((item) => item.month === month);
  if (!monthBlock) {
    return { status: "skipped", message: `Mes ${month} nao encontrado em ${yearSheet}.` };
  }

  const startCol = monthBlock.startCol;
  const startRow = lancamento.tipo === "receita" ? 11 : 17;
  const endRow = lancamento.tipo === "receita" ? 30 : 300;
  const scan = await readSheetRaw(yearSheet, `A${startRow}:ZZ${endRow}`);
  const merges = await getSheetMerges(yearSheet);

  let targetRow: number | null = null;
  const desiredDesc = normalizeText(lancamento.descricao);

  // Primeiro: receitas podem sobrescrever a linha pela descricao (mesmo com valor preenchido).
  if (lancamento.tipo === "receita") {
    for (let idx = 0; idx < scan.length; idx += 1) {
      const row = scan[idx] ?? [];
      const desc = normalizeText(row[startCol - 1] ?? "");
      const rowNumber = startRow + idx;
      const merge = findMerge(merges, rowNumber, startCol);
      if (merge) {
        continue;
      }
      if (desc && desc === desiredDesc) {
        targetRow = rowNumber;
        break;
      }
    }
  }

  // Segundo: tenta casar descricao existente com valor vazio (layout legado preenchido manualmente).
  for (let idx = 0; idx < scan.length; idx += 1) {
    const row = scan[idx] ?? [];
    const desc = normalizeText(row[startCol - 1] ?? "");
    const valorCell = (row[startCol] ?? "").trim();
    const rowNumber = startRow + idx;
    const merge = findMerge(merges, rowNumber, startCol);
    // Ignora qualquer linha mesclada (incluindo topo), conforme preferencia do layout legado.
    if (merge) {
      continue;
    }
    if (desc && desc === desiredDesc && !valorCell) {
      targetRow = rowNumber;
      break;
    }
  }

  // Terceiro: primeira linha totalmente vazia no bloco.
  if (!targetRow) {
    for (let idx = 0; idx < scan.length; idx += 1) {
      const cell = scan[idx]?.[startCol - 1]?.trim() ?? "";
      const rowNumber = startRow + idx;
      const merge = findMerge(merges, rowNumber, startCol);
      if (merge) {
        continue;
      }
      if (!cell) {
        targetRow = rowNumber;
        break;
      }
    }
  }

  if (!targetRow) {
    return { status: "no_space", message: "Nao ha linhas livres no bloco legado para este mes." };
  }

  const sheetsApi = getSheetsApi();
  const endCol = startCol + (lancamento.tipo === "receita" ? 2 : 4);
  const startLetter = colToLetter(startCol);
  const endLetter = colToLetter(endCol);
  const range = `${yearSheet}!${startLetter}${targetRow}:${endLetter}${targetRow}`;

  const values =
    lancamento.tipo === "receita"
      ? [[lancamento.descricao, lancamento.valor, day]]
      : [[lancamento.descricao, lancamento.valor, day, lancamento.atribuicao, lancamento.quem_pagou]];

  try {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: getConfig().googleSpreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values }
    });

    return { status: "ok", sheet: yearSheet, range, row: targetRow, month };
  } catch (error) {
    return { status: "error", message: "Falha ao gravar no layout legado." };
  }
}

export async function legacyLancamentoExists(lancamento: Lancamento): Promise<boolean> {
  const parsed = parseYmd(lancamento.data);
  if (!parsed) return false;
  const { year, month, day } = parsed;

  const yearSheet = String(year);
  const sheetNames = await listSheetNames();
  if (!sheetNames.includes(yearSheet)) {
    return false;
  }

  const firstRowOnly = await readSheetRaw(yearSheet, "A1:ZZ1");
  const monthBlocks = detectMonthBlocks(firstRowOnly[0] ?? []);
  const monthBlock = monthBlocks.find((item) => item.month === month);
  if (!monthBlock) {
    return false;
  }

  const startCol = monthBlock.startCol;
  const startRow = lancamento.tipo === "receita" ? 11 : 17;
  const endRow = lancamento.tipo === "receita" ? 30 : 300;
  const grid = await readSheetRaw(yearSheet, `A${startRow}:ZZ${endRow}`);

  for (let idx = 0; idx < grid.length; idx += 1) {
    const row = grid[idx] ?? [];
    const desc = (row[startCol - 1] ?? "").trim();
    const valor = parseNumber(row[startCol] ?? "", NaN);
    const dia = parseNumber(row[startCol + 1] ?? "", NaN);
    if (!desc) continue;
    if (desc === lancamento.descricao && Number.isFinite(valor) && Number.isFinite(dia)) {
      if (valor === lancamento.valor && Math.trunc(dia) === day) {
        return true;
      }
    }
  }

  return false;
}

export async function removeLegacyLancamento(
  lancamento: Lancamento
): Promise<{ status: "ok" | "skipped" | "not_found" | "error"; message?: string }> {
  const parsed = parseYmd(lancamento.data);
  if (!parsed) {
    return { status: "skipped", message: "Data invalida para remover no legado." };
  }
  const { year, month, day } = parsed;

  const yearSheet = String(year);
  const sheetNames = await listSheetNames();
  if (!sheetNames.includes(yearSheet)) {
    return { status: "skipped", message: `Aba ${yearSheet} nao encontrada.` };
  }

  const firstRowOnly = await readSheetRaw(yearSheet, "A1:ZZ1");
  const monthBlocks = detectMonthBlocks(firstRowOnly[0] ?? []);
  const monthBlock = monthBlocks.find((item) => item.month === month);
  if (!monthBlock) {
    return { status: "skipped", message: `Mes ${month} nao encontrado em ${yearSheet}.` };
  }

  const startCol = monthBlock.startCol;
  const startRow = lancamento.tipo === "receita" ? 11 : 17;
  const endRow = lancamento.tipo === "receita" ? 30 : 300;
  const grid = await readSheetRaw(yearSheet, `A${startRow}:ZZ${endRow}`);
  const merges = await getSheetMerges(yearSheet);

  let targetRow: number | null = null;
  for (let idx = 0; idx < grid.length; idx += 1) {
    const row = grid[idx] ?? [];
    const desc = (row[startCol - 1] ?? "").trim();
    const valor = parseNumber(row[startCol] ?? "", NaN);
    const dia = parseNumber(row[startCol + 1] ?? "", NaN);
    if (!desc) continue;
    const rowNumber = startRow + idx;
    const merge = findMerge(merges, rowNumber, startCol);
    if (merge) {
      continue;
    }
    if (desc === lancamento.descricao && Number.isFinite(valor) && Number.isFinite(dia)) {
      if (valor === lancamento.valor && Math.trunc(dia) === day) {
        targetRow = rowNumber;
        break;
      }
    }
  }

  if (!targetRow) {
    return { status: "not_found", message: "Lancamento nao encontrado no legado." };
  }

  const sheetsApi = getSheetsApi();
  const endCol = startCol + (lancamento.tipo === "receita" ? 2 : 4);
  const startLetter = colToLetter(startCol);
  const endLetter = colToLetter(endCol);
  const emptyValues =
    lancamento.tipo === "receita"
      ? [["", "", ""]]
      : [["", "", "", "", ""]];

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: getConfig().googleSpreadsheetId,
    range: `${yearSheet}!${startLetter}${targetRow}:${endLetter}${targetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: emptyValues }
  });

  return { status: "ok" };
}

export async function ensureSchemaSheets(): Promise<void> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const sheetNames = await listSheetNames();

  const missing = Object.keys(SHEET_SCHEMA).filter((name) => !sheetNames.includes(name));

  if (missing.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: config.googleSpreadsheetId,
      requestBody: {
        requests: missing.map((name) => ({
          addSheet: {
            properties: {
              title: name
            }
          }
        }))
      }
    });
  }

  await Promise.all(
    (Object.keys(SHEET_SCHEMA) as SheetName[]).map(async (sheetName) => {
      const headers = getSheetHeaders(sheetName);
      const endCol = colToLetter(headers.length);

      await sheetsApi.spreadsheets.values.update({
        spreadsheetId: config.googleSpreadsheetId,
        range: `${sheetName}!A1:${endCol}1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [headers]
        }
      });
    })
  );
}

export async function readSheetRaw(sheetName: string, range = "A1:ZZ100000"): Promise<string[][]> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!${range}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  return (response.data.values ?? []).map((row) => row.map(cleanCell));
}

export async function readRows(sheetName: SheetName): Promise<Record<string, string>[]> {
  const values = await readSheetRaw(sheetName);
  return toObjectRows(values);
}

export async function appendRow<T extends object>(sheetName: SheetName, row: T): Promise<void> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const headers = getSheetHeaders(sheetName);

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [normalizeRow(headers, row)]
    }
  });
}

export async function appendRows<T extends object>(sheetName: SheetName, rows: T[]): Promise<void> {
  if (rows.length === 0) return;

  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const headers = getSheetHeaders(sheetName);
  let rowsToAppend = rows;

  if (sheetName === "LANCAMENTOS") {
    const existing = await readLancamentos();
    const existingLegacy = new Set<string>();
    for (const item of existing) {
      const legacyKey = legacyImportKey(item);
      if (legacyKey) existingLegacy.add(legacyKey);
    }
    rowsToAppend = rows.filter((row) => {
      const legacyKey = legacyImportKey(row as unknown as Lancamento);
      return legacyKey ? !existingLegacy.has(legacyKey) : true;
    });
    if (rowsToAppend.length === 0) return;
  }

  const values = rowsToAppend.map((row) => normalizeRow(headers, row));

  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  });
}

export async function writeRows<T extends object>(sheetName: SheetName, rows: T[]): Promise<void> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const headers = getSheetHeaders(sheetName);
  const endCol = colToLetter(headers.length);
  const values = [headers, ...rows.map((row) => normalizeRow(headers, row))];

  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!A1:ZZ100000`
  });

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!A1:${endCol}${values.length}`,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

export async function updateRowById(
  sheetName: SheetName,
  id: string,
  nextRow: object
): Promise<void> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const values = await readSheetRaw(sheetName);
  if (values.length === 0) {
    throw new AppError(`Aba ${sheetName} esta vazia`, 404, "SHEET_EMPTY");
  }

  const headers = values[0];
  const idCol = headers.indexOf("id");
  if (idCol < 0) {
    throw new AppError(`Aba ${sheetName} nao possui coluna id`, 500, "MISSING_ID_COLUMN");
  }

  const rowIndex = values.findIndex((row, idx) => idx > 0 && cleanCell(row[idCol]) === id);
  if (rowIndex < 0) {
    throw new AppError(`Registro ${id} nao encontrado em ${sheetName}`, 404, "ROW_NOT_FOUND");
  }

  const endCol = colToLetter(headers.length);
  const normalized = normalizeRow(headers, nextRow);

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: config.googleSpreadsheetId,
    range: `${sheetName}!A${rowIndex + 1}:${endCol}${rowIndex + 1}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [normalized]
    }
  });
}

export async function deleteRowById(sheetName: SheetName, id: string): Promise<void> {
  const config = getConfig();
  const sheetsApi = getSheetsApi();
  const values = await readSheetRaw(sheetName);
  if (values.length === 0) {
    throw new AppError(`Aba ${sheetName} esta vazia`, 404, "SHEET_EMPTY");
  }

  const headers = values[0];
  const idCol = headers.indexOf("id");
  if (idCol < 0) {
    throw new AppError(`Aba ${sheetName} nao possui coluna id`, 500, "MISSING_ID_COLUMN");
  }

  const rowIndex = values.findIndex((row, idx) => idx > 0 && cleanCell(row[idCol]) === id);
  if (rowIndex < 0) {
    throw new AppError(`Registro ${id} nao encontrado em ${sheetName}`, 404, "ROW_NOT_FOUND");
  }

  const sheetId = await getSheetIdByName(sheetName);
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: config.googleSpreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }
      ]
    }
  });
}

function assertValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new AppError(message, 400, "INVALID_ROW");
  }
  return value;
}

export async function readLancamentos(): Promise<Lancamento[]> {
  const rows = await readRows("LANCAMENTOS");
  const seenLegacy = new Set<string>();

  return rows
    .map((row) => {
      const id = row.id?.trim();
      if (!id) return null;

      return {
        id,
        data: assertValue(row.data, `Lancamento ${id} sem data`),
        tipo: (row.tipo as Lancamento["tipo"]) || "despesa",
        descricao: row.descricao ?? "",
        categoria: row.categoria ?? "",
        valor: parseNumber(row.valor, 0),
        atribuicao: (row.atribuicao as Lancamento["atribuicao"]) || "AMBOS",
        metodo: (row.metodo as Lancamento["metodo"]) || "outro",
        parcela_total: row.parcela_total ? parseNumber(row.parcela_total, 0) : null,
        parcela_numero: row.parcela_numero ? parseNumber(row.parcela_numero, 0) : null,
        observacao: row.observacao ?? "",
        created_at: row.created_at ?? "",
        updated_at: row.updated_at ?? "",
        quem_pagou: (row.quem_pagou as Lancamento["quem_pagou"]) || "WALKER"
      } satisfies Lancamento;
    })
    .filter((item): item is Lancamento => Boolean(item))
    .filter((item) => {
      const legacyKey = legacyImportKey(item);
      if (!legacyKey) return true;
      if (seenLegacy.has(legacyKey)) return false;
      seenLegacy.add(legacyKey);
      return true;
    });
}

export async function readContasFixas(): Promise<ContaFixa[]> {
  const rows = await readRows("CONTAS_FIXAS");

  return rows
    .map((row) => {
      const id = row.id?.trim();
      if (!id) return null;

      return {
        id,
        nome: row.nome ?? "",
        dia_vencimento: parseNumber(row.dia_vencimento, 1),
        valor_previsto: row.valor_previsto ? parseNumber(row.valor_previsto, 0) : null,
        atribuicao: (row.atribuicao as ContaFixa["atribuicao"]) || "AMBOS",
        categoria: row.categoria ?? "",
        avisar_dias_antes: row.avisar_dias_antes ?? "5,2",
        ativo: parseBoolean(row.ativo)
      } satisfies ContaFixa;
    })
    .filter((item): item is ContaFixa => Boolean(item));
}

export async function readCalendarioAnual(): Promise<CalendarioAnual[]> {
  const rows = await readRows("CALENDARIO_ANUAL");

  return rows
    .map((row) => {
      const id = row.id?.trim();
      if (!id) return null;

      return {
        id,
        mes: parseNumber(row.mes, 1),
        evento: row.evento ?? "",
        valor_estimado: parseNumber(row.valor_estimado, 0),
        avisar_dias_antes: row.avisar_dias_antes ?? "10,5,2",
        atribuicao: (row.atribuicao as CalendarioAnual["atribuicao"]) || "AMBOS",
        categoria: row.categoria ?? "",
        observacao: row.observacao ?? "",
        dia_mes: row.dia_mes ? parseNumber(row.dia_mes, 1) : null
      } satisfies CalendarioAnual;
    })
    .filter((item): item is CalendarioAnual => Boolean(item));
}

export async function readReceitasRegras(): Promise<ReceitasRegra[]> {
  const rows = await readRows("RECEITAS_REGRAS");

  return rows
    .map((row) => {
      const chave = row.chave?.trim();
      if (!chave) return null;
      return {
        chave,
        valor: row.valor ?? ""
      } satisfies ReceitasRegra;
    })
    .filter((item): item is ReceitasRegra => Boolean(item));
}
