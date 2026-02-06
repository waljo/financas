import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { appendRow, deleteRowById, readLancamentos, updateRowById } from "@/lib/sheets/sheetsClient";
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

    await appendRow("LANCAMENTOS", row);

    return jsonOk({ data: row }, 201);
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

    await deleteRowById("LANCAMENTOS", id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
