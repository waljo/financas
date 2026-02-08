import { jsonError, jsonOk } from "@/lib/http";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import {
  ensureSchemaSheets,
  readCalendarioAnual,
  readContasFixas,
  readLancamentos,
  readRows
} from "@/lib/sheets/sheetsClient";
import { parseBoolean } from "@/lib/utils";

export const runtime = "nodejs";

type CategoriaPreviewItem = {
  nome: string;
  slug: string;
  usoTotal: number;
  status: "existing_active" | "existing_inactive" | "missing";
  categoriaId: string | null;
  categoriaNome: string | null;
};

export async function GET() {
  try {
    await ensureSchemaSheets();
    const [lancamentos, contasFixas, calendario, categoriasRows] = await Promise.all([
      readLancamentos(),
      readContasFixas(),
      readCalendarioAnual(),
      readRows("CATEGORIAS")
    ]);

    const categorias = categoriasRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        nome: normalizeCategoryName(row.nome ?? ""),
        slug: normalizeCategorySlug(row.slug ?? row.nome ?? ""),
        ativa: (row.ativa ?? "").trim() === "" ? true : parseBoolean(row.ativa)
      }))
      .filter((item) => item.id && item.slug);
    const categoriasBySlug = new Map(categorias.map((item) => [item.slug, item]));

    const usage = new Map<string, { nome: string; usoTotal: number }>();
    const used = [
      ...lancamentos.map((item) => item.categoria),
      ...contasFixas.map((item) => item.categoria),
      ...calendario.map((item) => item.categoria)
    ];
    for (const raw of used) {
      const nome = normalizeCategoryName(raw ?? "");
      if (!nome) continue;
      const slug = normalizeCategorySlug(nome);
      const current = usage.get(slug);
      if (!current) {
        usage.set(slug, { nome, usoTotal: 1 });
      } else {
        current.usoTotal += 1;
      }
    }

    const items: CategoriaPreviewItem[] = [...usage.entries()]
      .map(([slug, info]) => {
        const existing = categoriasBySlug.get(slug);
        let status: CategoriaPreviewItem["status"] = "missing";
        if (existing) {
          status = existing.ativa ? "existing_active" : "existing_inactive";
        }
        return {
          nome: info.nome,
          slug,
          usoTotal: info.usoTotal,
          status,
          categoriaId: existing?.id ?? null,
          categoriaNome: existing?.nome ?? null
        };
      })
      .sort((a, b) => b.usoTotal - a.usoTotal || a.nome.localeCompare(b.nome));

    const summary = {
      totalCategoriasEmUso: items.length,
      totalUsos: items.reduce((acc, item) => acc + item.usoTotal, 0),
      missing: items.filter((item) => item.status === "missing").length,
      existingActive: items.filter((item) => item.status === "existing_active").length,
      existingInactive: items.filter((item) => item.status === "existing_inactive").length
    };

    return jsonOk({ data: { summary, items } });
  } catch (error) {
    return jsonError(error);
  }
}
