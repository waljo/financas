import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { deleteCartao, ensureCartoesDb, readCartoes, saveCartao } from "@/lib/sheets/cartoesClient";
import { cartaoCreditoSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureCartoesDb();
    const rows = await readCartoes();
    const ordered = [...rows].sort((a, b) => {
      if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
      return a.nome.localeCompare(b.nome);
    });
    return jsonOk({ data: ordered });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureCartoesDb();
    const body = await request.json();
    const parsed = cartaoCreditoSchema.parse(body);
    const row = await saveCartao(parsed);
    return jsonOk({ data: row }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    await ensureCartoesDb();
    const body = await request.json();
    const parsed = cartaoCreditoSchema.parse(body);
    if (!parsed.id) {
      throw new AppError("id obrigatorio para atualizar cartao", 400, "MISSING_ID");
    }
    const row = await saveCartao(parsed);
    return jsonOk({ data: row });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureCartoesDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      throw new AppError("id obrigatorio para exclusao", 400, "MISSING_ID");
    }
    await deleteCartao(id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
