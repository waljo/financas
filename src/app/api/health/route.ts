import { jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return jsonOk({
    ok: true,
    service: "financas-sheets-app",
    timestamp: new Date().toISOString()
  });
}
