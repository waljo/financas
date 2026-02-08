import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import {
  appendRow,
  deleteRowById,
  ensureSchemaSheets,
  readCalendarioAnual,
  readContasFixas,
  readLancamentos,
  readRows,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import { categoriaSchema } from "@/lib/validation/schemas";
import type { Categoria } from "@/lib/types";
import { parseBoolean, parseNumber, toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

type CategoriaComUso = Categoria & {
  usoTotal: number;
};

function mapCategoria(row: Record<string, string>): Categoria | null {
  const id = row.id?.trim();
  if (!id) return null;
  const ativaRaw = (row.ativa ?? "").trim();
  return {
    id,
    nome: normalizeCategoryName(row.nome ?? ""),
    slug: normalizeCategorySlug(row.slug ?? row.nome ?? ""),
    ativa: ativaRaw === "" ? true : parseBoolean(ativaRaw),
    ordem: row.ordem ? parseNumber(row.ordem, 0) : null,
    cor: (row.cor ?? "").trim(),
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? ""
  };
}

async function readCategorias(): Promise<Categoria[]> {
  await ensureSchemaSheets();
  const rows = await readRows("CATEGORIAS");
  return rows
    .map(mapCategoria)
    .filter((item): item is Categoria => Boolean(item))
    .sort((a, b) => {
      const ordemA = a.ordem ?? Number.MAX_SAFE_INTEGER;
      const ordemB = b.ordem ?? Number.MAX_SAFE_INTEGER;
      if (ordemA !== ordemB) return ordemA - ordemB;
      return a.nome.localeCompare(b.nome);
    });
}

async function buildUsageMap(): Promise<Map<string, number>> {
  const [lancamentos, contasFixas, calendario] = await Promise.all([
    readLancamentos(),
    readContasFixas(),
    readCalendarioAnual()
  ]);
  const usage = new Map<string, number>();

  const all = [
    ...lancamentos.map((item) => item.categoria),
    ...contasFixas.map((item) => item.categoria),
    ...calendario.map((item) => item.categoria)
  ];
  for (const raw of all) {
    const nome = normalizeCategoryName(raw ?? "");
    if (!nome) continue;
    const slug = normalizeCategorySlug(nome);
    usage.set(slug, (usage.get(slug) ?? 0) + 1);
  }
  return usage;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = normalizeCategorySlug(searchParams.get("search") ?? "");
    const ativoParam = searchParams.get("ativo");
    const onlyActive = ativoParam === null ? null : parseBoolean(ativoParam);

    const [categorias, usage] = await Promise.all([readCategorias(), buildUsageMap()]);
    const filtered = categorias
      .filter((item) => (onlyActive === null ? true : item.ativa === onlyActive))
      .filter((item) => (search ? normalizeCategorySlug(item.nome).includes(search) : true))
      .map((item) => ({
        ...item,
        usoTotal: usage.get(item.slug) ?? 0
      })) satisfies CategoriaComUso[];

    return jsonOk({ data: filtered });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = categoriaSchema.parse(body);
    const nome = normalizeCategoryName(parsed.nome);
    const slug = normalizeCategorySlug(nome);
    if (!slug) {
      throw new AppError("Nome de categoria invalido", 400, "INVALID_CATEGORY_NAME");
    }

    const categorias = await readCategorias();
    const existing = categorias.find((item) => item.slug === slug);
    if (existing) {
      return jsonOk({ data: existing, created: false });
    }

    const now = toIsoNow();
    const row: Categoria = {
      id: randomUUID(),
      nome,
      slug,
      ativa: parsed.ativa,
      ordem: parsed.ordem,
      cor: parsed.cor.trim(),
      created_at: now,
      updated_at: now
    };

    await appendRow("CATEGORIAS", row);
    return jsonOk({ data: row, created: true }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = categoriaSchema.parse(body);
    if (!parsed.id) {
      throw new AppError("id obrigatorio para atualizar categoria", 400, "MISSING_ID");
    }

    const categorias = await readCategorias();
    const current = categorias.find((item) => item.id === parsed.id);
    if (!current) {
      throw new AppError("Categoria nao encontrada", 404, "ROW_NOT_FOUND");
    }

    const nome = normalizeCategoryName(parsed.nome);
    const slug = normalizeCategorySlug(nome);
    if (!slug) {
      throw new AppError("Nome de categoria invalido", 400, "INVALID_CATEGORY_NAME");
    }

    const duplicate = categorias.find((item) => item.slug === slug && item.id !== parsed.id);
    if (duplicate) {
      throw new AppError(`Ja existe categoria equivalente: ${duplicate.nome}`, 409, "DUPLICATE_CATEGORY");
    }

    const next: Categoria = {
      ...current,
      nome,
      slug,
      ativa: parsed.ativa,
      ordem: parsed.ordem,
      cor: parsed.cor.trim(),
      updated_at: toIsoNow()
    };

    await updateRowById("CATEGORIAS", parsed.id, next);
    return jsonOk({ data: next });
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

    const categorias = await readCategorias();
    const current = categorias.find((item) => item.id === id);
    if (!current) {
      throw new AppError("Categoria nao encontrada", 404, "ROW_NOT_FOUND");
    }

    const usage = await buildUsageMap();
    const usageCount = usage.get(current.slug) ?? 0;
    if (usageCount > 0) {
      throw new AppError(
        `Categoria em uso (${usageCount} registro(s)). Desative em vez de excluir.`,
        409,
        "CATEGORY_IN_USE"
      );
    }

    await deleteRowById("CATEGORIAS", id);
    return jsonOk({ ok: true, id });
  } catch (error) {
    return jsonError(error);
  }
}
