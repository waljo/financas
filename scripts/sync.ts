import { readFile } from "node:fs/promises";

function getArgValue(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function readJsonFile(path: string) {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as { lancamentos: unknown[] };
}

async function main() {
  const baseUrl = (getArgValue("--baseUrl") ?? process.env.SYNC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const healthOnly = process.argv.includes("--health");
  const file = getArgValue("--file");

  if (healthOnly) {
    const response = await fetch(`${baseUrl}/api/sync/health`);
    const payload = await response.json();
    console.log(JSON.stringify(payload, null, 2));
    process.exit(response.ok ? 0 : 1);
  }

  if (!file) {
    console.error("Uso: npm run sync -- --file ./data/lancamentos-pendentes.json [--baseUrl http://localhost:3000]");
    console.error("Ou:  npm run sync -- --health");
    process.exit(1);
  }

  const payload = await readJsonFile(file);
  const response = await fetch(`${baseUrl}/api/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  process.exit(response.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
