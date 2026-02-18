import { z } from "zod";
import { AppError } from "@/lib/errors";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import { jsonError, jsonOk } from "@/lib/http";
import { isMobileOfflineModeEnabled } from "@/lib/mobileOffline/flags";
import {
  MOBILE_BOOTSTRAP_SCHEMA_VERSION,
  type MobileBootstrapResponse
} from "@/lib/mobileNative/contracts";
import {
  ensureSchemaSheets,
  readCalendarioAnual,
  readContasFixas,
  readLancamentos,
  readReceitasRegras,
  readRows
} from "@/lib/sheets/sheetsClient";
import {
  ensureCartoesDb,
  readCartaoMovimentosComAlocacoes,
  readCartoes
} from "@/lib/sheets/cartoesClient";
import type { Categoria } from "@/lib/types";
import { parseBoolean, parseNumber, toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

const querySchema = z.object({
  include_inactive_categories: z.enum(["0", "1"]).optional().default("1")
});

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

async function readCategorias(includeInactive: boolean): Promise<Categoria[]> {
  const rows = await readRows("CATEGORIAS");
  const mapped = rows
    .map(mapCategoria)
    .filter((item): item is Categoria => Boolean(item))
    .sort((a, b) => {
      const ordemA = a.ordem ?? Number.MAX_SAFE_INTEGER;
      const ordemB = b.ordem ?? Number.MAX_SAFE_INTEGER;
      if (ordemA !== ordemB) return ordemA - ordemB;
      return a.nome.localeCompare(b.nome);
    });

  if (includeInactive) return mapped;
  return mapped.filter((item) => item.ativa);
}

export async function GET(request: Request) {
  try {
    if (!isMobileOfflineModeEnabled()) {
      throw new AppError("MOBILE_OFFLINE_MODE desativado", 403, "MOBILE_OFFLINE_DISABLED");
    }

    const parsedQuery = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    const includeInactiveCategories = parsedQuery.include_inactive_categories === "1";

    await Promise.all([ensureSchemaSheets(), ensureCartoesDb()]);

    const [
      lancamentos,
      contasFixas,
      calendarioAnual,
      receitasRegras,
      categorias,
      cartoes,
      cartaoMovimentos
    ] = await Promise.all([
      readLancamentos(),
      readContasFixas(),
      readCalendarioAnual(),
      readReceitasRegras(),
      readCategorias(includeInactiveCategories),
      readCartoes(),
      readCartaoMovimentosComAlocacoes()
    ]);

    const response: MobileBootstrapResponse = {
      ok: true,
      schema_version: MOBILE_BOOTSTRAP_SCHEMA_VERSION,
      generated_at: toIsoNow(),
      counts: {
        lancamentos: lancamentos.length,
        contas_fixas: contasFixas.length,
        calendario_anual: calendarioAnual.length,
        receitas_regras: receitasRegras.length,
        categorias: categorias.length,
        cartoes: cartoes.length,
        cartao_movimentos: cartaoMovimentos.length
      },
      data: {
        lancamentos,
        contas_fixas: contasFixas,
        calendario_anual: calendarioAnual,
        receitas_regras: receitasRegras,
        categorias,
        cartoes,
        cartao_movimentos: cartaoMovimentos
      }
    };

    return jsonOk(response);
  } catch (error) {
    return jsonError(error);
  }
}

