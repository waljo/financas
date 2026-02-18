import { z } from "zod";
import { AppError, isAppError } from "@/lib/errors";
import { jsonError, jsonOk } from "@/lib/http";
import { requestAppsScript } from "@/lib/mobileOffline/appsScriptClient";
import { isMobileOfflineModeEnabled } from "@/lib/mobileOffline/flags";
import {
  ATRIBUICOES,
  BANCOS_CARTAO,
  METODOS,
  ORIGENS_CARTAO_MOVIMENTO,
  PESSOA_PAGADORA,
  STATUS_CARTAO_MOVIMENTO,
  TIPO_LANCAMENTO,
  TITULARES_CARTAO
} from "@/lib/types";
import {
  appendRow,
  deleteRowById,
  ensureSchemaSheets,
  readCalendarioAnual,
  readContasFixas,
  readLancamentos,
  readReceitasRegras,
  writeRows,
  updateRowById
} from "@/lib/sheets/sheetsClient";
import { syncLancamentosCacheFromSheets } from "@/lib/sheets/lancamentosCacheClient";
import { normalizeCategoryName, normalizeCategorySlug } from "@/lib/categories";
import {
  deleteCartao,
  deleteCartaoMovimento,
  ensureCartoesDb,
  readCartaoMovimentosComAlocacoes,
  readCartoes,
  saveCartao,
  saveCartaoMovimento
} from "@/lib/sheets/cartoesClient";
import { toIsoNow } from "@/lib/utils";

export const runtime = "nodejs";

const syncLancamentoSchema = z.object({
  id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo: z.enum(TIPO_LANCAMENTO),
  descricao: z.string().min(1),
  categoria: z.string().min(1),
  valor: z.coerce.number(),
  atribuicao: z.enum(ATRIBUICOES),
  metodo: z.enum(METODOS).default("outro"),
  parcela_total: z.union([z.number(), z.null()]).optional().default(null),
  parcela_numero: z.union([z.number(), z.null()]).optional().default(null),
  observacao: z.string().optional().default(""),
  quem_pagou: z.enum(PESSOA_PAGADORA).default("WALKER"),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

const syncContaFixaSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1),
  dia_vencimento: z.coerce.number().int().min(1).max(31),
  valor_previsto: z.union([z.coerce.number(), z.null()]).optional().default(null),
  atribuicao: z.enum(ATRIBUICOES),
  quem_pagou: z.enum(PESSOA_PAGADORA).default("WALKER"),
  categoria: z.string().min(1),
  avisar_dias_antes: z.string().optional().default("5,2"),
  ativo: z.coerce.boolean().default(true)
});

const syncCalendarioAnualSchema = z.object({
  id: z.string().uuid(),
  mes: z.coerce.number().int().min(1).max(12),
  evento: z.string().min(1),
  valor_estimado: z.coerce.number().nonnegative(),
  avisar_dias_antes: z.string().optional().default("10,5,2"),
  atribuicao: z.enum(ATRIBUICOES),
  categoria: z.string().min(1),
  observacao: z.string().optional().default(""),
  dia_mes: z.union([z.coerce.number().int().min(1).max(31), z.null()]).optional().default(1)
});

const syncCategoriaSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1),
  slug: z.string().min(1).optional(),
  ativa: z.coerce.boolean().default(true),
  ordem: z.union([z.coerce.number(), z.null()]).optional().default(null),
  cor: z.string().optional().default(""),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

const syncReceitaRegraSchema = z.object({
  chave: z.string().trim().min(1),
  valor: z.string().optional().default("")
});

const syncCartaoSchema = z.object({
  id: z.string().uuid(),
  nome: z.string().min(1),
  banco: z.enum(BANCOS_CARTAO),
  titular: z.enum(TITULARES_CARTAO),
  final_cartao: z.string().optional().default(""),
  padrao_atribuicao: z.enum(ATRIBUICOES),
  ativo: z.coerce.boolean().default(true),
  created_at: z.string().optional(),
  updated_at: z.string().optional()
});

