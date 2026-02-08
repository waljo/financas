import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import {
  appendLegacyLancamento,
  appendRow,
  deleteRowById,
  readLancamentos,
  removeLegacyLancamento,
  ensureSchemaSheets,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import { jsonError, jsonOk } from "@/lib/http";
import { lancamentoSchema } from "@/lib/validation/schemas";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

type LegacySyncResult = {
  status: string;
  message?: string;
  range?: string;
};

function withLegacyStatusTag(observacaoBase: string, legacy: LegacySyncResult): string {
  const clean = observacaoBase
    .replace(/\s*\[LEGADO:[A-Z_]+\](?:\s*\([^)]+\))?(?:\s*\(range [^)]+\))?/g, "")
    .trim();
  const tag = `[LEGADO:${legacy.status.toUpperCase()}]`;
  const detail = legacy.message ? `(${legacy.message})` : "";
  const where = legacy.range ? `(range ${legacy.range})` : "";
  const suffix = [tag, detail, where].filter(Boolean).join(" ");
  return clean ? `${clean} ${suffix}` : suffix;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mes = searchParams.get("mes")?.trim();

    const lancamentos = await readLancamentos();
    const filtered = mes ? lancamentos.filter((item) => item.data.startsWith(mes)) : lancamentos;

    return jsonOk({ data: filtered });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = lancamentoSchema.parse(body);
    const now = toIsoNow();

    const row = {
      ...parsed,
      id: parsed.id ?? randomUUID(),
      observacao: parsed.observacao ?? "",
      parcela_total: parsed.parcela_total,
      parcela_numero: parsed.parcela_numero,
      created_at: now,
      updated_at: now
    };

    await ensureSchemaSheets();
    await appendRow("LANCAMENTOS", row);
    const legacy = await appendLegacyLancamento(row);

    if (legacy?.status) {
      const observacao = withLegacyStatusTag(row.observacao ?? "", legacy);
      if (observacao !== row.observacao) {
        const updated = {
          ...row,
          observacao,
          updated_at: toIsoNow()
        };
        await updateRowById("LANCAMENTOS", row.id, updated);
        row.observacao = observacao;
        row.updated_at = updated.updated_at;
      }
    }

    return jsonOk({ data: row, legacy }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = lancamentoSchema.parse(body);
    if (!parsed.id) {
      throw new AppError("id obrigatorio para atualizar", 400, "MISSING_ID");
    }

    await ensureSchemaSheets();
    const lancamentos = await readLancamentos();
    const current = lancamentos.find((item) => item.id === parsed.id);
    if (!current) {
      throw new AppError(`Registro ${parsed.id} nao encontrado em LANCAMENTOS`, 404, "ROW_NOT_FOUND");
    }

    const now = toIsoNow();
    const row = {
      ...current,
      ...parsed,
      id: parsed.id,
      created_at: current.created_at,
      updated_at: now,
      observacao: parsed.observacao ?? ""
    };

    let legacy: LegacySyncResult = { status: "skipped", message: "Sincronizacao legado nao executada." };
    try {
      const removed = await removeLegacyLancamento(current);
      if (removed.status === "error") {
        legacy = {
          status: "error",
          message: removed.message ?? "Falha ao remover versao anterior no legado."
        };
      } else {
        legacy = await appendLegacyLancamento(row);
      }
    } catch {
      legacy = { status: "error", message: "Falha ao sincronizar atualizacao com o legado." };
    }

    const nextRow = {
      ...row,
      observacao: withLegacyStatusTag(row.observacao ?? "", legacy)
    };
    await updateRowById("LANCAMENTOS", parsed.id, nextRow);
    return jsonOk({ data: nextRow, legacy });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      throw new AppError("id obrigatorio para exclusao", 400, "MISSING_ID");
    }

    const lancamentos = await readLancamentos();
    const target = lancamentos.find((item) => item.id === id);
    await deleteRowById("LANCAMENTOS", id);
    const legacy = target ? await removeLegacyLancamento(target) : { status: "skipped" as const };
    return jsonOk({ ok: true, id, legacy });
  } catch (error) {
    return jsonError(error);
  }
}
