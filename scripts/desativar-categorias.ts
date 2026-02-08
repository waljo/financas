import { config as loadEnv } from "dotenv";
import { ensureSchemaSheets, readRows, writeRows } from "../src/lib/sheets/sheetsClient";
import { parseBoolean, toIsoNow } from "../src/lib/utils";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  await ensureSchemaSheets();
  const rows = await readRows("CATEGORIAS");

  if (rows.length === 0) {
    console.log("Nenhuma categoria encontrada para desativar.");
    return;
  }

  const total = rows.length;
  const ativas = rows.filter((row) => {
    const ativaRaw = (row.ativa ?? "").trim();
    return ativaRaw === "" ? true : parseBoolean(ativaRaw);
  }).length;

  if (ativas === 0) {
    console.log(`Todas as ${total} categorias ja estavam inativas.`);
    return;
  }

  const now = toIsoNow();
  const nextRows = rows.map((row) => ({
    ...row,
    ativa: "false",
    updated_at: now
  }));

  await writeRows("CATEGORIAS", nextRows);
  console.log(`Categorias desativadas com sucesso: ${ativas} de ${total} estavam ativas.`);
}

main().catch((error) => {
  console.error("Falha ao desativar categorias:", error instanceof Error ? error.message : error);
  process.exit(1);
});