const syncCartaoMovimentoSchema = z.object({
  id: z.string().uuid(),
  cartao_id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descricao: z.string().min(1),
  valor: z.coerce.number().positive(),
  parcela_total: z.union([z.coerce.number().int().positive(), z.null()]).optional().default(null),
  parcela_numero: z.union([z.coerce.number().int().positive(), z.null()]).optional().default(null),
  tx_key: z.string().optional(),
  origem: z.enum(ORIGENS_CARTAO_MOVIMENTO).default("manual"),
  status: z.enum(STATUS_CARTAO_MOVIMENTO).default("conciliado"),
  mes_ref: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  observacao: z.string().optional().default(""),
  alocacoes: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        atribuicao: z.enum(ATRIBUICOES),
        valor: z.coerce.number().positive()
      })
    )
    .min(1)
});

const syncBatchSchema = z
  .object({
    lancamentos: z.array(syncLancamentoSchema).optional().default([]),
    lancamentos_upsert: z.array(syncLancamentoSchema).optional().default([]),
    lancamentos_delete_ids: z.array(z.string().uuid()).optional().default([]),
    contas_fixas_upsert: z.array(syncContaFixaSchema).optional().default([]),
    contas_fixas_delete_ids: z.array(z.string().uuid()).optional().default([]),
    calendario_anual_upsert: z.array(syncCalendarioAnualSchema).optional().default([]),
    calendario_anual_delete_ids: z.array(z.string().uuid()).optional().default([]),
    categorias_upsert: z.array(syncCategoriaSchema).optional().default([]),
    categorias_delete_ids: z.array(z.string().uuid()).optional().default([]),
    receitas_regras_upsert: z.array(syncReceitaRegraSchema).optional().default([]),
    receitas_regras_delete_ids: z.array(z.string().trim().min(1)).optional().default([]),
    cartoes_upsert: z.array(syncCartaoSchema).optional().default([]),
    cartoes_delete_ids: z.array(z.string().uuid()).optional().default([]),
    cartao_movimentos_upsert: z.array(syncCartaoMovimentoSchema).optional().default([]),
    cartao_movimentos_delete_ids: z.array(z.string().uuid()).optional().default([])
  })
  .superRefine((data, ctx) => {
    const total =
      data.lancamentos.length +
      data.lancamentos_upsert.length +
      data.lancamentos_delete_ids.length +
      data.contas_fixas_upsert.length +
      data.contas_fixas_delete_ids.length +
      data.calendario_anual_upsert.length +
      data.calendario_anual_delete_ids.length +
      data.categorias_upsert.length +
      data.categorias_delete_ids.length +
      data.receitas_regras_upsert.length +
      data.receitas_regras_delete_ids.length +
      data.cartoes_upsert.length +
      data.cartoes_delete_ids.length +
      data.cartao_movimentos_upsert.length +
      data.cartao_movimentos_delete_ids.length;
    if (total <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Nenhuma operacao de sync enviada"
      });
    }
  });

type SyncLancamentoInput = z.infer<typeof syncLancamentoSchema>;
type SyncContaFixaInput = z.infer<typeof syncContaFixaSchema>;
type SyncCalendarioAnualInput = z.infer<typeof syncCalendarioAnualSchema>;
type SyncCategoriaInput = z.infer<typeof syncCategoriaSchema>;
type SyncReceitaRegraInput = z.infer<typeof syncReceitaRegraSchema>;
type SyncCartaoInput = z.infer<typeof syncCartaoSchema>;
type SyncCartaoMovimentoInput = z.infer<typeof syncCartaoMovimentoSchema>;

function dedupeById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function dedupeIds(items: string[]) {
  return [...new Set(items)];
}

function dedupeByChave<T extends { chave: string }>(items: T[]) {
  const byChave = new Map<string, T>();
  for (const item of items) {
    byChave.set(item.chave, item);
  }
  return [...byChave.values()];
}

function hasAppsScriptConfig() {
  const baseUrl = process.env.APPS_SCRIPT_WEB_APP_URL?.trim();
  const token = process.env.APPS_SCRIPT_APP_TOKEN?.trim();
  return Boolean(baseUrl && token);
}

function isRowNotFound(error: unknown) {
  return isAppError(error) && error.code === "ROW_NOT_FOUND";
}

