import { z } from "zod";
import { ATRIBUICOES, METODOS, PESSOA_PAGADORA, TIPO_LANCAMENTO } from "@/lib/types";

const nullableNumber = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
});

export const lancamentoSchema = z
  .object({
    id: z.string().uuid().optional(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use formato YYYY-MM-DD"),
    tipo: z.enum(TIPO_LANCAMENTO),
    descricao: z.string().min(1),
    categoria: z.string().min(1),
    valor: z.coerce.number(),
    atribuicao: z.enum(ATRIBUICOES),
    metodo: z.enum(METODOS).default("outro"),
    parcela_total: nullableNumber.optional().default(null),
    parcela_numero: nullableNumber.optional().default(null),
    observacao: z.string().optional().default(""),
    quem_pagou: z.enum(PESSOA_PAGADORA).default("WALKER")
  })
  .superRefine((data, ctx) => {
    if (!Number.isFinite(data.valor) || data.valor === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor precisa ser diferente de zero", path: ["valor"] });
      return;
    }
  });

export const contaFixaSchema = z.object({
  id: z.string().uuid().optional(),
  nome: z.string().min(1),
  dia_vencimento: z.coerce.number().int().min(1).max(31),
  valor_previsto: nullableNumber.optional().default(null),
  atribuicao: z.enum(ATRIBUICOES),
  categoria: z.string().min(1),
  avisar_dias_antes: z.string().default("5,2"),
  ativo: z.coerce.boolean().default(true)
});

export const calendarioAnualSchema = z.object({
  id: z.string().uuid().optional(),
  mes: z.coerce.number().int().min(1).max(12),
  evento: z.string().min(1),
  valor_estimado: z.coerce.number().nonnegative(),
  avisar_dias_antes: z.string().default("10,5,2"),
  atribuicao: z.enum(ATRIBUICOES),
  categoria: z.string().min(1),
  observacao: z.string().optional().default(""),
  dia_mes: nullableNumber.optional().default(1)
});

export const reportQuerySchema = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/)
});

const monthStartColsSchema = z
  .union([z.coerce.number().int().min(1), z.array(z.coerce.number().int().min(1)).min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export const importPreviewSchema = z.object({
  sourceSheet: z.string().min(1),
  tipo: z.enum(TIPO_LANCAMENTO).default("despesa"),
  year: z.coerce.number().int().min(2000).max(2100),
  monthStartCols: monthStartColsSchema.optional(),
  monthStartCol: z.coerce.number().int().min(1).optional(),
  startRow: z.coerce.number().int().min(1),
  endRow: z.coerce.number().int().min(1),
  skipMonthsAlreadyImported: z.coerce.boolean().optional().default(true),
  onlyNegative: z.coerce.boolean().optional().default(false),
  mapping: z.object({
    descricaoCol: z.coerce.number().int().min(1),
    valorCol: z.coerce.number().int().min(1),
    diaCol: z.coerce.number().int().min(1),
    atribuicaoCol: z.coerce.number().int().min(1).optional(),
    quemPagouCol: z.coerce.number().int().min(1).optional(),
    categoriaCol: z.coerce.number().int().min(1).optional()
  }),
  defaults: z
    .object({
      categoria: z.string().optional(),
      atribuicao: z.enum(ATRIBUICOES).optional(),
      metodo: z.enum(METODOS).optional(),
      quem_pagou: z.enum(PESSOA_PAGADORA).optional()
    })
    .optional()
});

export const importRunSchema = importPreviewSchema.extend({
  dryRun: z.coerce.boolean().optional().default(false)
});
