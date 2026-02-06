import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { appendRow, deleteRowById, readCalendarioAnual, updateRowById } from "@/lib/sheets/sheetsClient";
import { jsonError, jsonOk } from "@/lib/http";
import { calendarioAnualSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await readCalendarioAnual();
    return jsonOk({ data: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = calendarioAnualSchema.parse(body);
    const row = {
      ...parsed,
      id: parsed.id ?? randomUUID()
    };

    await appendRow("CALENDARIO_ANUAL", row);
    return jsonOk({ data: row }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = calendarioAnualSchema.parse(body);

    if (!parsed.id) {
      throw new AppError("id obrigatorio para atualizar", 400, "MISSING_ID");
    }

    await updateRowById("CALENDARIO_ANUAL", parsed.id, parsed);
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

    await deleteRowById("CALENDARIO_ANUAL", id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