async function applySheetsFallback(params: {
  lancamentosUpsert: SyncLancamentoInput[];
  lancamentosDeleteIds: string[];
  contasFixasUpsert: SyncContaFixaInput[];
  contasFixasDeleteIds: string[];
  calendarioAnualUpsert: SyncCalendarioAnualInput[];
  calendarioAnualDeleteIds: string[];
  categoriasUpsert: SyncCategoriaInput[];
  categoriasDeleteIds: string[];
  receitasRegrasUpsert: SyncReceitaRegraInput[];
  receitasRegrasDeleteIds: string[];
  cartoesUpsert: SyncCartaoInput[];
  cartoesDeleteIds: string[];
  cartaoMovimentosUpsert: SyncCartaoMovimentoInput[];
  cartaoMovimentosDeleteIds: string[];
}) {
  await ensureSchemaSheets();

  const now = toIsoNow();
  const existingLancamentos = await readLancamentos();
  const existingLancamentosById = new Map(existingLancamentos.map((item) => [item.id, item]));
  const existingContasFixas = await readContasFixas();
  const existingContasById = new Map(existingContasFixas.map((item) => [item.id, item]));
  const existingCalendarioAnual = await readCalendarioAnual();
  const existingCalendarioById = new Map(existingCalendarioAnual.map((item) => [item.id, item]));
  const existingReceitasRegras = await readReceitasRegras();
  const existingReceitasByChave = new Map(existingReceitasRegras.map((item) => [item.chave, item]));

  let lancamentosInserted = 0;
  let lancamentosUpdated = 0;
  let lancamentosDeleted = 0;
  let contasInserted = 0;
  let contasUpdated = 0;
  let contasDeleted = 0;
  let calendarioInserted = 0;
  let calendarioUpdated = 0;
  let calendarioDeleted = 0;
  let categoriasInserted = 0;
  let categoriasUpdated = 0;
  let categoriasDeleted = 0;
  let receitasRegrasInserted = 0;
  let receitasRegrasUpdated = 0;
  let receitasRegrasDeleted = 0;
  let cartoesInserted = 0;
  let cartoesUpdated = 0;
  let cartoesDeleted = 0;
  let cartaoMovimentosInserted = 0;
  let cartaoMovimentosUpdated = 0;
  let cartaoMovimentosDeleted = 0;

  for (const id of params.lancamentosDeleteIds) {
    try {
      await deleteRowById("LANCAMENTOS", id);
      lancamentosDeleted += 1;
    } catch (error) {
      if (!isRowNotFound(error)) throw error;
    }
  }

  for (const item of params.lancamentosUpsert) {
    const current = existingLancamentosById.get(item.id);
    const normalized = {
      ...item,
      created_at: item.created_at ?? current?.created_at ?? now,
      updated_at: item.updated_at ?? now
    };

    if (current) {
      await updateRowById("LANCAMENTOS", item.id, normalized);
      lancamentosUpdated += 1;
      continue;
    }

    await appendRow("LANCAMENTOS", normalized);
    lancamentosInserted += 1;
  }

  for (const id of params.contasFixasDeleteIds) {
    try {
      await deleteRowById("CONTAS_FIXAS", id);
      contasDeleted += 1;
    } catch (error) {
      if (!isRowNotFound(error)) throw error;
    }
  }

  for (const item of params.contasFixasUpsert) {
    if (existingContasById.has(item.id)) {
      await updateRowById("CONTAS_FIXAS", item.id, item);
      contasUpdated += 1;
      continue;
    }

    await appendRow("CONTAS_FIXAS", item);
    contasInserted += 1;
  }

  for (const id of params.calendarioAnualDeleteIds) {
    try {
      await deleteRowById("CALENDARIO_ANUAL", id);
      calendarioDeleted += 1;
    } catch (error) {
      if (!isRowNotFound(error)) throw error;
    }
  }

  for (const item of params.calendarioAnualUpsert) {
    if (existingCalendarioById.has(item.id)) {
      await updateRowById("CALENDARIO_ANUAL", item.id, item);
      calendarioUpdated += 1;
      continue;
    }

    await appendRow("CALENDARIO_ANUAL", item);
    calendarioInserted += 1;
  }

  for (const id of params.categoriasDeleteIds) {
    try {
      await deleteRowById("CATEGORIAS", id);
      categoriasDeleted += 1;
    } catch (error) {
      if (!isRowNotFound(error)) throw error;
    }
  }

  for (const item of params.categoriasUpsert) {
    const nowCategory = toIsoNow();
    const nome = normalizeCategoryName(item.nome);
    const slug = normalizeCategorySlug(item.slug ?? item.nome);
    const normalized = {
      id: item.id,
      nome,
      slug,
      ativa: item.ativa,
      ordem: item.ordem,
      cor: item.cor.trim(),
      created_at: item.created_at ?? nowCategory,
      updated_at: item.updated_at ?? nowCategory
    };

    try {
      await updateRowById("CATEGORIAS", item.id, normalized);
      categoriasUpdated += 1;
    } catch (error) {
      if (!isRowNotFound(error)) throw error;
      await appendRow("CATEGORIAS", normalized);
      categoriasInserted += 1;
    }
  }

  if (params.receitasRegrasDeleteIds.length > 0 || params.receitasRegrasUpsert.length > 0) {
    const nextByChave = new Map(existingReceitasByChave);

    for (const chave of params.receitasRegrasDeleteIds) {
      if (nextByChave.delete(chave)) {
        receitasRegrasDeleted += 1;
      }
    }

    for (const item of params.receitasRegrasUpsert) {
      if (nextByChave.has(item.chave)) {
        receitasRegrasUpdated += 1;
      } else {
        receitasRegrasInserted += 1;
      }
      nextByChave.set(item.chave, {
        chave: item.chave,
        valor: item.valor
      });
    }

    await writeRows("RECEITAS_REGRAS", [...nextByChave.values()]);
  }

  const hasCartaoOps =
    params.cartoesUpsert.length > 0 ||
    params.cartoesDeleteIds.length > 0 ||
    params.cartaoMovimentosUpsert.length > 0 ||
    params.cartaoMovimentosDeleteIds.length > 0;

  if (hasCartaoOps) {
    await ensureCartoesDb();
    const existingCartoes = new Set((await readCartoes()).map((item) => item.id));
    const existingMovimentos = new Set((await readCartaoMovimentosComAlocacoes()).map((item) => item.id));

    for (const id of params.cartaoMovimentosDeleteIds) {
      try {
        await deleteCartaoMovimento(id);
        if (existingMovimentos.has(id)) {
          cartaoMovimentosDeleted += 1;
          existingMovimentos.delete(id);
        }
      } catch (error) {
        if (!isRowNotFound(error)) throw error;
      }
    }

    for (const item of params.cartoesUpsert) {
      await saveCartao({
        id: item.id,
        nome: item.nome,
        banco: item.banco,
        titular: item.titular,
        final_cartao: item.final_cartao,
        padrao_atribuicao: item.padrao_atribuicao,
        ativo: item.ativo,
        allowCreateWithProvidedId: true
      });
      if (existingCartoes.has(item.id)) {
        cartoesUpdated += 1;
      } else {
        cartoesInserted += 1;
        existingCartoes.add(item.id);
      }
    }

    const cartoesDeleteSet = new Set(params.cartoesDeleteIds);
    const movimentosUpsert = params.cartaoMovimentosUpsert.filter((item) => !cartoesDeleteSet.has(item.cartao_id));
    for (const item of movimentosUpsert) {
      await saveCartaoMovimento({
        id: item.id,
        cartao_id: item.cartao_id,
        data: item.data,
        descricao: item.descricao,
        valor: item.valor,
        parcela_total: item.parcela_total,
        parcela_numero: item.parcela_numero,
        tx_key: item.tx_key,
        origem: item.origem,
        status: item.status,
        mes_ref: item.mes_ref,
        observacao: item.observacao,
        alocacoes: item.alocacoes.map((alocacao) => ({
          id: alocacao.id,
          atribuicao: alocacao.atribuicao,
          valor: alocacao.valor
        })),
        allowCreateWithProvidedId: true
      });
      if (existingMovimentos.has(item.id)) {
        cartaoMovimentosUpdated += 1;
      } else {
        cartaoMovimentosInserted += 1;
        existingMovimentos.add(item.id);
      }
    }

    for (const id of params.cartoesDeleteIds) {
      try {
        await deleteCartao(id);
        if (existingCartoes.has(id)) {
          cartoesDeleted += 1;
          existingCartoes.delete(id);
        }
      } catch (error) {
        if (!isRowNotFound(error)) throw error;
      }
    }
  }

  if (
    params.lancamentosUpsert.length > 0 ||
    params.lancamentosDeleteIds.length > 0
  ) {
    try {
      await syncLancamentosCacheFromSheets();
    } catch {
      // Mantem sucesso no Sheets mesmo se cache local falhar.
    }
  }

  return {
    mode: "sheets_oauth_fallback" as const,
    lancamentos: {
      inserted: lancamentosInserted,
      updated: lancamentosUpdated,
      deleted: lancamentosDeleted
    },
    contasFixas: {
      inserted: contasInserted,
      updated: contasUpdated,
      deleted: contasDeleted
    },
    calendarioAnual: {
      inserted: calendarioInserted,
      updated: calendarioUpdated,
      deleted: calendarioDeleted
    },
    categorias: {
      inserted: categoriasInserted,
      updated: categoriasUpdated,
      deleted: categoriasDeleted
    },
    receitasRegras: {
      inserted: receitasRegrasInserted,
      updated: receitasRegrasUpdated,
      deleted: receitasRegrasDeleted
    },
    cartoes: {
      inserted: cartoesInserted,
      updated: cartoesUpdated,
      deleted: cartoesDeleted
    },
    cartaoMovimentos: {
      inserted: cartaoMovimentosInserted,
      updated: cartaoMovimentosUpdated,
      deleted: cartaoMovimentosDeleted
    }
  };
}

