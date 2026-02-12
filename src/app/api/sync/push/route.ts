import { z } from "zod";
import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { requestAppsScript } from "@/lib/mobileOffline/appsScriptClient";
import { isMobileOfflineModeEnabled } from "@/lib/mobileOffline/flags";
import { ATRIBUICOES, METODOS, PESSOA_PAGADORA, TIPO_LANCAMENTO } from "@/lib/types";
import { appendRow, ensureSchemaSheets, readLancamentos } from "@/lib/sheets/sheetsClient";
import { syncLancamentosCacheFromSheets } from "@/lib/sheets/lancamentosCacheClient";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

const syncLancamentoSchema = z.object({
  id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(TIPO_LANCAMENTO),
  descricao: z.string().min(1),
  categoria: z.string().min(1),
  valor: z.coerce.number(),
  atribuicao: z.enum(ATRIBUICOES),
  metodo: z.enum(METODOS).default("outro"),
  parcela_total: z.union([z.number(), z.null()]).optional().default(null),
  parcela_numero: z.union([z.number(), z.null()]).optional().default(null),
  observacao: z.string().optional().default(""),
  quem_pagou: z.enum(PESSOA_PAGADORA).default("WALKER"),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

const syncBatchSchema = z.object({
  lancamentos: z.array(syncLancamentoSchema).min(1)
});

type SyncLancamentoInput = z.infer<typeof syncLancamentoSchema>;

function dedupeById(items: SyncLancamentoInput[]) {
  const byId = new Map<string, SyncLancamentoInput>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function hasAppsScriptConfig() {
  const baseUrl = process.env.APPS_SCRIPT_WEB_APP_URL?.trim();
  const token = process.env.APPS_SCRIPT_APP_TOKEN?.trim();
  return Boolean(baseUrl && token);
}

export async function POST(request: Request) {
  try {
    if (!isMobileOfflineModeEnabled()) {
      throw new AppError("MOBILE_OFFLINE_MODE desativado", 403, "MOBILE_OFFLINE_DISABLED");
    }

    const body = await request.json();
    const parsed = syncBatchSchema.parse(body);
    const deduped = dedupeById(parsed.lancamentos);
    const now = toIsoNow();

    const normalized = deduped.map((item) => ({
      ...item,
      created_at: item.created_at ?? now,
      updated_at: item.updated_at ?? now
    }));

    if (!hasAppsScriptConfig()) {
      await ensureSchemaSheets();
      const existing = await readLancamentos();
      const existingIds = new Set(existing.map((item) => item.id));
      const toInsert = normalized.filter((item) => !existingIds.has(item.id));

      for (const row of toInsert) {
        await appendRow("LANCAMENTOS", row);
      }

      try {
        await syncLancamentosCacheFromSheets();
      } catch {
        // Mantem sucesso no Sheets mesmo se cache local falhar.
      }

      return jsonOk({
        ok: true,
        mode: "sheets_oauth_fallback",
        synced_ids: normalized.map((item) => item.id),
        sent_count: normalized.length,
        inserted_count: toInsert.length,
        duplicates: normalized.length - toInsert.length
      });
    }

    const appToken = process.env.APPS_SCRIPT_APP_TOKEN?.trim();
    const result = await requestAppsScript("addLancamentosBatch", {
      method: "POST",
      body: JSON.stringify({ lancamentos: normalized, appToken })
    });

    const remoteBody = result.body;
    if (
      remoteBody &&
      typeof remoteBody === "object" &&
      "ok" in remoteBody &&
      remoteBody.ok === false
    ) {
      const remoteMessage =
        "message" in remoteBody && typeof remoteBody.message === "string"
          ? remoteBody.message
          : "Apps Script retornou erro de negocio";
      throw new AppError(remoteMessage, 502, "APPS_SCRIPT_REJECTED", remoteBody);
    }

    const syncedIds =
      remoteBody &&
      typeof remoteBody === "object" &&
      "synced_ids" in remoteBody &&
      Array.isArray(remoteBody.synced_ids)
        ? (remoteBody.synced_ids as string[])
        : normalized.map((item) => item.id);

    return jsonOk({
      ok: true,
      synced_ids: syncedIds,
      sent_count: normalized.length,
      target: result.url,
      remote: remoteBody
    });
  } catch (error) {
    return jsonError(error);
  }
}
