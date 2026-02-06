import { config as loadEnv } from "dotenv";
import { ensureSchemaSheets } from "../src/lib/sheets/sheetsClient";

loadEnv({ path: ".env.local" });
loadEnv();

async function main() {
  await ensureSchemaSheets();
  console.log("Abas normalizadas garantidas com sucesso.");
}

main().catch((error) => {
  console.error("Falha ao garantir schema no Sheets:", error instanceof Error ? error.message : error);
  process.exit(1);
});
