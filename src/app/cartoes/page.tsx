"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

export default function CartoesPage() {
  const buildEmptyCardForm = () => ({
    id: "",
    nome: "",
    banco: "C6" as BancoCartao,
    titular: "WALKER",
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

  const [moveForm, setMoveForm] = useState({
    cartao_id: "",
    data: todayIso(),
    descricao: "",
    valor: "",
    parcela_numero: "",
    parcela_total: "",
    observacao: "",
    atribuicao: "WALKER" as Atribuicao,
    splitDeaAmbos: false,
    valorDea: ""
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
    splitDeaAmbos: false,
    valorDea: "",
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
  const pending = useMemo(() => movimentos.filter((item) => item.status === "pendente"), [movimentos]);
  const lancados = useMemo(() => movimentos.filter((item) => item.status === "conciliado"), [movimentos]);
  const totalTodosCartoes = useMemo(
    () => lancados.reduce((sum, item) => sum + item.valor, 0),
    [lancados]
  );
  const totalizadoresView: Totalizadores = totalizadores ?? {
    mes: month,
    banco: bank,
    porAtribuicao: { WALKER: 0, AMBOS: 0, DEA: 0 },
    pendentes: 0,
    parcelasDoMes: 0,
    totalParceladoEmAberto: 0,
    totalParceladoEmAbertoProjetado: 0
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cardsRes, movRes, totalizadoresRes] = await Promise.all([
        fetch("/api/cartoes/cards"),
        fetch(`/api/cartoes/movimentos?mes=${month}`),
        fetch(`/api/cartoes/totalizadores?mes=${month}&banco=${bank}`)
      ]);

      const cardsPayload = await cardsRes.json();
      if (!cardsRes.ok) throw new Error(cardsPayload.message ?? "Erro ao carregar cartoes");
      const rows = cardsPayload.data ?? [];
      setCards(rows);
      setMoveForm((prev) => {
        if (prev.cartao_id || !rows[0]) return prev;
        return {
          ...prev,
          cartao_id: rows[0].id,
          atribuicao: rows[0].padrao_atribuicao
        };
      });
      setImportCardId((prev) => prev || rows[0]?.id || "");

      const movPayload = await movRes.json();
      if (!movRes.ok) throw new Error(movPayload.message ?? "Erro ao carregar movimentos");
      setMovimentos(movPayload.data ?? []);

      const totalizadoresPayload = await totalizadoresRes.json();
      if (!totalizadoresRes.ok) {
        throw new Error(totalizadoresPayload.message ?? "Erro ao carregar totalizadores");
      }
      setTotalizadores((totalizadoresPayload.data ?? null) as Totalizadores | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao carregar modulo de cartoes");
    } finally {
      setLoading(false);
    }
  }, [bank, month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setImportMesRef(month);
  }, [month]);

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
      splitDeaAmbos: false,
      valorDea: "",
      origem: "manual"
    });
  }

  function startEditMovement(movimento: CartaoMovimentoComAlocacoes) {
    const dea = movimento.alocacoes.find((item) => item.atribuicao === "DEA");
    const ambos = movimento.alocacoes.find((item) => item.atribuicao === "AMBOS");
    const split = Boolean(dea && ambos && movimento.alocacoes.length === 2);
    const atribuicaoSingle = split
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
      splitDeaAmbos: split,
      valorDea: split && dea ? dea.valor.toFixed(2) : "",
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
    setMessage("");
    setError("");
  }

  function cancelEditCard() {
    setCardForm(buildEmptyCardForm());
    setMessage("");
    setError("");
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const editing = Boolean(cardForm.id);
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
      if (moveForm.splitDeaAmbos) {
        const valorDea = parseMoney(moveForm.valorDea);
        if (!Number.isFinite(valorDea) || valorDea <= 0 || valorDea >= valor) {
          throw new Error("No split DEA/AMBOS, informe um valor DEA valido menor que o total");
        }
        const valorAmbos = Number((valor - valorDea).toFixed(2));
        alocacoes = [
          { atribuicao: "DEA", valor: Number(valorDea.toFixed(2)) },
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
        origem: "manual",
        status: "conciliado",
        mes_ref: month,
        observacao: moveForm.observacao,
        alocacoes
      };

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
        splitDeaAmbos: false,
        valorDea: ""
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
      if (editMoveForm.splitDeaAmbos) {
        const valorDea = parseMoney(editMoveForm.valorDea);
        if (!Number.isFinite(valorDea) || valorDea <= 0 || valorDea >= valor) {
          throw new Error("No split DEA/AMBOS, informe um valor DEA valido menor que o total");
        }
        const valorAmbos = Number((valor - valorDea).toFixed(2));
        alocacoes = [
          { atribuicao: "DEA", valor: Number(valorDea.toFixed(2)) },
          { atribuicao: "AMBOS", valor: valorAmbos }
        ];
      } else {
        alocacoes = [{ atribuicao: editMoveForm.atribuicao, valor: Number(valor.toFixed(2)) }];
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
      setMessage(`Compra "${movimento.descricao}" classificada.`);
      await load();
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
    if (!pending.length) return;
    setClassifyingBulk(true);
    setError("");
    setMessage("");
    try {
      for (const movimento of pending) {
        const card = cardById.get(movimento.cartao_id);
        const atribuicao = card?.padrao_atribuicao ?? "AMBOS";
        await updateMovementClassification(movimento, [{ atribuicao, valor: movimento.valor }]);
      }
      setMessage(`${pending.length} pendencia(s) classificada(s) com atribuicao default do cartao.`);
      await load();
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
      setMessage(
        `Totalizadores gerados em LANCAMENTOS: ${payload.data.generated} (ignorados ${payload.data.skippedExisting} ja existentes).`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao gerar totalizadores");
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
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Cartoes</h1>
        <p className="text-sm text-ink/70">
          Lancamento diario + importacao de fatura + conciliacao automatica por tx_key.
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="text-sm">
          Mes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Banco (totalizadores)
          <select
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            value={bank}
            onChange={(event) => setBank(event.target.value as BancoCartao)}
          >
            {bancos.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={load}
          className="self-end rounded-lg border border-ink/20 px-4 py-2"
          disabled={loading}
        >
          {loading ? "Atualizando..." : "Atualizar dados"}
        </button>
      </section>

      <section className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-3">
        <article className="rounded-lg border border-ink/10 bg-sand p-3">
          <p className="text-sm text-ink/70">Parcelas do mes</p>
          <p className="text-2xl font-semibold">
            {totalizadoresView.parcelasDoMes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <p className="mt-1 text-xs text-ink/60">Soma das compras parceladas que cairam na fatura deste mes.</p>
        </article>
        <article className="rounded-lg border border-ink/10 bg-sand p-3">
          <p className="text-sm text-ink/70">Total em aberto (realizado)</p>
          <p className="text-2xl font-semibold">
            {totalizadoresView.totalParceladoEmAberto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
          <p className="mt-1 text-xs text-ink/60">Baseado apenas nas parcelas ja registradas no sistema.</p>
        </article>
        <article className="rounded-lg border border-ink/10 bg-sand p-3">
          <p className="text-sm text-ink/70">Total em aberto (projetado)</p>
          <p className="text-2xl font-semibold">
            {totalizadoresView.totalParceladoEmAbertoProjetado.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL"
            })}
          </p>
          <p className="mt-1 text-xs text-ink/60">
            Assume pagamento mensal ate o mes selecionado, mesmo sem lancamento registrado.
          </p>
        </article>
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Cadastro de cartoes</h2>
        {cardForm.id ? (
          <p className="rounded-lg bg-sand p-2 text-sm text-ink">
            Editando cartao selecionado. Salve para aplicar as alteracoes ou cancele para voltar ao modo novo.
          </p>
        ) : null}
        <form onSubmit={saveCard} className="grid gap-3 md:grid-cols-7">
          <label className="text-sm md:col-span-2">
            Nome
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={cardForm.nome}
              onChange={(event) => setCardForm((prev) => ({ ...prev, nome: event.target.value }))}
              placeholder="Ex.: C6 WALKER VIRTUAL"
              required
            />
          </label>
          <label className="text-sm">
            Banco
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={cardForm.banco}
              onChange={(event) => setCardForm((prev) => ({ ...prev, banco: event.target.value as BancoCartao }))}
            >
              {bancos.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Titular
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={cardForm.titular}
              onChange={(event) => setCardForm((prev) => ({ ...prev, titular: event.target.value }))}
            >
              <option value="WALKER">WALKER</option>
              <option value="DEA">DEA</option>
              <option value="JULIA">JULIA</option>
              <option value="OUTRO">OUTRO</option>
            </select>
          </label>
          <label className="text-sm">
            Final cartao
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={cardForm.final_cartao}
              onChange={(event) => setCardForm((prev) => ({ ...prev, final_cartao: event.target.value }))}
              placeholder="Ex.: 3028"
            />
          </label>
          <label className="text-sm">
            Atrib. default
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={cardForm.padrao_atribuicao}
              onChange={(event) =>
                setCardForm((prev) => ({ ...prev, padrao_atribuicao: event.target.value as Atribuicao }))
              }
            >
              {atribuicoes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm md:mt-7">
            <input
              type="checkbox"
              checked={cardForm.ativo}
              onChange={(event) => setCardForm((prev) => ({ ...prev, ativo: event.target.checked }))}
            />
            Ativo
          </label>
          <div className="flex items-end gap-2 md:col-span-2">
            <button className="rounded-lg bg-ink px-4 py-2 font-semibold text-sand">
              {cardForm.id ? "Atualizar cartao" : "Salvar cartao"}
            </button>
            {cardForm.id ? (
              <button
                type="button"
                onClick={cancelEditCard}
                className="rounded-lg border border-ink/20 px-4 py-2 text-sm"
              >
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-2 py-2">Nome</th>
                <th className="px-2 py-2">Banco</th>
                <th className="px-2 py-2">Titular</th>
                <th className="px-2 py-2">Final</th>
                <th className="px-2 py-2">Default</th>
                <th className="px-2 py-2">Ativo</th>
                <th className="px-2 py-2">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((item) => (
                <tr key={item.id} className="border-b border-ink/5">
                  <td className="px-2 py-2">{item.nome}</td>
                  <td className="px-2 py-2">{item.banco}</td>
                  <td className="px-2 py-2">{item.titular}</td>
                  <td className="px-2 py-2">{item.final_cartao || "-"}</td>
                  <td className="px-2 py-2">{item.padrao_atribuicao}</td>
                  <td className="px-2 py-2">{item.ativo ? "Sim" : "Nao"}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => startEditCard(item)}
                      className="rounded border border-ink/20 px-2 py-1 text-xs"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Lancamento manual de compra no cartao</h2>
        <p className="text-xs text-ink/60">
          Mes de referencia para este lancamento: <strong>{month}</strong>.
        </p>
        <form onSubmit={saveManualMovement} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            Cartao
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
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
                <option key={item.id} value={item.id}>
                  {item.nome}
                  {item.final_cartao ? ` (final ${item.final_cartao})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Data
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="date"
              value={moveForm.data}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, data: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm">
            Valor parcela
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              step="0.01"
              value={moveForm.valor}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, valor: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm md:col-span-2">
            Descricao
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={moveForm.descricao}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, descricao: event.target.value }))}
              required
            />
          </label>
          <label className="text-sm">
            Parcela numero
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              min="1"
              value={moveForm.parcela_numero}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
            />
          </label>
          <label className="text-sm">
            Parcela total
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              min="1"
              value={moveForm.parcela_total}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Atribuicao
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={moveForm.atribuicao}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, atribuicao: event.target.value as Atribuicao }))}
              disabled={moveForm.splitDeaAmbos}
            >
              {atribuicoes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2 md:mt-7">
            <input
              type="checkbox"
              checked={moveForm.splitDeaAmbos}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, splitDeaAmbos: event.target.checked }))}
            />
            Dividir esta compra em DEA + AMBOS
          </label>
          {moveForm.splitDeaAmbos ? (
            <label className="text-sm md:col-span-2">
              Valor DEA (restante vira AMBOS)
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="number"
                step="0.01"
                value={moveForm.valorDea}
                onChange={(event) => setMoveForm((prev) => ({ ...prev, valorDea: event.target.value }))}
                required
              />
            </label>
          ) : null}
          <label className="text-sm md:col-span-4">
            Observacao
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={moveForm.observacao}
              onChange={(event) => setMoveForm((prev) => ({ ...prev, observacao: event.target.value }))}
            />
          </label>
          <button disabled={savingMove} className="rounded-lg bg-ink px-4 py-2 font-semibold text-sand">
            {savingMove ? "Salvando..." : "Salvar compra"}
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Importar fatura e conciliar</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Cartao da fatura
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={importCardId}
              onChange={(event) => setImportCardId(event.target.value)}
            >
              <option value="">Selecione...</option>
              {cards.filter((item) => item.ativo).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nome}
                  {item.final_cartao ? ` (final ${item.final_cartao})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Mes da fatura
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="month"
              value={importMesRef}
              onChange={(event) => setImportMesRef(event.target.value)}
            />
          </label>
          <div className="text-sm text-ink/70 md:mt-7">
            Formato por linha: `data;descricao;valor;parcela_numero;parcela_total;observacao;final_cartao`
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-sm">
            Upload CSV
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2 text-sm"
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvUpload}
            />
          </label>
          {importCsvLines ? (
            <button
              type="button"
              onClick={clearCsvUpload}
              className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            >
              Limpar CSV
            </button>
          ) : null}
        </div>
        {importCsvLines ? (
          <p className="rounded-lg bg-mint/40 p-2 text-sm text-ink">
            CSV ativo: {importCsvName} ({importCsvLines.length} linha(s) valida(s)).
          </p>
        ) : null}
        <textarea
          className="min-h-36 w-full rounded-lg border border-ink/20 px-3 py-2 font-mono text-xs"
          value={importText}
          onChange={(event) => {
            setImportText(event.target.value);
            if (importCsvLines) {
              setImportCsvLines(null);
              setImportCsvName("");
            }
          }}
          placeholder="2026-02-04;LOJA X;199,90;1;4;roupa meninas;3028"
        />
        <p className="text-xs text-ink/60">
          Se CSV estiver carregado, ele tem prioridade. Ao editar o texto manual, o CSV ativo e removido.
        </p>
        <p className="text-xs text-ink/60">
          Mes de referencia da fatura para classificacao: <strong>{importMesRef}</strong>.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={runPreviewImport} className="rounded-lg border border-ink/20 px-4 py-2">
            Gerar preview
          </button>
          <button
            type="button"
            onClick={runImport}
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
            disabled={runningImport}
          >
            {runningImport ? "Importando..." : "Importar novos"}
          </button>
        </div>

        {preview ? (
          <div className="rounded-lg bg-sand p-3 text-sm">
            <p>
              Total: {preview.total} | Ja lancado: {preview.conciliados} | Novos: {preview.novos}
            </p>
            {preview.filtradosPorFinalCartao ? (
              <p className="mt-1 text-xs text-ink/70">
                Ignoradas por final do cartao selecionado: {preview.filtradosPorFinalCartao}
              </p>
            ) : null}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[700px] text-xs">
                <thead>
                  <tr className="border-b border-ink/10 text-left">
                    <th className="px-2 py-1">Data</th>
                    <th className="px-2 py-1">Descricao</th>
                    <th className="px-2 py-1">Valor</th>
                    <th className="px-2 py-1">Parcela</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.slice(0, 80).map((item, idx) => (
                    <tr key={`${item.tx_key}-${idx}`} className="border-b border-ink/5">
                      <td className="px-2 py-1">{item.data}</td>
                      <td className="px-2 py-1">{item.descricao}</td>
                      <td className="px-2 py-1">R$ {item.valor.toFixed(2)}</td>
                      <td className="px-2 py-1">
                        {item.parcela_numero && item.parcela_total
                          ? `${item.parcela_numero}/${item.parcela_total}`
                          : "-"}
                      </td>
                      <td className="px-2 py-1">
                        {item.status === "ja_lancado" ? (
                          <span className="text-pine">Ja lancado</span>
                        ) : (
                          <span className="text-ink">Novo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Pendentes de classificacao ({pending.length})</h2>
        {pending.length > 0 ? (
          <button
            type="button"
            className="rounded-lg border border-ink/20 px-3 py-2 text-sm"
            onClick={classifyPendingByDefault}
            disabled={classifyingBulk}
          >
            {classifyingBulk ? "Classificando..." : "Classificar todos pelo default do cartao"}
          </button>
        ) : null}
        {pending.length === 0 ? (
          <p className="text-sm text-ink/70">Sem pendencias neste mes.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((item) => (
              <article key={item.id} className="rounded-lg border border-ink/10 bg-sand p-3 text-sm">
                <p className="font-medium">
                  {item.descricao} - R$ {item.valor.toFixed(2)}
                </p>
                <p className="text-xs text-ink/70">
                  {item.data} | {cardById.get(item.cartao_id)?.nome ?? item.cartao_id}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded border border-ink/20 px-2 py-1"
                    onClick={() => classifyMovement(item, [{ atribuicao: "AMBOS", valor: item.valor }])}
                  >
                    Marcar AMBOS
                  </button>
                  <button
                    type="button"
                    className="rounded border border-ink/20 px-2 py-1"
                    onClick={() => classifyMovement(item, [{ atribuicao: "DEA", valor: item.valor }])}
                  >
                    Marcar DEA
                  </button>
                  <button
                    type="button"
                    className="rounded border border-ink/20 px-2 py-1"
                    onClick={() => classifyMovement(item, [{ atribuicao: "WALKER", valor: item.valor }])}
                  >
                    Marcar WALKER
                  </button>
                  <button
                    type="button"
                    className="rounded border border-ink/20 px-2 py-1"
                    onClick={() => splitDeaAmbos(item)}
                  >
                    Dividir DEA/AMBOS
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Gastos lancados do mes ({lancados.length})</h2>
        {editMoveForm.id ? (
          <form onSubmit={saveEditedMovement} className="grid gap-3 rounded-xl border border-ink/10 bg-sand p-3 md:grid-cols-4">
            <h3 className="text-sm font-semibold md:col-span-4">Editando gasto selecionado</h3>
            <label className="text-sm md:col-span-2">
              Cartao
              <select
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                value={editMoveForm.cartao_id}
                onChange={(event) => {
                  const id = event.target.value;
                  const card = cardById.get(id);
                  setEditMoveForm((prev) => ({
                    ...prev,
                    cartao_id: id,
                    atribuicao: card?.padrao_atribuicao ?? prev.atribuicao
                  }));
                }}
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
            </label>
            <label className="text-sm">
              Data
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="date"
                value={editMoveForm.data}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, data: event.target.value }))}
                required
              />
            </label>
            <label className="text-sm">
              Valor total
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="number"
                step="0.01"
                value={editMoveForm.valor}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, valor: event.target.value }))}
                required
              />
            </label>
            <label className="text-sm md:col-span-2">
              Descricao
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                value={editMoveForm.descricao}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, descricao: event.target.value }))}
                required
              />
            </label>
            <label className="text-sm">
              Parcela numero
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="number"
                min="1"
                value={editMoveForm.parcela_numero}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, parcela_numero: event.target.value }))}
              />
            </label>
            <label className="text-sm">
              Parcela total
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                type="number"
                min="1"
                value={editMoveForm.parcela_total}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, parcela_total: event.target.value }))}
              />
            </label>
            <label className="text-sm md:col-span-2">
              Atribuicao
              <select
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                value={editMoveForm.atribuicao}
                onChange={(event) =>
                  setEditMoveForm((prev) => ({ ...prev, atribuicao: event.target.value as Atribuicao }))
                }
                disabled={editMoveForm.splitDeaAmbos}
              >
                {atribuicoes.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-2 md:mt-7">
              <input
                type="checkbox"
                checked={editMoveForm.splitDeaAmbos}
                onChange={(event) =>
                  setEditMoveForm((prev) => ({ ...prev, splitDeaAmbos: event.target.checked }))
                }
              />
              Dividir esta compra em DEA + AMBOS
            </label>
            {editMoveForm.splitDeaAmbos ? (
              <label className="text-sm md:col-span-2">
                Valor DEA (restante vira AMBOS)
                <input
                  className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                  type="number"
                  step="0.01"
                  value={editMoveForm.valorDea}
                  onChange={(event) => setEditMoveForm((prev) => ({ ...prev, valorDea: event.target.value }))}
                  required
                />
              </label>
            ) : null}
            <label className="text-sm md:col-span-4">
              Observacao
              <input
                className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
                value={editMoveForm.observacao}
                onChange={(event) => setEditMoveForm((prev) => ({ ...prev, observacao: event.target.value }))}
              />
            </label>
            <div className="flex gap-2 md:col-span-4">
              <button
                type="submit"
                disabled={savingEditMove}
                className="rounded-lg bg-ink px-4 py-2 font-semibold text-sand"
              >
                {savingEditMove ? "Salvando..." : "Salvar alteracoes"}
              </button>
              <button
                type="button"
                onClick={cancelEditMovement}
                className="rounded-lg border border-ink/20 px-4 py-2"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : null}

        {lancados.length === 0 ? (
          <p className="text-sm text-ink/70">Sem gastos lancados para este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Cartao</th>
                  <th className="px-2 py-2">Descricao</th>
                  <th className="px-2 py-2">Valor</th>
                  <th className="px-2 py-2">Atribuicoes</th>
                  <th className="px-2 py-2">Origem</th>
                  <th className="px-2 py-2">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {lancados.map((item) => (
                  <tr key={item.id} className="border-b border-ink/5">
                    <td className="px-2 py-2">{item.data}</td>
                    <td className="px-2 py-2">{cardById.get(item.cartao_id)?.nome ?? item.cartao_id}</td>
                    <td className="px-2 py-2">{item.descricao}</td>
                    <td className="px-2 py-2">R$ {item.valor.toFixed(2)}</td>
                    <td className="px-2 py-2 text-xs">{allocationsSummary(item)}</td>
                    <td className="px-2 py-2">{item.origem}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEditMovement(item)}
                          className="rounded border border-ink/20 px-2 py-1 text-xs"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteMovement(item)}
                          disabled={deletingMoveId === item.id}
                          className="rounded border border-coral/40 px-2 py-1 text-xs text-coral"
                        >
                          {deletingMoveId === item.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Totalizadores do mes</h2>
        {totalizadores ? (
          <div className="grid gap-3 md:grid-cols-5">
            <article className="rounded-lg border border-ink/10 bg-sand p-3">
              <p className="text-sm text-ink/70">{bank}_WALKER</p>
              <p className="text-lg font-semibold">R$ {totalizadores.porAtribuicao.WALKER.toFixed(2)}</p>
            </article>
            <article className="rounded-lg border border-ink/10 bg-sand p-3">
              <p className="text-sm text-ink/70">{bank}_AMBOS</p>
              <p className="text-lg font-semibold">R$ {totalizadores.porAtribuicao.AMBOS.toFixed(2)}</p>
            </article>
            <article className="rounded-lg border border-ink/10 bg-sand p-3">
              <p className="text-sm text-ink/70">{bank}_DEA</p>
              <p className="text-lg font-semibold">R$ {totalizadores.porAtribuicao.DEA.toFixed(2)}</p>
            </article>
            <article className="rounded-lg border border-ink/10 bg-sand p-3">
              <p className="text-sm text-ink/70">Pendentes</p>
              <p className="text-lg font-semibold">{totalizadores.pendentes}</p>
            </article>
            <article className="rounded-lg border border-ink/10 bg-sand p-3">
              <p className="text-sm text-ink/70">TOTAL_CARTOES</p>
              <p className="text-lg font-semibold">R$ {totalTodosCartoes.toFixed(2)}</p>
            </article>
          </div>
        ) : null}
        <button
          type="button"
          onClick={generateTotals}
          disabled={savingTotals}
          className="rounded-lg bg-ink px-4 py-2 font-semibold text-sand"
        >
          {savingTotals ? "Gerando..." : `Gerar lancamentos ${bank}_WALKER/AMBOS/DEA`}
        </button>
      </section>

      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}
    </section>
  );
}
