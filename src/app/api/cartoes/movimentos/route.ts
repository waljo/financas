import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import {
  buildCartaoTxKey,
  deleteCartaoMovimento,
  ensureCartoesDb,
  readCartaoMovimentosComAlocacoes,
  saveCartaoMovimento
} from "@/lib/sheets/cartoesClient";
import { cartaoMovimentoSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await ensureCartoesDb();
    const { searchParams } = new URL(request.url);
    const mes = searchParams.get("mes")?.trim();
    const cartaoId = searchParams.get("cartaoId")?.trim();
    const status = searchParams.get("status")?.trim();

    const rows = await readCartaoMovimentosComAlocacoes();
    const filtered = rows.filter((item) => {
      if (mes && item.mes_ref !== mes) return false;
      if (cartaoId && item.cartao_id !== cartaoId) return false;
      if (status && item.status !== status) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (a.data !== b.data) return b.data.localeCompare(a.data);
      return b.created_at.localeCompare(a.created_at);
    });

    return jsonOk({ data: filtered });
  } catch (error) {
    return jsonError(error);
  }
}

async function saveFromPayload(body: unknown, idMode: "create" | "update") {
  await ensureCartoesDb();
  const parsed = cartaoMovimentoSchema.parse(body);
  if (idMode === "update" && !parsed.id) {
    throw new AppError("id obrigatorio para atualizar movimento", 400, "MISSING_ID");
  }
  if (idMode === "create" && parsed.id) {
    throw new AppError("id nao deve ser informado na criacao", 400, "INVALID_ID");
  }

  const tx_key =
    parsed.tx_key?.trim() ||
    buildCartaoTxKey({
      cartao_id: parsed.cartao_id,
      data: parsed.data,
      descricao: parsed.descricao,
      valor: parsed.valor,
      parcela_total: parsed.parcela_total,
      parcela_numero: parsed.parcela_numero
    });

  return saveCartaoMovimento({
    id: parsed.id,
    cartao_id: parsed.cartao_id,
    data: parsed.data,
    descricao: parsed.descricao,
    valor: parsed.valor,
    parcela_total: parsed.parcela_total,
    parcela_numero: parsed.parcela_numero,
    tx_key,
    origem: parsed.origem,
    status: parsed.status,
    mes_ref: parsed.mes_ref,
    observacao: parsed.observacao,
    alocacoes: parsed.alocacoes
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const row = await saveFromPayload(body, "create");
    return jsonOk({ data: row }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const row = await saveFromPayload(body, "update");
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

    await deleteCartaoMovimento(id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
