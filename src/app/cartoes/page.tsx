"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useFeatureFlags } from "@/components/FeatureFlagsProvider";
import {
  queueCartaoMovimentoDeleteLocal,
  queueCartaoMovimentoUpsertLocal,
  queueCartaoUpsertLocal
} from "@/lib/mobileOffline/queue";
import {
  MOBILE_OFFLINE_CARTOES_CACHE_KEY,
  MOBILE_OFFLINE_CARTAO_MOVIMENTOS_CACHE_KEY
} from "@/lib/mobileOffline/storageKeys";
import type {
  Atribuicao,
  BancoCartao,
  CartaoCredito,
  CartaoMovimentoComAlocacoes
} from "@/lib/types";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseMoney(value: string) {
  let text = value.replace(/[R$\s]/g, "").trim();
  if (!text) return Number.NaN;
  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  }
  if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  text = text.replace(/[^0-9.-]/g, "");
  return Number(text);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function toIsoDate(value: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
    const [day, month, year] = text.split("/");
    return `${year}-${month}-${day}`;
  }
  return null;
}

function parseParcelaField(value: string): { numero: number | null; total: number | null } {
  const text = value.trim();
  if (!text) return { numero: null, total: null };

  const normalized = normalizeHeader(text);
  if (normalized === "UNICA" || normalized === "UNICO") {
    return { numero: null, total: null };
  }

  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numero = Number(fraction[1]);
    const total = Number(fraction[2]);
    if (Number.isInteger(numero) && numero > 0 && Number.isInteger(total) && total > 0) {
      return { numero, total };
    }
  }

  if (/^\d+$/.test(text)) {
    const numero = Number(text);
    if (Number.isInteger(numero) && numero > 0) {
      return { numero, total: null };
    }
  }

  return { numero: null, total: null };
}

type ImportLine = {
  data: string;
  descricao: string;
  valor: number;
  parcela_numero?: number | null;
  parcela_total?: number | null;
  final_cartao?: string;
  observacao?: string;
};

type ImportColumnKey =
  | "data"
  | "descricao"
  | "valor"
  | "parcela_numero"
  | "parcela_total"
  | "final_cartao"
  | "observacao";

type ImportColumnMap = Record<ImportColumnKey, number>;
type SplitMode = "none" | "DEA_AMBOS" | "WALKER_AMBOS";

const defaultImportColumnMap: ImportColumnMap = {
  data: 0,
  descricao: 1,
  valor: 2,
  parcela_numero: 3,
  parcela_total: 4,
  final_cartao: 6,
  observacao: 5
};

const headerAliases: Record<ImportColumnKey, string[]> = {
  data: ["DATA", "DATE", "DATA_COMPRA", "DATA_DE_COMPRA", "DT_COMPRA", "DATA_LANCAMENTO"],
  descricao: ["DESCRICAO", "DESCRIÇÃO", "HISTORICO", "HISTÓRICO", "ESTABELECIMENTO", "LANCAMENTO", "LANÇAMENTO"],
  valor: ["VALOR", "AMOUNT", "TOTAL", "VALOR_COMPRA", "VALOR_EM_R", "VALOR_R", "VALOR_EM_REAIS"],
  parcela_numero: ["PARCELA_NUMERO", "PARCELA_N", "NUMERO_PARCELA", "N_PARCELA", "PARCELA"],
  parcela_total: ["PARCELA_TOTAL", "TOTAL_PARCELAS", "PARCELAS"],
  final_cartao: ["FINAL_CARTAO", "FINAL_DO_CARTAO", "CARTAO_FINAL", "ULTIMOS_4", "ULTIMOS_DIGITOS"],
  observacao: ["OBS", "OBSERVACAO", "OBSERVAÇÃO", "COMPLEMENTO", "NOTA"]
};

function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function countDelimiterOutsideQuotes(line: string, delimiter: string) {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!firstLine) return ";";

  const candidates = [";", ",", "\t"];
  let best = candidates[0];
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = countDelimiterOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      const hasContent = row.some((item) => item !== "");
      if (hasContent) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell.trim());
    const hasContent = row.some((item) => item !== "");
    if (hasContent) {
      rows.push(row);
    }
  }

  return rows;
}

function looksLikeHeader(row: string[]): boolean {
  if (!row.length) return false;
  if (toIsoDate(row[0])) return false;
  const normalized = row.map(normalizeHeader);
  const keys = new Set(Object.values(headerAliases).flat().map(normalizeHeader));
  return normalized.some((item) => keys.has(item));
}

function detectColumnMapFromHeader(row: string[]): ImportColumnMap {
  const normalized = row.map(normalizeHeader);
  const map: ImportColumnMap = {
    ...defaultImportColumnMap,
    parcela_numero: -1,
    parcela_total: -1,
    final_cartao: -1,
    observacao: -1
  };

  (Object.keys(headerAliases) as ImportColumnKey[]).forEach((key) => {
    const aliases = new Set(headerAliases[key].map(normalizeHeader));
    const found = normalized.findIndex((item) => aliases.has(item));
    if (found >= 0) {
      map[key] = found;
    }
  });

  return map;
}

function parseImportRows(rows: string[][]): ImportLine[] {
  if (!rows.length) return [];

  const hasHeader = looksLikeHeader(rows[0]);
  const map = hasHeader ? detectColumnMapFromHeader(rows[0]) : defaultImportColumnMap;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const lines: ImportLine[] = [];
  for (const row of dataRows) {
    const iso = toIsoDate(row[map.data] ?? "");
    if (!iso) continue;
    const descricao = (row[map.descricao] ?? "").trim();
    if (!descricao) continue;
    const valor = parseMoney(row[map.valor] ?? "");
    if (!Number.isFinite(valor) || valor <= 0) continue;

    const parcelaNumeroRaw = row[map.parcela_numero] ?? "";
    const parcelaTotalRaw = row[map.parcela_total] ?? "";
    const parsedNumero = parseParcelaField(parcelaNumeroRaw);
    const parsedTotal = parseParcelaField(parcelaTotalRaw);

    const parcelaNumero =
      parsedNumero.numero ??
      parsedTotal.numero ??
      (() => {
        const parsed = Number(parcelaNumeroRaw);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      })();
    const parcelaTotal =
      parsedNumero.total ??
      parsedTotal.total ??
      (() => {
        const parsed = Number(parcelaTotalRaw);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      })();

    lines.push({
      data: iso,
      descricao,
      valor,
      parcela_numero: Number.isFinite(parcelaNumero ?? NaN) ? parcelaNumero : null,
      parcela_total: Number.isFinite(parcelaTotal ?? NaN) ? parcelaTotal : null,
      final_cartao: (row[map.final_cartao] ?? "").trim(),
      observacao: (row[map.observacao] ?? "").trim()
    });
  }

  return lines;
}

type ImportPreview = {
  cartao: CartaoCredito;
  total: number;
  novos: number;
  conciliados: number;
  filtradosPorFinalCartao?: number;
  preview: Array<
    ImportLine & {
      tx_key: string;
      status: "ja_lancado" | "novo";
      movimentoId?: string;
    }
  >;
};

type ImportPreviewItem = ImportLine & {
  tx_key: string;
  status: "ja_lancado" | "novo";
  movimentoId?: string;
};

type Totalizadores = {
  mes: string;
  banco: BancoCartao;
  porAtribuicao: {
    WALKER: number;
    AMBOS: number;
    DEA: number;
  };
  pendentes: number;
  parcelasDoMes: number;
  totalParceladoEmAberto: number;
  totalParceladoEmAbertoProjetado: number;
};

const bancos: BancoCartao[] = ["C6", "BB", "OUTRO"];
const atribuicoes: Atribuicao[] = ["WALKER", "AMBOS", "DEA", "AMBOS_I"];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureUuid(value?: string) {
  if (value && UUID_PATTERN.test(value)) return value;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function readCachedCards(): CartaoCredito[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_CARTOES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CartaoCredito[];
  } catch {
    return [];
  }
}

