import { config as loadEnv } from "dotenv";
import { legacyImportKey } from "../src/lib/sheets/legacyImporter";
import { readSheetRaw, writeRows } from "../src/lib/sheets/sheetsClient";

type LancamentoRow = {
  id: string;
  data: string;
  tipo: string;
  descricao: string;
  categoria: string;
  valor: string | number;
  atribuicao: string;
  metodo: string;
  parcela_total: string | number | null;
  parcela_numero: string | number | null;
  observacao: string;
  created_at: string;
  updated_at: string;
  quem_pagou: string;
};

function toRowObject(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((header, idx) => {
    obj[header] = row[idx] ?? "";
  });
  return obj;
}

function buildLancamento(row: Record<string, string>): LancamentoRow {
  return {
    id: row.id ?? "",
    data: row.data ?? "",
    tipo: row.tipo ?? "",
    descricao: row.descricao ?? "",
    categoria: row.categoria ?? "",
    valor: row.valor ?? "",
    atribuicao: row.atribuicao ?? "",
    metodo: row.metodo ?? "",
    parcela_total: row.parcela_total ?? "",
    parcela_numero: row.parcela_numero ?? "",
    observacao: row.observacao ?? "",
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
    quem_pagou: row.quem_pagou ?? ""
  };
}

async function main() {
  loadEnv({ path: ".env.local" });
  const apply = process.argv.includes("--apply");

  const values = await readSheetRaw("LANCAMENTOS", "A1:ZZ100000");
  if (!values.length) {
    console.log("LANCAMENTOS vazio. Nada a fazer.");
    return;
  }

  const headers = values[0];
  const rows = values.slice(1);

  const seen = new Set<string>();
  const kept: LancamentoRow[] = [];
  let duplicates = 0;

  for (const row of rows) {
    if (!row.some((cell) => String(cell ?? "").trim() !== "")) {
      continue;
    }
    const obj = buildLancamento(toRowObject(headers, row));
    if (!obj.id) continue;

    const key = legacyImportKey({
      data: obj.data,
      tipo: (obj.tipo as "despesa" | "receita") || "despesa",
      descricao: obj.descricao,
      valor: Number(String(obj.valor ?? "").replace(",", ".")) || 0,
      observacao: obj.observacao
    });

    if (key) {
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
    }

    kept.push(obj);
  }

  console.log(`Linhas originais: ${rows.length}`);
  console.log(`Duplicadas detectadas: ${duplicates}`);
  console.log(`Linhas mantidas: ${kept.length}`);

  if (!apply) {
    console.log("Dry-run. Use --apply para gravar a limpeza.");
    return;
  }

  await writeRows("LANCAMENTOS", kept);
  console.log("LANCAMENTOS regravada sem duplicatas.");
}

main().catch((error) => {
  console.error("Falha ao limpar duplicatas:", error);
  process.exit(1);
});
