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
      const status = legacy.status.toUpperCase();
      const tag = `[LEGADO:${status}]`;
      const detail = legacy.message ? `(${legacy.message})` : "";
      const where = legacy.range ? `(range ${legacy.range})` : "";
      const tagFull = [tag, detail, where].filter(Boolean).join(" ");
      const observacao = row.observacao?.includes("[LEGADO:")
        ? row.observacao
        : row.observacao
          ? `${row.observacao} ${tagFull}`
          : tagFull;
      if (observacao !== row.observacao) {
        await updateRowById("LANCAMENTOS", row.id, {
          ...row,
          observacao,
          updated_at: toIsoNow()
        });
        row.observacao = observacao;
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

    const now = toIsoNow();
    const row = {
      ...parsed,
      updated_at: now,
      observacao: parsed.observacao ?? ""
    };

    await ensureSchemaSheets();
    await updateRowById("LANCAMENTOS", parsed.id, row);
    return jsonOk({ data: row });
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