function writeCachedCards(items: CartaoCredito[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CARTOES_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function readCachedMovimentos(): CartaoMovimentoComAlocacoes[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MOBILE_OFFLINE_CARTAO_MOVIMENTOS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CartaoMovimentoComAlocacoes[];
  } catch {
    return [];
  }
}

function writeCachedMovimentos(items: CartaoMovimentoComAlocacoes[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MOBILE_OFFLINE_CARTAO_MOVIMENTOS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Ignora falhas de persistencia local.
  }
}

function normalizeTxDescricao(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeCardFinal(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed.toUpperCase();
}

function filterLinesByCardFinalLocal(lines: ImportLine[], cardFinal: string): { lines: ImportLine[]; ignored: number } {
  const target = normalizeCardFinal(cardFinal);
  if (!target) return { lines, ignored: 0 };
  const filtered = lines.filter((line) => {
    const lineFinal = normalizeCardFinal(line.final_cartao ?? "");
    if (!lineFinal) return true;
    return lineFinal === target;
  });
  return { lines: filtered, ignored: lines.length - filtered.length };
}

function normalizeForLooseMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function descriptionsCompatible(left: string, right: string): boolean {
  const a = normalizeForLooseMatch(left);
  const b = normalizeForLooseMatch(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;

  const tokensA = a.split(" ").filter((item) => item.length >= 3);
  const tokensB = new Set(b.split(" ").filter((item) => item.length >= 3));
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
    if (overlap >= 2) return true;
  }
  return false;
}

function findLooseImportMatch(params: {
  line: ImportLine;
  existing: CartaoMovimentoComAlocacoes[];
  matchedIds: Set<string>;
}): CartaoMovimentoComAlocacoes | null {
  const candidates = params.existing.filter((movimento) => {
    if (params.matchedIds.has(movimento.id)) return false;
    if (movimento.data !== params.line.data) return false;
    if (Math.abs(movimento.valor - params.line.valor) > 0.01) return false;
    return descriptionsCompatible(params.line.descricao, movimento.descricao);
  });
  if (candidates.length === 1) return candidates[0];
  return null;
}

function reconcileImportLinesLocal(params: {
  cartao: CartaoCredito;
  lines: ImportLine[];
  existing: CartaoMovimentoComAlocacoes[];
}): {
  preview: ImportPreviewItem[];
  total: number;
  novos: number;
  conciliados: number;
} {
  const existingByKey = new Map<string, CartaoMovimentoComAlocacoes[]>();
  const existingByCard: CartaoMovimentoComAlocacoes[] = [];
  for (const movimento of params.existing) {
    if (movimento.cartao_id !== params.cartao.id) continue;
    existingByCard.push(movimento);
    if (!movimento.tx_key) continue;
    const list = existingByKey.get(movimento.tx_key) ?? [];
    list.push(movimento);
    existingByKey.set(movimento.tx_key, list);
  }

  const matchedIds = new Set<string>();
  const preview = params.lines.map((line) => {
    const tx_key = buildCartaoTxKeyLocal({
      cartao_id: params.cartao.id,
      data: line.data,
      descricao: line.descricao,
      valor: line.valor,
      parcela_total: line.parcela_total,
      parcela_numero: line.parcela_numero
    });
    const exactCandidates = existingByKey.get(tx_key) ?? [];
    const exact = exactCandidates.find((item) => !matchedIds.has(item.id)) ?? null;
    const loose = exact
      ? null
      : findLooseImportMatch({
          line,
          existing: existingByCard,
          matchedIds
        });
    const current = exact ?? loose;
    if (current) matchedIds.add(current.id);
    return {
      ...line,
      tx_key,
      status: current ? "ja_lancado" : "novo",
      movimentoId: current?.id
    } satisfies ImportPreviewItem;
  });

  const total = preview.length;
  const conciliados = preview.filter((item) => item.status === "ja_lancado").length;
  const novos = total - conciliados;
  return { preview, total, novos, conciliados };
}

function defaultAtribuicaoForCardLocal(cartao: CartaoCredito | null): Atribuicao {
  if (!cartao) return "AMBOS";
  if (cartao.titular === "DEA" || cartao.titular === "JULIA") return "AMBOS";
  return cartao.padrao_atribuicao;
}

function ymFromDateLocal(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  return currentMonth();
}

function buildCartaoTxKeyLocal(input: {
  cartao_id: string;
  data: string;
  descricao: string;
  valor: number;
  parcela_total?: number | null;
  parcela_numero?: number | null;
}) {
  const total = input.parcela_total && input.parcela_total > 1 ? input.parcela_total : 1;
  const numero = input.parcela_numero && input.parcela_numero > 0 ? input.parcela_numero : 1;
  return [
    input.cartao_id,
    input.data,
    normalizeTxDescricao(input.descricao),
    input.valor.toFixed(2),
    `${numero}/${total}`
  ].join("|");
}

function hydrateMovimentosWithCards(
  movimentos: CartaoMovimentoComAlocacoes[],
  cards: CartaoCredito[]
): CartaoMovimentoComAlocacoes[] {
  const cardById = new Map(cards.map((item) => [item.id, item]));
  return movimentos
    .map((item) => ({
      ...item,
      cartao: cardById.get(item.cartao_id) ?? null
    }))
    .sort((a, b) => {
      if (a.data !== b.data) return b.data.localeCompare(a.data);
      return b.created_at.localeCompare(a.created_at);
    });
}

function isYmOrEarlier(left: string, right: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(left) || !/^\d{4}-\d{2}$/.test(right)) return false;
  return left <= right;
}

function monthDiffYm(start: string, end: string): number {
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return 0;
  const [startYearRaw, startMonthRaw] = start.split("-");
  const [endYearRaw, endMonthRaw] = end.split("-");
  const startYear = Number(startYearRaw);
  const startMonth = Number(startMonthRaw);
  const endYear = Number(endYearRaw);
  const endMonth = Number(endMonthRaw);
  if (!Number.isInteger(startYear) || !Number.isInteger(startMonth)) return 0;
  if (!Number.isInteger(endYear) || !Number.isInteger(endMonth)) return 0;
  return (endYear - startYear) * 12 + (endMonth - startMonth);
}

function compraParceladaKeyLocal(movimento: CartaoMovimentoComAlocacoes): string {
  const tx = movimento.tx_key?.trim() ?? "";
  if (tx) {
    const base = tx.replace(/\|\d+\/\d+$/, "");
    if (base !== tx) return base;
  }

  return [
    movimento.cartao_id,
    movimento.data,
    normalizeTxDescricao(movimento.descricao),
    movimento.valor.toFixed(2),
    String(movimento.parcela_total ?? "")
  ].join("|");
}

function computeTotalizadoresLocal(params: {
  movimentos: CartaoMovimentoComAlocacoes[];
  mes: string;
  banco: BancoCartao;
  cartaoId?: string | null;
}): Totalizadores {
  const total = {
    WALKER: 0,
    AMBOS: 0,
    DEA: 0
  };

  let pendentes = 0;
  let parcelasDoMes = 0;
  const latestParcelaByCompra = new Map<string, CartaoMovimentoComAlocacoes>();

  for (const movimento of params.movimentos) {
    if (!movimento.cartao || movimento.cartao.banco !== params.banco) continue;
    if (params.cartaoId && movimento.cartao_id !== params.cartaoId) continue;

    const parcelaTotal = movimento.parcela_total ?? null;
    const ehParcelado = Boolean(parcelaTotal && parcelaTotal > 1);

    if (movimento.mes_ref === params.mes && ehParcelado) {
      parcelasDoMes += movimento.valor;
    }

    if (ehParcelado && isYmOrEarlier(movimento.mes_ref, params.mes)) {
      const key = compraParceladaKeyLocal(movimento);
      const existing = latestParcelaByCompra.get(key);
      if (!existing) {
        latestParcelaByCompra.set(key, movimento);
      } else {
        const existingNumero = existing.parcela_numero ?? 1;
        const currentNumero = movimento.parcela_numero ?? 1;
        const shouldReplace =
          currentNumero > existingNumero ||
          (currentNumero === existingNumero && movimento.mes_ref > existing.mes_ref) ||
          (currentNumero === existingNumero &&
            movimento.mes_ref === existing.mes_ref &&
            movimento.updated_at > existing.updated_at);
        if (shouldReplace) {
          latestParcelaByCompra.set(key, movimento);
        }
      }
    }

    if (movimento.mes_ref !== params.mes) continue;

    if (movimento.status !== "conciliado") {
      pendentes += 1;
      continue;
    }

    for (const alocacao of movimento.alocacoes) {
      if (alocacao.atribuicao === "WALKER") total.WALKER += alocacao.valor;
      if (alocacao.atribuicao === "AMBOS") total.AMBOS += alocacao.valor;
      if (alocacao.atribuicao === "DEA") total.DEA += alocacao.valor;
    }
  }

  let totalParceladoEmAberto = 0;
  let totalParceladoEmAbertoProjetado = 0;
  for (const movimento of latestParcelaByCompra.values()) {
    const parcelaTotal = movimento.parcela_total ?? 1;
    const parcelaNumero = movimento.parcela_numero ?? 1;
    const parcelaNumeroAtual = Math.min(Math.max(parcelaNumero, 1), parcelaTotal);
    const restantesRealizados = Math.max(parcelaTotal - parcelaNumeroAtual, 0);
    totalParceladoEmAberto += movimento.valor * restantesRealizados;

    const avancarMeses = Math.max(monthDiffYm(movimento.mes_ref, params.mes), 0);
    const parcelaNumeroProjetada = Math.min(parcelaNumeroAtual + avancarMeses, parcelaTotal);
    const restantesProjetados = Math.max(parcelaTotal - parcelaNumeroProjetada, 0);
    totalParceladoEmAbertoProjetado += movimento.valor * restantesProjetados;
  }

  return {
    mes: params.mes,
    banco: params.banco,
    porAtribuicao: {
      WALKER: Number(total.WALKER.toFixed(2)),
      AMBOS: Number(total.AMBOS.toFixed(2)),
      DEA: Number(total.DEA.toFixed(2))
    },
    pendentes,
    parcelasDoMes: Number(parcelasDoMes.toFixed(2)),
    totalParceladoEmAberto: Number(totalParceladoEmAberto.toFixed(2)),
    totalParceladoEmAbertoProjetado: Number(totalParceladoEmAbertoProjetado.toFixed(2))
  };
}

export default function CartoesPage() {
  const { mobileOfflineMode } = useFeatureFlags();

  const buildEmptyCardForm = () => ({
    id: "",
    nome: "",
    banco: "C6" as BancoCartao,
    titular: "WALKER" as CartaoCredito["titular"],
    final_cartao: "",
    padrao_atribuicao: "AMBOS" as Atribuicao,
    ativo: true
  });

  const [month, setMonth] = useState(currentMonth());
  const [bank, setBank] = useState<BancoCartao>("C6");
  const [cards, setCards] = useState<CartaoCredito[]>([]);
  const [movimentos, setMovimentos] = useState<CartaoMovimentoComAlocacoes[]>([]);
  const [totalizadores, setTotalizadores] = useState<Totalizadores | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingMove, setSavingMove] = useState(false);
  const [savingEditMove, setSavingEditMove] = useState(false);
  const [deletingMoveId, setDeletingMoveId] = useState("");
  const [savingTotals, setSavingTotals] = useState(false);
  const [classifyingBulk, setClassifyingBulk] = useState(false);

  const [cardForm, setCardForm] = useState(buildEmptyCardForm);
  const [showCardModal, setShowCardModal] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [expensesExpanded, setExpensesExpanded] = useState(false);
  const [descriptionFilter, setDescriptionFilter] = useState("");

  const [moveForm, setMoveForm] = useState({
    cartao_id: "",
    data: todayIso(),
    descricao: "",
    valor: "",
    parcela_numero: "",
    parcela_total: "",
    observacao: "",
    atribuicao: "WALKER" as Atribuicao,
    splitMode: "none" as SplitMode,
    splitValor: ""
  });

  const [editMoveForm, setEditMoveForm] = useState({
    id: "",
    cartao_id: "",
    data: todayIso(),
    descricao: "",
    valor: "",
    parcela_numero: "",
    parcela_total: "",
    observacao: "",
    atribuicao: "WALKER" as Atribuicao,
    splitMode: "none" as SplitMode,
    splitValor: "",
    origem: "manual" as "manual" | "fatura"
  });

  const [importCardId, setImportCardId] = useState("");
  const [importMesRef, setImportMesRef] = useState(currentMonth());
  const [importText, setImportText] = useState("");
  const [importCsvLines, setImportCsvLines] = useState<ImportLine[] | null>(null);
  const [importCsvName, setImportCsvName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [runningImport, setRunningImport] = useState(false);

  const cardById = useMemo(() => new Map(cards.map((item) => [item.id, item])), [cards]);
  const selectedCard = useMemo(
    () => (selectedCardId ? cardById.get(selectedCardId) ?? null : null),
    [cardById, selectedCardId]
  );
  const defaultCard = useMemo(() => cards.find((item) => item.ativo) ?? cards[0] ?? null, [cards]);
  const pending = useMemo(
    () =>
      movimentos.filter(
        (item) => item.status === "pendente" && (!selectedCardId || item.cartao_id === selectedCardId)
      ),
    [movimentos, selectedCardId]
  );
  const lancados = useMemo(
    () =>
      movimentos.filter(
        (item) => item.status === "conciliado" && (!selectedCardId || item.cartao_id === selectedCardId)
      ),
    [movimentos, selectedCardId]
  );
  const normalizedDescriptionFilter = useMemo(
    () => normalizeSearchText(descriptionFilter),
    [descriptionFilter]
  );
  const pendingFiltered = useMemo(() => {
    if (!normalizedDescriptionFilter) return pending;
    return pending.filter((item) =>
      normalizeSearchText(item.descricao).includes(normalizedDescriptionFilter)
    );
  }, [pending, normalizedDescriptionFilter]);
  const lancadosFiltered = useMemo(() => {
    if (!normalizedDescriptionFilter) return lancados;
    return lancados.filter((item) =>
      normalizeSearchText(item.descricao).includes(normalizedDescriptionFilter)
    );
  }, [lancados, normalizedDescriptionFilter]);
  const totalTodosCartoes = useMemo(
    () => lancados.reduce((sum, item) => sum + item.valor, 0),
    [lancados]
  );
  const despesasCountDisplay = pendingFiltered.length + lancadosFiltered.length;
  const totalizadoresView: Totalizadores = totalizadores ?? {
    mes: month,
    banco: bank,
    porAtribuicao: { WALKER: 0, AMBOS: 0, DEA: 0 },
    pendentes: 0,
    parcelasDoMes: 0,
    totalParceladoEmAberto: 0,
    totalParceladoEmAbertoProjetado: 0
  };
  const editingMovement = useMemo(
    () => movimentos.find((item) => item.id === editMoveForm.id) ?? null,
    [movimentos, editMoveForm.id]
  );

  const applySnapshot = useCallback(
    (
      nextCards: CartaoCredito[],
      nextMovimentosRaw: CartaoMovimentoComAlocacoes[],
      options?: { persist?: boolean }
    ) => {
      const hydratedMovimentos = hydrateMovimentosWithCards(nextMovimentosRaw, nextCards);
      setCards(nextCards);
      setMovimentos(hydratedMovimentos);
      if (options?.persist && mobileOfflineMode) {
        writeCachedCards(nextCards);
        writeCachedMovimentos(hydratedMovimentos);
      }

      const defaultCardRow = nextCards.find((item) => item.ativo) ?? nextCards[0] ?? null;
      const selectedStillExists = selectedCardId
        ? nextCards.some((item) => item.id === selectedCardId)
        : false;

      if (selectedCardId && !selectedStillExists) {
        setSelectedCardId(null);
      }

      const effectiveCardId = selectedStillExists ? selectedCardId ?? "" : defaultCardRow?.id ?? "";
      const effectiveCard = nextCards.find((item) => item.id === effectiveCardId) ?? defaultCardRow;
      setMoveForm((prev) => ({
        ...prev,
        cartao_id: effectiveCardId,
        atribuicao: effectiveCard?.padrao_atribuicao ?? prev.atribuicao
      }));
      setImportCardId((prev) => prev || nextCards[0]?.id || "");

      const localTotalizadores = computeTotalizadoresLocal({
        movimentos: hydratedMovimentos,
        mes: month,
        banco: bank,
        cartaoId: selectedStillExists ? selectedCardId : null
      });
      setTotalizadores(localTotalizadores);
    },
    [bank, month, mobileOfflineMode, selectedCardId]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const cachedCards = mobileOfflineMode ? readCachedCards() : [];
    const cachedMovimentos = mobileOfflineMode ? readCachedMovimentos() : [];
    if (mobileOfflineMode && (cachedCards.length > 0 || cachedMovimentos.length > 0)) {
      applySnapshot(cachedCards, cachedMovimentos);
    }

    try {
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      if (mobileOfflineMode && !online) {
        if (cachedCards.length === 0 && cachedMovimentos.length === 0) {
          throw new Error("Sem dados locais de cartões. Conecte uma vez para carregar a base inicial.");
        }
        return;
      }

      const totalizadoresParams = new URLSearchParams({
        mes: month,
        banco: bank
      });
      if (selectedCardId) {
        totalizadoresParams.set("cartaoId", selectedCardId);
      }

      const [cardsRes, movRes, totalizadoresRes] = await Promise.all([
        fetch("/api/cartoes/cards"),
        fetch(`/api/cartoes/movimentos?mes=${month}`),
        fetch(`/api/cartoes/totalizadores?${totalizadoresParams.toString()}`)
      ]);

      const cardsPayload = await cardsRes.json();
      if (!cardsRes.ok) throw new Error(cardsPayload.message ?? "Erro ao carregar cartoes");
      const rows = cardsPayload.data ?? [];

      const movPayload = await movRes.json();
      if (!movRes.ok) throw new Error(movPayload.message ?? "Erro ao carregar movimentos");
      const remoteMovimentos = (movPayload.data ?? []) as CartaoMovimentoComAlocacoes[];
      applySnapshot(rows as CartaoCredito[], remoteMovimentos, { persist: mobileOfflineMode });

      const totalizadoresPayload = await totalizadoresRes.json();
      if (!totalizadoresRes.ok && !mobileOfflineMode) {
        throw new Error(totalizadoresPayload.message ?? "Erro ao carregar totalizadores");
      }
      if (totalizadoresRes.ok) {
        setTotalizadores((totalizadoresPayload.data ?? null) as Totalizadores | null);
      }
    } catch (err) {
      if (!mobileOfflineMode || (cachedCards.length === 0 && cachedMovimentos.length === 0)) {
        setError(err instanceof Error ? err.message : "Erro inesperado ao carregar modulo de cartoes");
      }
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, bank, mobileOfflineMode, month, selectedCardId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setImportMesRef(month);
  }, [month]);

  useEffect(() => {
    if (selectedCardId) {
      setExpensesExpanded(true);
    }
  }, [selectedCardId]);

  function parseImportLines(text: string): ImportLine[] {
    const rows = text
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((raw) => {
        const delimiter = raw.includes(";") ? ";" : ",";
        return raw.split(delimiter).map((item) => item.trim());
      });
    return parseImportRows(rows);
  }

  function resolveImportLines() {
    if (importCsvLines?.length) return importCsvLines;
    return parseImportLines(importText);
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setMessage("");

    try {
      const raw = await file.text();
      const delimiter = detectDelimiter(raw);
      const rows = parseDelimitedRows(raw, delimiter);
      const lines = parseImportRows(rows);
      if (!lines.length) {
        throw new Error("Nao foi possivel extrair linhas validas do CSV.");
      }
      setImportCsvLines(lines);
      setImportCsvName(file.name);
      setPreview(null);
      setMessage(`CSV carregado: ${file.name} (${lines.length} linha(s) valida(s)).`);
    } catch (err) {
      setImportCsvLines(null);
      setImportCsvName("");
      setError(err instanceof Error ? err.message : "Erro ao processar CSV");
    } finally {
      event.target.value = "";
    }
  }

  function clearCsvUpload() {
    setImportCsvLines(null);
    setImportCsvName("");
    setPreview(null);
  }

  function resetEditMoveForm() {
    setEditMoveForm({
      id: "",
      cartao_id: "",
      data: todayIso(),
      descricao: "",
      valor: "",
      parcela_numero: "",
      parcela_total: "",
      observacao: "",
      atribuicao: "WALKER",
      splitMode: "none",
      splitValor: "",
      origem: "manual"
    });
  }

  function startEditMovement(movimento: CartaoMovimentoComAlocacoes) {
    const dea = movimento.alocacoes.find((item) => item.atribuicao === "DEA");
    const walker = movimento.alocacoes.find((item) => item.atribuicao === "WALKER");
    const ambos = movimento.alocacoes.find((item) => item.atribuicao === "AMBOS");
    const splitDeaAmbos = Boolean(dea && ambos && movimento.alocacoes.length === 2);
    const splitWalkerAmbos = Boolean(walker && ambos && movimento.alocacoes.length === 2);
    const splitMode: SplitMode = splitDeaAmbos ? "DEA_AMBOS" : splitWalkerAmbos ? "WALKER_AMBOS" : "none";
    const atribuicaoSingle = splitMode !== "none"
      ? "AMBOS"
      : (movimento.alocacoes[0]?.atribuicao ?? movimento.cartao?.padrao_atribuicao ?? "AMBOS");

    setEditMoveForm({
      id: movimento.id,
      cartao_id: movimento.cartao_id,
      data: movimento.data,
      descricao: movimento.descricao,
      valor: movimento.valor.toFixed(2),
      parcela_numero: movimento.parcela_numero ? String(movimento.parcela_numero) : "",
      parcela_total: movimento.parcela_total ? String(movimento.parcela_total) : "",
      observacao: movimento.observacao,
      atribuicao: atribuicaoSingle,
      splitMode,
      splitValor:
        splitMode === "DEA_AMBOS" && dea
          ? dea.valor.toFixed(2)
          : splitMode === "WALKER_AMBOS" && walker
            ? walker.valor.toFixed(2)
            : "",
      origem: movimento.origem
    });
    setError("");
    setMessage("");
  }

  function cancelEditMovement() {
    resetEditMoveForm();
    setError("");
    setMessage("");
  }

  function clearCardFilter() {
    setSelectedCardId(null);
    setExpensesExpanded(false);
    if (defaultCard) {
      setMoveForm((prev) => ({
        ...prev,
        cartao_id: defaultCard.id,
        atribuicao: defaultCard.padrao_atribuicao
      }));
    }
  }

  function toggleCardFilter(card: CartaoCredito) {
    if (selectedCardId === card.id) {
      clearCardFilter();
      return;
    }

    setBank(card.banco);
    setSelectedCardId(card.id);
    setExpensesExpanded(true);
    setMoveForm((prev) => ({
      ...prev,
      cartao_id: card.id,
      atribuicao: card.padrao_atribuicao
    }));
  }

  function startEditCard(card: CartaoCredito) {
    setCardForm({
      id: card.id,
      nome: card.nome,
      banco: card.banco,
      titular: card.titular,
      final_cartao: card.final_cartao ?? "",
      padrao_atribuicao: card.padrao_atribuicao,
      ativo: card.ativo
    });
    setShowCardModal(true);
    setMessage("");
    setError("");
  }

  function cancelEditCard() {
    setCardForm(buildEmptyCardForm());
    setShowCardModal(false);
    setMessage("");
    setError("");
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const editing = Boolean(cardForm.id);
      if (mobileOfflineMode) {
        const now = new Date().toISOString();
        const current = editing ? cards.find((item) => item.id === cardForm.id) ?? null : null;
        const localCard: CartaoCredito = {
          id: ensureUuid(cardForm.id),
          nome: cardForm.nome.trim(),
          banco: cardForm.banco,
          titular: cardForm.titular,
          final_cartao: cardForm.final_cartao.trim(),
          padrao_atribuicao: cardForm.padrao_atribuicao,
          ativo: cardForm.ativo,
          created_at: current?.created_at ?? now,
          updated_at: now
        };
        const nextCards = editing
          ? cards.map((item) => (item.id === cardForm.id ? localCard : item))
          : [localCard, ...cards];
        applySnapshot(nextCards, movimentos, { persist: true });
        await queueCartaoUpsertLocal({
          id: localCard.id,
          nome: localCard.nome,
          banco: localCard.banco,
          titular: localCard.titular,
          final_cartao: localCard.final_cartao,
          padrao_atribuicao: localCard.padrao_atribuicao,
          ativo: localCard.ativo,
          created_at: localCard.created_at,
          updated_at: localCard.updated_at
        });
        setMessage(editing ? "Cartao atualizado localmente. Use Sync para enviar." : "Cartao salvo localmente. Use Sync para enviar.");
        setCardForm(buildEmptyCardForm());
        setShowCardModal(false);
        return;
      }

      const requestBody = {
        ...cardForm,
        id: editing ? cardForm.id : undefined
      };
      const response = await fetch("/api/cartoes/cards", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao salvar cartao");
      setMessage(editing ? "Cartao atualizado." : "Cartao salvo.");
      setCardForm(buildEmptyCardForm());
      setShowCardModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar cartao");
    }
  }

  async function saveManualMovement(event: FormEvent) {
    event.preventDefault();
    setSavingMove(true);
    setError("");
    setMessage("");
    try {
      if (!moveForm.cartao_id) {
        throw new Error("Selecione um cartao");
      }
      const valor = parseMoney(moveForm.valor);
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new Error("Valor invalido");
      }

      let alocacoes: Array<{ atribuicao: Atribuicao; valor: number }> = [];
      if (moveForm.splitMode !== "none") {
        const splitValor = parseMoney(moveForm.splitValor);
        if (!Number.isFinite(splitValor) || splitValor <= 0 || splitValor >= valor) {
          throw new Error(
            moveForm.splitMode === "DEA_AMBOS"
              ? "No split DEA/AMBOS, informe um valor DEA valido menor que o total"
              : "No split WALKER/AMBOS, informe um valor WALKER valido menor que o total"
          );
        }
        const valorAmbos = Number((valor - splitValor).toFixed(2));
        alocacoes =
          moveForm.splitMode === "DEA_AMBOS"
            ? [
                { atribuicao: "DEA", valor: Number(splitValor.toFixed(2)) },
                { atribuicao: "AMBOS", valor: valorAmbos }
              ]
            : [
                { atribuicao: "WALKER", valor: Number(splitValor.toFixed(2)) },
                { atribuicao: "AMBOS", valor: valorAmbos }
              ];
      } else {
        alocacoes = [{ atribuicao: moveForm.atribuicao, valor: Number(valor.toFixed(2)) }];
      }

      const payload = {
        cartao_id: moveForm.cartao_id,
        data: moveForm.data,
        descricao: moveForm.descricao,
        valor,
        parcela_numero: moveForm.parcela_numero ? Number(moveForm.parcela_numero) : null,
        parcela_total: moveForm.parcela_total ? Number(moveForm.parcela_total) : null,
        origem: "manual" as const,
        status: "conciliado" as const,
        mes_ref: month,
        observacao: moveForm.observacao,
        alocacoes
      };

      if (mobileOfflineMode) {
        const now = new Date().toISOString();
        const id = ensureUuid();
        const tx_key = buildCartaoTxKeyLocal({
          cartao_id: payload.cartao_id,
          data: payload.data,
          descricao: payload.descricao,
          valor: payload.valor,
          parcela_total: payload.parcela_total,
          parcela_numero: payload.parcela_numero
        });
        const localMovement: CartaoMovimentoComAlocacoes = {
          id,
          cartao_id: payload.cartao_id,
          data: payload.data,
          descricao: payload.descricao.trim(),
          valor: Number(payload.valor.toFixed(2)),
          parcela_total: payload.parcela_total,
          parcela_numero: payload.parcela_numero,
          tx_key,
          origem: payload.origem,
          status: payload.status,
          mes_ref: payload.mes_ref,
          observacao: payload.observacao.trim(),
          created_at: now,
          updated_at: now,
          cartao: cardById.get(payload.cartao_id) ?? null,
          alocacoes: payload.alocacoes.map((item) => ({
            id: ensureUuid(),
            movimento_id: id,
            atribuicao: item.atribuicao,
            valor: Number(item.valor.toFixed(2)),
            created_at: now,
            updated_at: now
          }))
        };

        const nextMovimentos = [localMovement, ...movimentos];
        applySnapshot(cards, nextMovimentos, { persist: true });
        await queueCartaoMovimentoUpsertLocal({
          ...localMovement,
          id: localMovement.id,
          alocacoes: localMovement.alocacoes.map((item) => ({
            id: item.id,
            atribuicao: item.atribuicao,
            valor: item.valor,
            created_at: item.created_at,
            updated_at: item.updated_at
          }))
        });

        setMessage("Compra de cartao salva localmente. Use Sync para enviar.");
        setMoveForm((prev) => ({
          ...prev,
          descricao: "",
          valor: "",
          parcela_numero: "",
          parcela_total: "",
          observacao: "",
          splitMode: "none",
          splitValor: ""
        }));
        return;
      }

      const response = await fetch("/api/cartoes/movimentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message ?? "Erro ao salvar movimento");
      }

      setMessage("Compra de cartao lancada com sucesso.");
      setMoveForm((prev) => ({
        ...prev,
        descricao: "",
        valor: "",
        parcela_numero: "",
        parcela_total: "",
        observacao: "",
        splitMode: "none",
        splitValor: ""
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar movimento");
    } finally {
      setSavingMove(false);
    }
  }

  async function saveEditedMovement(event: FormEvent) {
    event.preventDefault();
    setSavingEditMove(true);
    setError("");
    setMessage("");

    try {
      if (!editMoveForm.id) throw new Error("Selecione um movimento para editar");
      if (!editMoveForm.cartao_id) throw new Error("Selecione um cartao");
      const valor = parseMoney(editMoveForm.valor);
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new Error("Valor invalido");
      }

      let alocacoes: Array<{ atribuicao: Atribuicao; valor: number }>;
      if (editMoveForm.splitMode !== "none") {
        const splitValor = parseMoney(editMoveForm.splitValor);
        if (!Number.isFinite(splitValor) || splitValor <= 0 || splitValor >= valor) {
          throw new Error(
            editMoveForm.splitMode === "DEA_AMBOS"
              ? "No split DEA/AMBOS, informe um valor DEA valido menor que o total"
              : "No split WALKER/AMBOS, informe um valor WALKER valido menor que o total"
          );
        }
        const valorAmbos = Number((valor - splitValor).toFixed(2));
        alocacoes =
          editMoveForm.splitMode === "DEA_AMBOS"
            ? [
                { atribuicao: "DEA", valor: Number(splitValor.toFixed(2)) },
                { atribuicao: "AMBOS", valor: valorAmbos }
              ]
            : [
                { atribuicao: "WALKER", valor: Number(splitValor.toFixed(2)) },
                { atribuicao: "AMBOS", valor: valorAmbos }
              ];
      } else {
        alocacoes = [{ atribuicao: editMoveForm.atribuicao, valor: Number(valor.toFixed(2)) }];
      }

      if (mobileOfflineMode) {
        const current = movimentos.find((item) => item.id === editMoveForm.id) ?? null;
        if (!current) throw new Error("Movimento nao encontrado localmente");
        const now = new Date().toISOString();
        const tx_key = buildCartaoTxKeyLocal({
          cartao_id: editMoveForm.cartao_id,
          data: editMoveForm.data,
          descricao: editMoveForm.descricao,
          valor,
          parcela_total: editMoveForm.parcela_total ? Number(editMoveForm.parcela_total) : null,
          parcela_numero: editMoveForm.parcela_numero ? Number(editMoveForm.parcela_numero) : null
        });
        const updatedMovement: CartaoMovimentoComAlocacoes = {
          ...current,
          cartao_id: editMoveForm.cartao_id,
          data: editMoveForm.data,
          descricao: editMoveForm.descricao.trim(),
          valor: Number(valor.toFixed(2)),
          parcela_numero: editMoveForm.parcela_numero ? Number(editMoveForm.parcela_numero) : null,
          parcela_total: editMoveForm.parcela_total ? Number(editMoveForm.parcela_total) : null,
          origem: editMoveForm.origem,
          status: "conciliado",
          observacao: editMoveForm.observacao.trim(),
          tx_key,
          updated_at: now,
          cartao: cardById.get(editMoveForm.cartao_id) ?? null,
          alocacoes: alocacoes.map((item, index) => ({
            id: current.alocacoes[index]?.id ?? ensureUuid(),
            movimento_id: current.id,
            atribuicao: item.atribuicao,
            valor: Number(item.valor.toFixed(2)),
            created_at: current.alocacoes[index]?.created_at ?? now,
            updated_at: now
          }))
        };
        const nextMovimentos = movimentos.map((item) =>
          item.id === updatedMovement.id ? updatedMovement : item
        );
        applySnapshot(cards, nextMovimentos, { persist: true });
        await queueCartaoMovimentoUpsertLocal({
          ...updatedMovement,
          id: updatedMovement.id,
          alocacoes: updatedMovement.alocacoes.map((item) => ({
            id: item.id,
            atribuicao: item.atribuicao,
            valor: item.valor,
            created_at: item.created_at,
            updated_at: item.updated_at
          }))
        });
        setMessage("Gasto atualizado localmente. Use Sync para enviar.");
        resetEditMoveForm();
        return;
      }

      const response = await fetch("/api/cartoes/movimentos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editMoveForm.id,
          cartao_id: editMoveForm.cartao_id,
          data: editMoveForm.data,
          descricao: editMoveForm.descricao,
          valor,
          parcela_numero: editMoveForm.parcela_numero ? Number(editMoveForm.parcela_numero) : null,
          parcela_total: editMoveForm.parcela_total ? Number(editMoveForm.parcela_total) : null,
          origem: editMoveForm.origem,
          status: "conciliado",
          observacao: editMoveForm.observacao,
          alocacoes
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao atualizar movimento");

      setMessage("Gasto atualizado.");
      resetEditMoveForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar movimento");
    } finally {
      setSavingEditMove(false);
    }
  }

  async function deleteMovement(movimento: CartaoMovimentoComAlocacoes) {
    const confirmed = confirm(`Excluir gasto "${movimento.descricao}" de R$ ${movimento.valor.toFixed(2)}?`);
    if (!confirmed) return;

    setDeletingMoveId(movimento.id);
    setError("");
    setMessage("");
    try {
      if (mobileOfflineMode) {
        const nextMovimentos = movimentos.filter((item) => item.id !== movimento.id);
        applySnapshot(cards, nextMovimentos, { persist: true });
        await queueCartaoMovimentoDeleteLocal(movimento.id);
        if (editMoveForm.id === movimento.id) {
          resetEditMoveForm();
        }
        setMessage("Gasto excluido localmente. Use Sync para enviar.");
        return;
      }

      const response = await fetch(`/api/cartoes/movimentos?id=${movimento.id}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao excluir movimento");

      if (editMoveForm.id === movimento.id) {
        resetEditMoveForm();
      }
      setMessage("Gasto excluido.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao excluir movimento");
    } finally {
      setDeletingMoveId("");
    }
  }

  async function updateMovementClassification(
    movimento: CartaoMovimentoComAlocacoes,
    alocacoes: Array<{ atribuicao: Atribuicao; valor: number }>
  ) {
    if (mobileOfflineMode) {
      const now = new Date().toISOString();
      const updatedMovement: CartaoMovimentoComAlocacoes = {
        ...movimento,
        status: "conciliado",
        updated_at: now,
        alocacoes: alocacoes.map((item, index) => ({
          id: movimento.alocacoes[index]?.id ?? ensureUuid(),
          movimento_id: movimento.id,
          atribuicao: item.atribuicao,
          valor: Number(item.valor.toFixed(2)),
          created_at: movimento.alocacoes[index]?.created_at ?? now,
          updated_at: now
        }))
      };
      const nextMovimentos = movimentos.map((item) =>
        item.id === movimento.id ? updatedMovement : item
      );
      applySnapshot(cards, nextMovimentos, { persist: true });
      await queueCartaoMovimentoUpsertLocal({
        ...updatedMovement,
        id: updatedMovement.id,
        alocacoes: updatedMovement.alocacoes.map((item) => ({
          id: item.id,
          atribuicao: item.atribuicao,
          valor: item.valor,
          created_at: item.created_at,
          updated_at: item.updated_at
        }))
      });
      return;
    }

    const response = await fetch("/api/cartoes/movimentos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: movimento.id,
        cartao_id: movimento.cartao_id,
        data: movimento.data,
        descricao: movimento.descricao,
        valor: movimento.valor,
        parcela_total: movimento.parcela_total,
        parcela_numero: movimento.parcela_numero,
        origem: movimento.origem,
        status: "conciliado",
        observacao: movimento.observacao,
        alocacoes
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message ?? "Erro ao classificar movimento");
    }
  }

  async function classifyMovement(
    movimento: CartaoMovimentoComAlocacoes,
    alocacoes: Array<{ atribuicao: Atribuicao; valor: number }>
  ) {
    setError("");
    setMessage("");
    try {
      await updateMovementClassification(movimento, alocacoes);
      if (mobileOfflineMode) {
        setMessage(`Compra "${movimento.descricao}" classificada localmente. Use Sync para enviar.`);
      } else {
        setMessage(`Compra "${movimento.descricao}" classificada.`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao classificar movimento");
    }
  }

  async function splitDeaAmbos(movimento: CartaoMovimentoComAlocacoes) {
    const suggestion = (movimento.valor / 2).toFixed(2);
    const input = prompt(`Valor da parte DEA para "${movimento.descricao}"`, suggestion);
    if (!input) return;
    const valorDea = parseMoney(input);
    if (!Number.isFinite(valorDea) || valorDea <= 0 || valorDea >= movimento.valor) {
      setError("Valor DEA invalido para split.");
      return;
    }
    const valorAmbos = Number((movimento.valor - valorDea).toFixed(2));
    await classifyMovement(movimento, [
      { atribuicao: "DEA", valor: Number(valorDea.toFixed(2)) },
      { atribuicao: "AMBOS", valor: valorAmbos }
    ]);
  }

  async function classifyPendingByDefault() {
    if (!pendingFiltered.length) return;
    setClassifyingBulk(true);
    setError("");
    setMessage("");
    try {
      for (const movimento of pendingFiltered) {
        const card = cardById.get(movimento.cartao_id);
        const atribuicao = card?.padrao_atribuicao ?? "AMBOS";
        await updateMovementClassification(movimento, [{ atribuicao, valor: movimento.valor }]);
      }
      if (mobileOfflineMode) {
        setMessage(
          `${pendingFiltered.length} pendencia(s) classificada(s) localmente com atribuicao default do cartao. Use Sync para enviar.`
        );
      } else {
        setMessage(`${pendingFiltered.length} pendencia(s) classificada(s) com atribuicao default do cartao.`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na classificacao em lote");
    } finally {
      setClassifyingBulk(false);
    }
  }

  async function runPreviewImport() {
    setError("");
    setMessage("");
    try {
      if (!importCardId) throw new Error("Selecione o cartao da fatura");
      const lines = resolveImportLines();
      if (!lines.length) throw new Error("Nenhuma linha valida encontrada para importacao");
      const card = cardById.get(importCardId);
      if (!card) throw new Error("Cartao nao encontrado");

      if (mobileOfflineMode) {
        const filtered = filterLinesByCardFinalLocal(lines, card.final_cartao ?? "");
        const result = reconcileImportLinesLocal({
          cartao: card,
          lines: filtered.lines,
          existing: movimentos
        });
        setPreview({
          cartao: card,
          total: result.total,
          novos: result.novos,
          conciliados: result.conciliados,
          filtradosPorFinalCartao: filtered.ignored,
          preview: result.preview
        });
        return;
      }

      const response = await fetch("/api/cartoes/importar/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartao_id: importCardId, mes_ref: importMesRef, lines })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro no preview de importacao");
      setPreview(payload.data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Erro no preview");
    }
  }

  async function runImport() {
    setRunningImport(true);
    setError("");
    setMessage("");
    try {
      if (!importCardId) throw new Error("Selecione o cartao");
      const lines = resolveImportLines();
      if (!lines.length) throw new Error("Nenhuma linha valida para importacao");
      const card = cardById.get(importCardId);
      if (!card) throw new Error("Cartao nao encontrado");

      if (mobileOfflineMode) {
        const filtered = filterLinesByCardFinalLocal(lines, card.final_cartao ?? "");
        const reconciled = reconcileImportLinesLocal({
          cartao: card,
          lines: filtered.lines,
          existing: movimentos
        });
        const now = new Date().toISOString();
        const mesRefFatura = importMesRef.trim();
        const defaultAtribuicao = defaultAtribuicaoForCardLocal(card);

        const existingIdsToAlign = new Set(
          reconciled.preview
            .filter((item) => item.status === "ja_lancado" && item.movimentoId)
            .map((item) => item.movimentoId as string)
        );

        let realinhadosMesRef = 0;
        const updatedExisting: CartaoMovimentoComAlocacoes[] = [];
        let baseMovimentos = movimentos.map((item) => {
          if (!existingIdsToAlign.has(item.id)) return item;
          if (!mesRefFatura || item.origem !== "fatura" || item.mes_ref === mesRefFatura) return item;
          realinhadosMesRef += 1;
          const next = {
            ...item,
            mes_ref: mesRefFatura,
            updated_at: now
          };
          updatedExisting.push(next);
          return next;
        });

        const novos = reconciled.preview.filter((item) => item.status === "novo");
        const inserted: CartaoMovimentoComAlocacoes[] = novos.map((item) => {
          const id = ensureUuid();
          const observacao = item.observacao?.trim()
            ? `${item.observacao.trim()} [IMPORT_FATURA]`
            : "[IMPORT_FATURA]";
          return {
            id,
            cartao_id: card.id,
            data: item.data,
            descricao: item.descricao.trim(),
            valor: Number(item.valor.toFixed(2)),
            parcela_total: item.parcela_total ?? null,
            parcela_numero: item.parcela_numero ?? null,
            tx_key: item.tx_key,
            origem: "fatura",
            status: "pendente",
            mes_ref: mesRefFatura || ymFromDateLocal(item.data),
            observacao,
            created_at: now,
            updated_at: now,
            cartao: card,
            alocacoes: [
              {
                id: ensureUuid(),
                movimento_id: id,
                atribuicao: defaultAtribuicao,
                valor: Number(item.valor.toFixed(2)),
                created_at: now,
                updated_at: now
              }
            ]
          };
        });

        if (inserted.length > 0) {
          baseMovimentos = [...inserted, ...baseMovimentos];
        }

        applySnapshot(cards, baseMovimentos, { persist: true });

        const queued = [...updatedExisting, ...inserted];
        for (const movimento of queued) {
          await queueCartaoMovimentoUpsertLocal({
            ...movimento,
            id: movimento.id,
            alocacoes: movimento.alocacoes.map((alocacao) => ({
              id: alocacao.id,
              atribuicao: alocacao.atribuicao,
              valor: alocacao.valor,
              created_at: alocacao.created_at,
              updated_at: alocacao.updated_at
            }))
          });
        }

        setMessage(
          `Importacao concluida: ${inserted.length} nova(s) compra(s). Pendentes de classificacao: ${inserted.length}.` +
            (Number(filtered.ignored) > 0
              ? ` Ignoradas por final do cartao: ${Number(filtered.ignored)}.`
              : "") +
            (realinhadosMesRef > 0 ? ` Reclassificadas para o mes da fatura: ${realinhadosMesRef}.` : "") +
            " Use Sync para enviar."
        );
        setPreview(null);
        return;
      }

      const response = await fetch("/api/cartoes/importar/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartao_id: importCardId, mes_ref: importMesRef, lines, dryRun: false })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro na importacao");
      const filtradosPorFinal = Number(payload.data.filtradosPorFinalCartao ?? 0);
      const realinhadosMesRef = Number(payload.data.realinhadosMesRef ?? 0);
      setMessage(
        `Importacao concluida: ${payload.data.importados} nova(s) compra(s). Pendentes de classificacao: ${payload.data.pendentesClassificacao}.` +
          (filtradosPorFinal > 0 ? ` Ignoradas por final do cartao: ${filtradosPorFinal}.` : "") +
          (realinhadosMesRef > 0 ? ` Reclassificadas para o mes da fatura: ${realinhadosMesRef}.` : "")
      );
      await load();
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na importacao");
    } finally {
      setRunningImport(false);
    }
  }

  async function generateTotals() {
    setSavingTotals(true);
    setError("");
    setMessage("");
    try {
      if (mobileOfflineMode) {
        const online = typeof navigator === "undefined" ? true : navigator.onLine;
        if (!online) {
          throw new Error(
            "Sem internet para gerar lançamentos de fechamento no legado. Os totais de cartões continuam disponíveis offline."
          );
        }
      }

      const response = await fetch("/api/cartoes/gerar-lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mes: month,
          banco: bank,
          quem_pagou: "WALKER",
          categoria: "CARTAO_CREDITO",
          dryRun: false
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao gerar totalizadores");
      const created = Number(payload?.data?.generated ?? 0);
      const updated = Number(payload?.data?.updated ?? 0);
      const deleted = Number(payload?.data?.deleted ?? 0);
      const unchanged = Number(payload?.data?.unchanged ?? 0);
      const processed = Number(payload?.data?.processed ?? created + updated + deleted);

      if (processed === 0) {
        setMessage("RESUMO DO MES JA PROCESSADO: NENHUMA MUDANCA NECESSARIA.");
      } else {
        const partes = [];
        if (created > 0) partes.push(`${created} criado(s)`);
        if (updated > 0) partes.push(`${updated} atualizado(s)`);
        if (deleted > 0) partes.push(`${deleted} removido(s)`);
        if (unchanged > 0) partes.push(`${unchanged} sem alteracao`);
        setMessage(`Resumo do mes processado: ${partes.join(" | ")}.`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar fechamento");
    } finally {
      setSavingTotals(false);
    }
  }

  function allocationsSummary(movimento: CartaoMovimentoComAlocacoes) {
    if (!movimento.alocacoes.length) return "-";
    return movimento.alocacoes
      .map((item) => `${item.atribuicao}: R$ ${item.valor.toFixed(2)}`)
      .join(" | ");
  }

  return (
    <section className="space-y-8 pb-40">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Cartões</h1>
          <p className="text-sm font-medium text-ink/50">Faturas, compras e conciliação</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sand ring-1 ring-ink/5">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-ink/40">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
          </svg>
        </div>
      </header>

      {/* Control Section */}
      <section className="grid gap-4 rounded-[2rem] bg-sand/50 p-6 ring-1 ring-ink/5 md:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Mês de Referência</label>
          <input
            className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Banco (Fechamento)</label>
          <select
            className="h-12 w-full rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
            value={bank}
            onChange={(event) => setBank(event.target.value as BancoCartao)}
          >
            {bancos.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={load}
          className="h-12 self-end rounded-xl bg-ink px-6 text-sm font-bold text-sand shadow-lg active:scale-95 transition-all disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Sincronizando..." : "Sincronizar Dados"}
        </button>
      </section>

      {/* Card Carousel */}
      <section className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x no-scrollbar">
        {cards.filter(c => c.ativo).map((card) => (
          <article
            key={card.id}
            onClick={() => toggleCardFilter(card)}
            className={`relative flex-shrink-0 w-[280px] snap-center rounded-[2.5rem] p-8 shadow-xl cursor-pointer active:scale-95 transition-all ${
              selectedCardId === card.id
                ? "bg-gradient-to-br from-pine to-emerald-700 text-white ring-2 ring-pine/30"
                : "bg-gradient-to-br from-ink to-slate-800 text-sand"
            }`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                startEditCard(card);
              }}
              className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-white backdrop-blur-sm hover:bg-white/25"
            >
              Editar
            </button>
            <div className="flex flex-col h-full justify-between gap-12">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Cartão</p>
                  <h3 className="text-xl font-black tracking-tighter leading-tight">{card.nome}</h3>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Final</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold tracking-widest leading-none">•••• {card.final_cartao || "0000"}</p>
                    <span className="inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-white/10 px-2 text-[9px] font-bold uppercase backdrop-blur-md">
                      {card.banco}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Titular</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider">{card.titular}</p>
                </div>
              </div>
            </div>
          </article>
        ))}
        <button 
          onClick={() => {
            setCardForm(buildEmptyCardForm());
            setShowCardModal(true);
            setError("");
            setMessage("");
          }}
          className="flex-shrink-0 w-[140px] snap-center rounded-[2.5rem] bg-sand border-2 border-dashed border-ink/10 flex flex-col items-center justify-center gap-2 text-ink/20 hover:text-ink/40 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="text-[10px] font-black uppercase tracking-widest">Novo</span>
        </button>
      </section>

      {selectedCard && (
        <section className="rounded-2xl border border-pine/20 bg-pine/10 px-4 py-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-ink">
            Filtro ativo: <strong>{selectedCard.nome}</strong>
          </p>
          <button
            type="button"
            onClick={clearCardFilter}
            className="rounded-lg bg-white px-3 py-1 text-[11px] font-bold text-ink ring-1 ring-ink/10"
          >
            Limpar
          </button>
        </section>
      )}

      {/* Metrics Grid */}
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/30">Parcelas do Mês</p>
          <p className="mt-1 text-xl font-black tracking-tight text-ink">
            {totalizadoresView.parcelasDoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </article>
        <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/30">Aberto (Realizado)</p>
          <p className="mt-1 text-xl font-black tracking-tight text-ink">
            {totalizadoresView.totalParceladoEmAberto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </article>
        <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink/30">Aberto (Projetado)</p>
          <p className="mt-1 text-xl font-black tracking-tight text-pine">
            {totalizadoresView.totalParceladoEmAbertoProjetado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </article>
      </section>

      {selectedCard && (
        <p className="text-xs font-semibold text-ink/60 -mt-1">
          Totalizadores filtrados pelo cartão ativo.
        </p>
      )}

      {/* Manual Purchase Form - Expansível */}
      <section className="rounded-[2.5rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 overflow-x-hidden">
        <button
          type="button"
          onClick={() => setManualExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-4 text-left"
        >
          <div>
            <h2 className="text-lg font-black tracking-tight text-ink uppercase tracking-widest">Lançamento Manual</h2>
            <p className="text-xs font-bold text-ink/30 mt-1">Registrar compra para {month}</p>
          </div>
          <span className={`text-ink/40 transition-transform ${manualExpanded ? "rotate-180" : ""}`}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>

        {manualExpanded && (
          <div className="mt-6 border-t border-ink/10 pt-6">
            <form onSubmit={saveManualMovement} className="grid gap-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Cartão</label>
                  <select
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                    value={moveForm.cartao_id}
                    onChange={(event) => {
                      const id = event.target.value;
                      const card = cardById.get(id);
                      setMoveForm((prev) => ({
                        ...prev,
                        cartao_id: id,
                        atribuicao: card?.padrao_atribuicao ?? prev.atribuicao
                      }));
                    }}
                    required
                  >
                    <option value="">Selecione...</option>
                    {cards.filter((item) => item.ativo).map((item) => (
                      <option key={item.id} value={item.id}>{item.nome}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Data</label>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    type="date"
                    value={moveForm.data}
                    onChange={(event) => setMoveForm((prev) => ({ ...prev, data: event.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Descrição</label>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    value={moveForm.descricao}
                    onChange={(event) => setMoveForm((prev) => ({ ...prev, descricao: event.target.value }))}
                    required
                    placeholder="O que foi comprado?"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Valor da Parcela</label>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    type="number"
                    step="0.01"
                    value={moveForm.valor}
                    onChange={(event) => setMoveForm((prev) => ({ ...prev, valor: event.target.value }))}
                    required
                    placeholder="0,00"
                  />
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Parcela Atual</label>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    type="number"
                    min="1"
                    value={moveForm.parcela_numero}
                    onChange={(event) => setMoveForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Total de Parcelas</label>
                  <input
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                    type="number"
                    min="1"
                    value={moveForm.parcela_total}
                    onChange={(event) => setMoveForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
                    placeholder="1"
                  />
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Atribuição</label>
                  <select
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                    value={moveForm.atribuicao}
                    onChange={(event) =>
                      setMoveForm((prev) => ({ ...prev, atribuicao: event.target.value as Atribuicao }))
                    }
                    disabled={moveForm.splitMode !== "none"}
                  >
                    {atribuicoes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Divisão (opcional)</label>
                  <select
                    className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all appearance-none"
                    value={moveForm.splitMode}
                    onChange={(event) =>
                      setMoveForm((prev) => ({
                        ...prev,
                        splitMode: event.target.value as SplitMode,
                        splitValor: event.target.value === "none" ? "" : prev.splitValor
                      }))
                    }
                  >
                    <option value="none">Sem divisão</option>
                    <option value="DEA_AMBOS">DEA + AMBOS</option>
                    <option value="WALKER_AMBOS">WALKER + AMBOS</option>
                  </select>
                </div>
              </div>

              {moveForm.splitMode !== "none" && (
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">
                      {moveForm.splitMode === "DEA_AMBOS" ? "Valor DEA" : "Valor WALKER"}
                    </label>
                    <input
                      className="h-14 w-full rounded-2xl bg-sand/30 px-5 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                      type="number"
                      step="0.01"
                      value={moveForm.splitValor}
                      onChange={(event) => setMoveForm((prev) => ({ ...prev, splitValor: event.target.value }))}
                      required
                      placeholder="0,00"
                    />
                  </div>
                </div>
              )}

              <button disabled={savingMove} className="h-14 w-full rounded-2xl bg-ink text-sm font-black uppercase tracking-widest text-sand shadow-lg active:scale-95 transition-all">
                {savingMove ? "Salvando..." : "Registrar Compra"}
              </button>
            </form>
          </div>
        )}
      </section>

      {/* Despesas no cartão - Expansível */}
      <section className="rounded-[2.5rem] bg-white p-6 shadow-sm ring-1 ring-ink/5">
        <button
          type="button"
          onClick={() => setExpensesExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between gap-4 text-left"
        >
          <div>
            <h2 className="text-lg font-black tracking-tight text-ink uppercase tracking-widest">Despesas no Cartão</h2>
            <p className="text-xs font-bold text-ink/30 mt-1">
              {selectedCard ? `Filtrando por ${selectedCard.nome}` : "Visualização geral de todos os cartões"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex min-w-10 justify-center rounded-full bg-sand px-3 py-1 text-xs font-black text-ink">
              {despesasCountDisplay}
            </span>
            <span className={`text-ink/40 transition-transform ${expensesExpanded ? "rotate-180" : ""}`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </span>
          </div>
        </button>

        {expensesExpanded && (
          <div className="mt-6 border-t border-ink/10 pt-6 space-y-8">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">
                Buscar por descrição
              </label>
              <input
                className="h-12 w-full rounded-xl bg-sand/40 px-4 text-sm font-bold ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none transition-all"
                placeholder="Ex.: padaria, farmácia, mercado..."
                value={descriptionFilter}
                onChange={(event) => setDescriptionFilter(event.target.value)}
              />
            </div>

            {pendingFiltered.length > 0 && (
              <section className="space-y-4">
                <header className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40">Pendentes de Classificação ({pendingFiltered.length})</h2>
                  <button
                    onClick={classifyPendingByDefault}
                    disabled={classifyingBulk}
                    className="text-[10px] font-bold text-pine uppercase tracking-wider underline underline-offset-4"
                  >
                    {classifyingBulk ? "Aguarde..." : "Classificar Todos"}
                  </button>
                </header>

                <div className="grid gap-3">
                  {pendingFiltered.map((item) => (
                    <article key={item.id} className="group w-full overflow-hidden rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all active:scale-[0.98]">
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-lg font-black tracking-tight text-ink leading-tight">{item.descricao}</h3>
                          <p className="text-xs font-bold text-ink/30 mt-1 uppercase tracking-wider">
                            {item.data} • {cardById.get(item.cartao_id)?.nome ?? "Cartão"}
                          </p>
                        </div>
                        <p className="shrink-0 pl-2 text-right text-xl font-black tracking-tighter text-ink">
                          {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => classifyMovement(item, [{ atribuicao: "AMBOS", valor: item.valor }])}
                          className="h-10 rounded-xl bg-sand text-[8px] font-black uppercase tracking-widest text-ink/60 hover:bg-ink hover:text-sand transition-all"
                        >
                          Marcar AMBOS
                        </button>
                        <button
                          onClick={() => splitDeaAmbos(item)}
                          className="h-10 rounded-xl bg-sand text-[8px] font-black uppercase tracking-widest text-ink/60 hover:bg-ink hover:text-sand transition-all"
                        >
                          Dividir DEA/AMBOS
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40">Últimos Gastos</h2>
                <div className="h-px flex-1 bg-ink/5 mx-4" />
              </div>

              {lancadosFiltered.length === 0 ? (
                <div className="py-12 text-center rounded-[2rem] bg-sand/30 border border-dashed border-ink/10">
                  <p className="text-xs font-bold uppercase tracking-widest text-ink/20">
                    {normalizedDescriptionFilter ? "Nenhum gasto encontrado para o filtro" : "Sem gastos neste mês"}
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {lancadosFiltered.map((item) => (
                    <article key={item.id} onClick={() => startEditMovement(item)} className="group relative flex w-full items-center justify-between overflow-hidden rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md cursor-pointer active:scale-[0.99]">
                      <div className="flex min-w-0 flex-1 items-center gap-4">
                        <div className="h-12 w-12 shrink-0 rounded-2xl bg-sand flex flex-col items-center justify-center">
                          <span className="text-[10px] font-black text-ink/20 leading-none">{item.data.split('-')[2]}</span>
                          <span className="text-[8px] font-bold text-ink/20 uppercase tracking-tighter">{item.data.split('-')[1]}</span>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-black tracking-tight text-ink leading-tight line-clamp-1">{item.descricao}</h3>
                          <p className="text-[10px] font-bold text-ink/30 uppercase tracking-widest mt-0.5">
                            {cardById.get(item.cartao_id)?.nome ?? "Cartão"}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 pl-2 text-right">
                        <p className="text-base font-black tracking-tighter text-ink">
                          {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </p>
                        <p className="text-[8px] font-bold text-ink/20 uppercase tracking-[0.1em] mt-0.5">
                          {item.origem}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </section>

      {/* Totals & Export - Bottom Sheet style */}
      <section className="rounded-[2.5rem] bg-ink p-8 text-sand shadow-2xl space-y-6">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-black tracking-tight leading-none uppercase tracking-widest">Fechamento do Mês</h2>
          <span className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </header>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Walker</p>
            <p className="text-xl font-black tracking-tight">{totalizadoresView.porAtribuicao.WALKER.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Ambos</p>
            <p className="text-xl font-black tracking-tight">{totalizadoresView.porAtribuicao.AMBOS.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Dea</p>
            <p className="text-xl font-black tracking-tight">{totalizadoresView.porAtribuicao.DEA.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
          <div className="text-pine">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Total Geral</p>
            <p className="text-xl font-black tracking-tight">{totalTodosCartoes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={generateTotals}
          disabled={savingTotals}
          className="w-full h-16 rounded-2xl bg-pine text-xs font-black uppercase tracking-widest text-white shadow-xl active:scale-95 transition-all disabled:opacity-50"
        >
          {savingTotals ? (
            "Processando..."
          ) : (
            <span className="flex flex-col items-center leading-tight">
              <span>Processar Fechamento</span>
              <span className="text-[9px] font-semibold normal-case tracking-normal opacity-90">Gravar no legado</span>
            </span>
          )}
        </button>
      </section>

      {editMoveForm.id && (
        <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-end justify-center p-0 sm:items-center sm:p-4">
          <form
            onSubmit={saveEditedMovement}
            className="w-full max-w-xl rounded-t-[2.5rem] sm:rounded-[2.5rem] bg-white p-8 shadow-2xl space-y-4 animate-in slide-in-from-bottom-full sm:zoom-in-95"
          >
            <header className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-ink">Editar gasto</h3>
                <p className="text-xs text-ink/50">Ajuste dados ou exclua este lançamento.</p>
              </div>
              <button
                type="button"
                onClick={cancelEditMovement}
                className="h-10 px-4 rounded-xl bg-sand text-ink font-bold"
              >
                Fechar
              </button>
            </header>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Cartão</label>
                <select
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none"
                  value={editMoveForm.cartao_id}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, cartao_id: e.target.value })}
                  required
                >
                  <option value="">Selecione...</option>
                  {cards.filter((item) => item.ativo).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nome}
                      {item.final_cartao ? ` (final ${item.final_cartao})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Data</label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  type="date"
                  value={editMoveForm.data}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, data: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Valor</label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  type="number"
                  step="0.01"
                  value={editMoveForm.valor}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, valor: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Atribuição</label>
                <select
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none disabled:opacity-60"
                  value={editMoveForm.atribuicao}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, atribuicao: e.target.value as Atribuicao })}
                  disabled={editMoveForm.splitMode !== "none"}
                >
                  {atribuicoes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Descrição</label>
              <input
                className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                value={editMoveForm.descricao}
                onChange={(e) => setEditMoveForm({ ...editMoveForm, descricao: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Parcela número</label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  type="number"
                  min="1"
                  value={editMoveForm.parcela_numero}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, parcela_numero: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Parcela total</label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  type="number"
                  min="1"
                  value={editMoveForm.parcela_total}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, parcela_total: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Divisão (opcional)</label>
              <select
                className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none"
                value={editMoveForm.splitMode}
                onChange={(e) =>
                  setEditMoveForm((prev) => ({
                    ...prev,
                    splitMode: e.target.value as SplitMode,
                    splitValor: e.target.value === "none" ? "" : prev.splitValor
                  }))
                }
              >
                <option value="none">Sem divisão</option>
                <option value="DEA_AMBOS">DEA + AMBOS</option>
                <option value="WALKER_AMBOS">WALKER + AMBOS</option>
              </select>
            </div>

            {editMoveForm.splitMode !== "none" && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">
                  {editMoveForm.splitMode === "DEA_AMBOS" ? "Valor DEA" : "Valor WALKER"}
                </label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  type="number"
                  step="0.01"
                  value={editMoveForm.splitValor}
                  onChange={(e) => setEditMoveForm({ ...editMoveForm, splitValor: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Observação</label>
              <textarea
                className="min-h-24 w-full rounded-xl bg-sand/50 px-4 py-3 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                value={editMoveForm.observacao}
                onChange={(e) => setEditMoveForm({ ...editMoveForm, observacao: e.target.value })}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (editingMovement) void deleteMovement(editingMovement);
                }}
                disabled={!editingMovement || deletingMoveId === editMoveForm.id || savingEditMove}
                className="h-12 px-5 rounded-xl bg-coral text-white font-bold disabled:opacity-50"
              >
                {deletingMoveId === editMoveForm.id ? "Excluindo..." : "Excluir"}
              </button>
              <button
                type="button"
                onClick={cancelEditMovement}
                className="h-12 px-6 rounded-xl bg-sand text-ink font-bold"
                disabled={savingEditMove}
              >
                Cancelar
              </button>
              <button
                className="flex-1 h-12 rounded-xl bg-ink text-sand font-bold disabled:opacity-50"
                disabled={savingEditMove}
              >
                {savingEditMove ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>
          </form>
        </div>
      )}

      {showCardModal && (
        <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveCard} className="w-full max-w-md rounded-[2.5rem] bg-white p-8 shadow-2xl space-y-4 animate-in zoom-in-95">
            <h3 className="text-lg font-black text-ink">{cardForm.id ? "Editar Cartão" : "Novo Cartão"}</h3>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Nome</label>
              <input
                className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                value={cardForm.nome}
                onChange={(e) => setCardForm({ ...cardForm, nome: e.target.value })}
                placeholder="Ex.: C6 WALKER FISICO"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Banco</label>
                <select
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none"
                  value={cardForm.banco}
                  onChange={(e) => setCardForm({ ...cardForm, banco: e.target.value as BancoCartao })}
                >
                  {bancos.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Titular</label>
                <select
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none"
                  value={cardForm.titular}
                  onChange={(e) =>
                    setCardForm({
                      ...cardForm,
                      titular: e.target.value as CartaoCredito["titular"]
                    })
                  }
                >
                  <option value="WALKER">WALKER</option>
                  <option value="DEA">DEA</option>
                  <option value="JULIA">JULIA</option>
                  <option value="OUTRO">OUTRO</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Final cartão</label>
                <input
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none"
                  value={cardForm.final_cartao}
                  onChange={(e) => setCardForm({ ...cardForm, final_cartao: e.target.value })}
                  placeholder="Ex.: 5684"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40 ml-1">Atrib. default</label>
                <select
                  className="h-12 w-full rounded-xl bg-sand/50 px-4 ring-1 ring-ink/10 focus:ring-2 focus:ring-pine outline-none appearance-none"
                  value={cardForm.padrao_atribuicao}
                  onChange={(e) =>
                    setCardForm({
                      ...cardForm,
                      padrao_atribuicao: e.target.value as Atribuicao
                    })
                  }
                >
                  {atribuicoes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-xl bg-sand/50 px-4 py-3 ring-1 ring-ink/10">
              <input
                type="checkbox"
                checked={cardForm.ativo}
                onChange={(e) => setCardForm({ ...cardForm, ativo: e.target.checked })}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-ink/70">Cartão ativo</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button className="flex-1 h-12 rounded-xl bg-ink text-sand font-bold">
                {cardForm.id ? "Salvar alterações" : "Salvar cartão"}
              </button>
              <button type="button" onClick={cancelEditCard} className="h-12 px-6 rounded-xl bg-sand text-ink font-bold">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {message && (
        <div className="fixed inset-x-0 bottom-32 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setMessage("")}
            className={`w-full max-w-sm rounded-2xl p-4 text-center text-xs font-black uppercase tracking-widest shadow-2xl ${
              message.startsWith("RESUMO DO MES JA PROCESSADO")
                ? "bg-sand text-ink ring-1 ring-ink/15"
                : "bg-pine text-white animate-bounce"
            }`}
          >
            {message}
          </button>
        </div>
      )}
      {error && (
        <div className="fixed inset-x-0 bottom-32 z-[120] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setError("")}
            className="w-full max-w-sm rounded-2xl bg-coral p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl"
          >
            {error}
          </button>
        </div>
      )}
    </section>
  );
}