export async function POST(request: Request) {
  try {
    if (!isMobileOfflineModeEnabled()) {
      throw new AppError("MOBILE_OFFLINE_MODE desativado", 403, "MOBILE_OFFLINE_DISABLED");
    }

    const body = await request.json();
    const parsed = syncBatchSchema.parse(body);

    const dedupedLancamentos = dedupeById([...parsed.lancamentos, ...parsed.lancamentos_upsert]);
    const dedupedLancamentosDeleteIds = dedupeIds(parsed.lancamentos_delete_ids);
    const deleteLancamentosSet = new Set(dedupedLancamentosDeleteIds);
    const lancamentosUpsert = dedupedLancamentos.filter((item) => !deleteLancamentosSet.has(item.id));
    const contasFixasUpsert = dedupeById(parsed.contas_fixas_upsert);
    const contasFixasDeleteIds = dedupeIds(parsed.contas_fixas_delete_ids);
    const calendarioAnualUpsert = dedupeById(parsed.calendario_anual_upsert);
    const calendarioAnualDeleteIds = dedupeIds(parsed.calendario_anual_delete_ids);
    const categoriasUpsert = dedupeById(parsed.categorias_upsert);
    const categoriasDeleteIds = dedupeIds(parsed.categorias_delete_ids);
    const dedupedReceitasRegrasDeleteIds = dedupeIds(parsed.receitas_regras_delete_ids);
    const receitasRegrasDeleteSet = new Set(dedupedReceitasRegrasDeleteIds);
    const receitasRegrasUpsert = dedupeByChave(parsed.receitas_regras_upsert).filter(
      (item) => !receitasRegrasDeleteSet.has(item.chave)
    );
    const dedupedCartoesDeleteIds = dedupeIds(parsed.cartoes_delete_ids);
    const cartoesDeleteSet = new Set(dedupedCartoesDeleteIds);
    const cartoesUpsert = dedupeById(parsed.cartoes_upsert).filter((item) => !cartoesDeleteSet.has(item.id));
    const dedupedCartaoMovimentosDeleteIds = dedupeIds(parsed.cartao_movimentos_delete_ids);
    const cartaoMovimentosDeleteSet = new Set(dedupedCartaoMovimentosDeleteIds);
    const cartaoMovimentosUpsert = dedupeById(parsed.cartao_movimentos_upsert).filter(
      (item) => !cartaoMovimentosDeleteSet.has(item.id)
    );

    const hasContaOps = contasFixasUpsert.length > 0 || contasFixasDeleteIds.length > 0;
    const hasCalendarioOps = calendarioAnualUpsert.length > 0 || calendarioAnualDeleteIds.length > 0;
    const hasCategoriaOps = categoriasUpsert.length > 0 || categoriasDeleteIds.length > 0;
    const hasReceitaRegraOps =
      receitasRegrasUpsert.length > 0 || dedupedReceitasRegrasDeleteIds.length > 0;
    const hasCartaoOps =
      cartoesUpsert.length > 0 ||
      dedupedCartoesDeleteIds.length > 0 ||
      cartaoMovimentosUpsert.length > 0 ||
      dedupedCartaoMovimentosDeleteIds.length > 0;
    const hasLancamentoDeleteOps = dedupedLancamentosDeleteIds.length > 0;
    const canUseAppsScriptBatch =
      hasAppsScriptConfig() &&
      !hasContaOps &&
      !hasCalendarioOps &&
      !hasCategoriaOps &&
      !hasReceitaRegraOps &&
      !hasCartaoOps &&
      !hasLancamentoDeleteOps;

    if (canUseAppsScriptBatch) {
      const now = toIsoNow();
      const normalized = lancamentosUpsert.map((item) => ({
        ...item,
        created_at: item.created_at ?? now,
        updated_at: item.updated_at ?? now
      }));

      const appToken = process.env.APPS_SCRIPT_APP_TOKEN?.trim();
      const result = await requestAppsScript("addLancamentosBatch", {
        method: "POST",
        body: JSON.stringify({ lancamentos: normalized, appToken })
      });

      const remoteBody = result.body;
      if (
        remoteBody &&
        typeof remoteBody === "object" &&
        "ok" in remoteBody &&
        remoteBody.ok === false
      ) {
        const remoteMessage =
          "message" in remoteBody && typeof remoteBody.message === "string"
            ? remoteBody.message
            : "Apps Script retornou erro de negocio";
        throw new AppError(remoteMessage, 502, "APPS_SCRIPT_REJECTED", remoteBody);
      }

      const syncedIds =
        remoteBody &&
        typeof remoteBody === "object" &&
        "synced_ids" in remoteBody &&
        Array.isArray(remoteBody.synced_ids)
          ? (remoteBody.synced_ids as string[])
          : normalized.map((item) => item.id);

      return jsonOk({
        ok: true,
        mode: "apps_script_batch",
        synced_ids: syncedIds,
        sent_count: normalized.length,
        deleted_count: 0,
        contas_count: 0,
        calendario_count: 0,
        categorias_count: 0,
        receitas_regras_count: 0,
        cartoes_count: 0,
        cartao_movimentos_count: 0,
        target: result.url,
        remote: remoteBody
      });
    }

    const applied = await applySheetsFallback({
      lancamentosUpsert,
      lancamentosDeleteIds: dedupedLancamentosDeleteIds,
      contasFixasUpsert,
      contasFixasDeleteIds,
      calendarioAnualUpsert,
      calendarioAnualDeleteIds,
      categoriasUpsert,
      categoriasDeleteIds,
      receitasRegrasUpsert,
      receitasRegrasDeleteIds: dedupedReceitasRegrasDeleteIds,
      cartoesUpsert,
      cartoesDeleteIds: dedupedCartoesDeleteIds,
      cartaoMovimentosUpsert,
      cartaoMovimentosDeleteIds: dedupedCartaoMovimentosDeleteIds
    });

    return jsonOk({
      ok: true,
      ...applied,
      synced_ids: [
        ...lancamentosUpsert.map((item) => item.id),
        ...dedupedLancamentosDeleteIds,
        ...contasFixasUpsert.map((item) => item.id),
        ...contasFixasDeleteIds,
        ...calendarioAnualUpsert.map((item) => item.id),
        ...calendarioAnualDeleteIds,
        ...categoriasUpsert.map((item) => item.id),
        ...categoriasDeleteIds,
        ...receitasRegrasUpsert.map((item) => item.chave),
        ...dedupedReceitasRegrasDeleteIds,
        ...cartoesUpsert.map((item) => item.id),
        ...dedupedCartoesDeleteIds,
        ...cartaoMovimentosUpsert.map((item) => item.id),
        ...dedupedCartaoMovimentosDeleteIds
      ],
      sent_count: lancamentosUpsert.length,
      deleted_count: dedupedLancamentosDeleteIds.length,
      contas_count: contasFixasUpsert.length + contasFixasDeleteIds.length,
      calendario_count: calendarioAnualUpsert.length + calendarioAnualDeleteIds.length,
      categorias_count: categoriasUpsert.length + categoriasDeleteIds.length,
      receitas_regras_count: receitasRegrasUpsert.length + dedupedReceitasRegrasDeleteIds.length,
      cartoes_count: cartoesUpsert.length + dedupedCartoesDeleteIds.length,
      cartao_movimentos_count:
        cartaoMovimentosUpsert.length + dedupedCartaoMovimentosDeleteIds.length
    });
  } catch (error) {
    return jsonError(error);
  }
}
