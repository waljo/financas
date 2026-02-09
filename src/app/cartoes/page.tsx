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
        `Resumo do mes processado: ${payload.data.generated} lançamentos criados.`
      );
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
    <section className="space-y-8 pb-32">
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

      {/* Card Carousel */}
      <section className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x no-scrollbar">
        {cards.filter(c => c.ativo).map((card) => (
          <article 
            key={card.id} 
            onClick={() => startEditCard(card)}
            className="flex-shrink-0 w-[280px] snap-center rounded-[2.5rem] bg-gradient-to-br from-ink to-slate-800 p-8 text-sand shadow-xl cursor-pointer active:scale-95 transition-all"
          >
            <div className="flex flex-col h-full justify-between gap-12">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Cartão</p>
                  <h3 className="text-xl font-black tracking-tighter leading-tight">{card.nome}</h3>
                </div>
                <div className="h-8 w-12 rounded-lg bg-white/10 flex items-center justify-center backdrop-blur-md">
                  <span className="text-[10px] font-bold opacity-60">{card.banco}</span>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40">Final</p>
                  <p className="text-sm font-bold tracking-widest leading-none">•••• {card.final_cartao || "0000"}</p>
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
          onClick={() => { setCardForm(buildEmptyCardForm()); }}
          className="flex-shrink-0 w-[140px] snap-center rounded-[2.5rem] bg-sand border-2 border-dashed border-ink/10 flex flex-col items-center justify-center gap-2 text-ink/20 hover:text-ink/40 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="text-[10px] font-black uppercase tracking-widest">Novo</span>
        </button>
      </section>

      {/* Pending Items - Action List */}
      {pending.length > 0 && (
        <section className="space-y-4">
          <header className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40">Classificações Pendentes ({pending.length})</h2>
            <button 
              onClick={classifyPendingByDefault}
              disabled={classifyingBulk}
              className="text-[10px] font-bold text-pine uppercase tracking-wider underline underline-offset-4"
            >
              {classifyingBulk ? "Aguarde..." : "Classificar Todos"}
            </button>
          </header>
          
          <div className="grid gap-3">
            {pending.map((item) => (
              <article key={item.id} className="group rounded-[2rem] bg-white p-6 shadow-sm ring-1 ring-ink/5 transition-all active:scale-[0.98]">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-black tracking-tight text-ink leading-tight">{item.descricao}</h3>
                    <p className="text-xs font-bold text-ink/30 mt-1 uppercase tracking-wider">
                      {item.data} • {cardById.get(item.cartao_id)?.nome ?? "Cartão"}
                    </p>
                  </div>
                  <p className="text-xl font-black tracking-tighter text-ink">
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

      {/* Main List - Compact Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-widest text-ink/40">Gastos Lançados</h2>
          <div className="h-px flex-1 bg-ink/5 mx-4" />
        </div>

        {lancados.length === 0 ? (
          <div className="py-12 text-center rounded-[2rem] bg-sand/30 border border-dashed border-ink/10">
            <p className="text-xs font-bold uppercase tracking-widest text-ink/20">Sem gastos neste mês</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {lancados.map((item) => (
              <article key={item.id} onClick={() => startEditMovement(item)} className="group relative flex items-center justify-between rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5 transition-all hover:shadow-md cursor-pointer active:scale-[0.99]">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-sand flex flex-col items-center justify-center">
                    <span className="text-[10px] font-black text-ink/20 leading-none">{item.data.split('-')[2]}</span>
                    <span className="text-[8px] font-bold text-ink/20 uppercase tracking-tighter">{item.data.split('-')[1]}</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-black tracking-tight text-ink leading-tight line-clamp-1">{item.descricao}</h3>
                    <p className="text-[10px] font-bold text-ink/30 uppercase tracking-widest mt-0.5">
                      {cardById.get(item.cartao_id)?.nome ?? "Cartão"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
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
          className="w-full h-14 rounded-2xl bg-pine text-xs font-black uppercase tracking-widest text-white shadow-xl active:scale-95 transition-all disabled:opacity-50"
        >
          {savingTotals ? "Processando..." : `Processar Fechamento`}
        </button>
      </section>

      {/* Modals/Sheets for Edit & Import would go here, simplified for this step */}
      {cardForm.id && (
        <div className="fixed inset-0 z-50 bg-ink/50 backdrop-blur-sm flex items-center justify-center p-4">
           <form onSubmit={saveCard} className="w-full max-w-md rounded-[2.5rem] bg-white p-8 shadow-2xl space-y-4 animate-in zoom-in-95">
              <h3 className="text-lg font-black text-ink">Editar Cartão</h3>
              {/* Simplified form for brevity, full fields assumed from context */}
              <input className="h-12 w-full rounded-xl bg-sand/50 px-4" value={cardForm.nome} onChange={e => setCardForm({...cardForm, nome: e.target.value})} placeholder="Nome" />
              <div className="flex gap-2">
                <button className="flex-1 h-12 rounded-xl bg-ink text-sand font-bold">Salvar</button>
                <button type="button" onClick={cancelEditCard} className="h-12 px-6 rounded-xl bg-sand text-ink font-bold">Cancelar</button>
              </div>
           </form>
        </div>
      )}

      {message && <p className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[90%] max-w-sm rounded-2xl bg-pine p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl animate-bounce">{message}</p>}
      {error && <p className="fixed bottom-24 left-1/2 -translate-x-1/2 w-[90%] max-w-sm rounded-2xl bg-coral p-4 text-center text-xs font-black uppercase tracking-widest text-white shadow-2xl">{error}</p>}
    </section>
  );
}