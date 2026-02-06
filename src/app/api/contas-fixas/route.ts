import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { appendRow, deleteRowById, readContasFixas, updateRowById } from "@/lib/sheets/sheetsClient";
import { jsonError, jsonOk } from "@/lib/http";
import { contaFixaSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await readContasFixas();
    return jsonOk({ data: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = contaFixaSchema.parse(body);
    const row = {
      ...parsed,
      id: parsed.id ?? randomUUID()
    };

    await appendRow("CONTAS_FIXAS", row);
    return jsonOk({ data: row }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = contaFixaSchema.parse(body);

    if (!parsed.id) {
      throw new AppError("id obrigatorio para atualizar", 400, "MISSING_ID");
    }

    await updateRowById("CONTAS_FIXAS", parsed.id, parsed);
    return jsonOk({ data: parsed });
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

    await deleteRowById("CONTAS_FIXAS", id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
