import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appendRows, ensureSchemaSheets, readSheetRaw } from "../src/lib/sheets/sheetsClient";
import { previewLegacyImport } from "../src/lib/sheets/legacyImporter";

loadEnv({ path: ".env.local" });
loadEnv();

interface CliConfig {
  sourceSheet: string;
  tipo?: "despesa" | "receita";
  year: number;
  monthStartCol: number;
  startRow: number;
  endRow: number;
  mapping: {
    descricaoCol: number;
    valorCol: number;
    diaCol: number;
    atribuicaoCol?: number;
    quemPagouCol?: number;
    categoriaCol?: number;
  };
  defaults?: {
    categoria?: string;
    atribuicao?: "WALKER" | "DEA" | "AMBOS" | "AMBOS_I";
    metodo?: "pix" | "cartao" | "dinheiro" | "transferencia" | "outro";
    quem_pagou?: "WALKER" | "DEA";
  };
  dryRun?: boolean;
}

function parseArgs(): { configPath: string } {
  const args = process.argv.slice(2);
  const configIndex = args.findIndex((arg) => arg === "--config");
  if (configIndex < 0 || !args[configIndex + 1]) {
    throw new Error("Uso: node scripts/importar.js --config ./import-config.json");
  }
  return { configPath: args[configIndex + 1] };
}

async function loadConfig(configPath: string): Promise<CliConfig> {
  const absolute = path.resolve(process.cwd(), configPath);
  const raw = await readFile(absolute, "utf-8");
  return JSON.parse(raw) as CliConfig;
}

async function main() {
  const { configPath } = parseArgs();
  const config = await loadConfig(configPath);

  console.log(`Lendo aba ${config.sourceSheet}...`);
  const grid = await readSheetRaw(config.sourceSheet, "A1:ZZ2000");

  const preview = previewLegacyImport({
    grid,
    tipo: config.tipo ?? "despesa",
    year: config.year,
    monthStartCol: config.monthStartCol,
    startRow: config.startRow,
    endRow: config.endRow,
    mapping: config.mapping,
    defaults: config.defaults
  });

  console.log(`Mes detectado: ${preview.month}`);
  console.log(`Linhas validas para importacao: ${preview.count}`);

  if (config.dryRun) {
    console.log("dryRun=true -> nenhuma linha sera gravada.");
    return;
  }

  await ensureSchemaSheets();
  await appendRows("LANCAMENTOS", preview.rows);

  console.log(`Importacao concluida. ${preview.rows.length} linha(s) gravadas em LANCAMENTOS.`);
}

main().catch((error) => {
  console.error("Falha no importador CLI:", error instanceof Error ? error.message : error);
  process.exit(1);
});
