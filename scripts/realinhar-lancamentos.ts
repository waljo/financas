import { config as loadEnv } from "dotenv";
import { getSheetHeaders } from "../src/lib/sheets/schema";
import { readSheetRaw, writeRows } from "../src/lib/sheets/sheetsClient";

const TIPOS = new Set(["despesa", "receita"]);

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

type OutputRow = Record<string, string>;

function mapRow(row: string[]): OutputRow | null {
  const cells = row.map((cell) => clean(cell));
  if (!cells.some(Boolean)) return null;

  const tipoAtC = TIPOS.has(cells[2] ?? "");
  const tipoAtE = TIPOS.has(cells[4] ?? "");
  const tipoAtD = TIPOS.has(cells[3] ?? "");

  let id = cells[0] ?? "";
  let data = "";
  let tipo = "";
  let descricao = "";
  let categoria = "";
  let valor = "";
  let atribuicao = "";
  let metodo = "";
  let parcela_total = "";
  let parcela_numero = "";
  let observacao = "";
  let created_at = "";
  let updated_at = "";
  let quem_pagou = "";

  if (tipoAtC) {
    // Formato antigo
    data = cells[1] ?? "";
    tipo = cells[2] ?? "";
    descricao = cells[3] ?? "";
    categoria = cells[4] ?? "";
    valor = cells[5] ?? "";
    atribuicao = cells[6] ?? "";
    metodo = cells[7] ?? "";
    parcela_total = cells[8] ?? "";
    parcela_numero = cells[9] ?? "";
    observacao = cells[10] ?? "";
    created_at = cells[11] ?? "";
    updated_at = cells[12] ?? "";
    quem_pagou = cells[13] ?? "";
  } else if (tipoAtE || tipoAtD) {
    // Formato novo (com data_competencia/data_pagamento)
    const dataCompetencia = cells[2] ?? "";
    data = cells[1] ?? dataCompetencia;
    if (!data && isDate(dataCompetencia)) {
      data = dataCompetencia;
    }
    tipo = cells[4] ?? cells[3] ?? "";
    descricao = cells[5] ?? cells[4] ?? "";
    categoria = cells[6] ?? cells[5] ?? "";
    valor = cells[7] ?? cells[6] ?? "";
    atribuicao = cells[8] ?? cells[7] ?? "";
    metodo = cells[9] ?? cells[8] ?? "";
    parcela_total = cells[10] ?? cells[9] ?? "";
    parcela_numero = cells[11] ?? cells[10] ?? "";
    observacao = cells[12] ?? cells[11] ?? "";
    created_at = cells[13] ?? cells[12] ?? "";
    updated_at = cells[14] ?? cells[13] ?? "";
    quem_pagou = cells[15] ?? cells[14] ?? "";
  } else {
    // Desconhecido: tenta assumir formato antigo
    data = cells[1] ?? "";
    tipo = cells[2] ?? "";
    descricao = cells[3] ?? "";
    categoria = cells[4] ?? "";
    valor = cells[5] ?? "";
    atribuicao = cells[6] ?? "";
    metodo = cells[7] ?? "";
    parcela_total = cells[8] ?? "";
    parcela_numero = cells[9] ?? "";
    observacao = cells[10] ?? "";
    created_at = cells[11] ?? "";
    updated_at = cells[12] ?? "";
    quem_pagou = cells[13] ?? "";
  }

  return {
    id,
    data,
    tipo,
    descricao,
    categoria,
    valor,
    atribuicao,
    metodo,
    parcela_total,
    parcela_numero,
    observacao,
    created_at,
    updated_at,
    quem_pagou
  };
}

async function main() {
  loadEnv({ path: ".env.local" });

  const values = await readSheetRaw("LANCAMENTOS", "A1:ZZ100000");
  if (!values.length) {
    console.log("LANCAMENTOS vazio. Nada a fazer.");
    return;
  }

  const rows = values.slice(1);
  const output: OutputRow[] = [];

  for (const row of rows) {
    const mapped = mapRow(row);
    if (mapped) output.push(mapped);
  }

  const headers = getSheetHeaders("LANCAMENTOS");
  const trimmed = output.map((row) => {
    const next: OutputRow = {};
    headers.forEach((header) => {
      next[header] = row[header] ?? "";
    });
    return next;
  });

  await writeRows("LANCAMENTOS", trimmed);
  console.log(`Reorganizados ${trimmed.length} lancamentos.`);
}

main().catch((error) => {
  console.error("Falha ao realinhar LANCAMENTOS:", error);
  process.exit(1);
});
