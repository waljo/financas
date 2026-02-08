import { randomUUID } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import {
  appendRow,
  ensureSchemaSheets,
  readCalendarioAnual,
  readContasFixas,
  readLancamentos,
  readRows,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import { categoriaNormalizeRunSchema } from "@/lib/validation/schemas";
import { parseBoolean, toIsoNow } from "@/lib/utils";
import type { Categoria } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = categoriaNormalizeRunSchema.parse(body);

    await ensureSchemaSheets();
    const [lancamentos, contasFixas, calendario, categoriasRows] = await Promise.all([
      readLancamentos(),
      readContasFixas(),
      readCalendarioAnual(),
      readRows("CATEGORIAS")
    ]);

    const now = toIsoNow();
    const categorias = categoriasRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        nome: normalizeCategoryName(row.nome ?? ""),
        slug: normalizeCategorySlug(row.slug ?? row.nome ?? ""),
        ativa: (row.ativa ?? "").trim() === "" ? true : parseBoolean(row.ativa),
        ordem: row.ordem ? Number(row.ordem) : null,
        cor: row.cor ?? "",
        created_at: row.created_at ?? now,
        updated_at: row.updated_at ?? now
      }))
      .filter((item) => item.id && item.slug) as Categoria[];
    const categoriasBySlug = new Map(categorias.map((item) => [item.slug, item]));

    const usageBySlug = new Map<string, string>();
    const used = [
      ...lancamentos.map((item) => item.categoria),
      ...contasFixas.map((item) => item.categoria),
      ...calendario.map((item) => item.categoria)
    ];
    for (const raw of used) {
      const nome = normalizeCategoryName(raw ?? "");
      if (!nome) continue;
      const slug = normalizeCategorySlug(nome);
      if (!usageBySlug.has(slug)) usageBySlug.set(slug, nome);
    }

    let created = 0;
    let reativadas = 0;
    for (const [slug, nome] of usageBySlug.entries()) {
      const existing = categoriasBySlug.get(slug);
      if (!existing) {
        const row: Categoria = {
          id: randomUUID(),
          nome,
          slug,
          ativa: true,
          ordem: null,
          cor: "",
          created_at: now,
          updated_at: now
        };
        await appendRow("CATEGORIAS", row);
        categoriasBySlug.set(slug, row);
        created += 1;
        continue;
      }

      if (parsed.reativarInativas && !existing.ativa) {
        const next: Categoria = {
          ...existing,
          ativa: true,
          updated_at: now
        };
        await updateRowById("CATEGORIAS", existing.id, next);
        categoriasBySlug.set(slug, next);
        reativadas += 1;
      }
    }

    return jsonOk({
      data: {
        created,
        reativadas,
        totalCategoriasEmUso: usageBySlug.size
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}
