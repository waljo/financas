import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { bootstrapNow } from "./src/bootstrap/bootstrapService";
import {
  clearSyncLogs,
  classifyCartaoMovimentoLocal,
  createCalendarioAnualLocal,
  createCartaoLocal,
  createCartaoMovimentoLocal,
  createCategoriaLocal,
  createContaFixaLocal,
  createLancamentoLocal,
  createReceitaRegraLocal,
  deleteCalendarioAnualLocal,
  deleteCartaoLocal,
  deleteCartaoMovimentoLocal,
  deleteCategoriaLocal,
  deleteContaFixaLocal,
  deleteLancamentoLocal,
  deleteReceitaRegraLocal,
  getLocalSummary,
  initDb,
  listAtribuicaoOptions,
  listBancoOptions,
  listEntityRows,
  listMetodoOptions,
  listSyncLogs,
  listPessoaPagadoraOptions,
  listTitularOptions,
  updateCalendarioAnualLocal,
  updateCartaoLocal,
  updateCartaoMovimentoLocal,
  updateCategoriaLocal,
  updateContaFixaLocal,
  updateLancamentoLocal,
  updateReceitaRegraLocal
} from "./src/db/store";
import { getJson, postJson } from "./src/api/backend";
import {
  computeComparativoMensalLocal,
  computeParcelasDetalheLocal,
  computeMonthlySnapshotLocal,
  computeProjection90DaysLocal,
  computeRelatorioMensalLocal,
  getMonthStartFromMonthKey
} from "./src/domain/analytics";
import { syncNow } from "./src/sync/manualSync";

const BANCO_OPTIONS = listBancoOptions();
const TITULAR_OPTIONS = listTitularOptions();
const ATRIBUICAO_OPTIONS = listAtribuicaoOptions();
const METODO_OPTIONS = listMetodoOptions();
const PESSOA_PAGADORA_OPTIONS = listPessoaPagadoraOptions();
const TIPO_LANCAMENTO_OPTIONS = ["despesa", "receita"];
const MORE_SECTIONS = [
  { key: "relatorios", label: "Relatorios" },
  { key: "categorias", label: "Categorias" },
  { key: "contas", label: "Contas fixas" },
  { key: "sync", label: "Sync" }
];

function ActionButton({ label, onPress, disabled, busy, variant = "dark" }) {
  const style = [styles.button, variant === "danger" ? styles.buttonDanger : styles.buttonDark];
  return (
    <TouchableOpacity style={[style, disabled ? styles.buttonDisabled : null]} onPress={onPress} disabled={disabled}>
      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function OptionChip({ label, selected, onPress }) {
  return (
    <TouchableOpacity style={[styles.chip, selected ? styles.chipSelected : null]} onPress={onPress}>
      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function BottomNavButton({ label, active, onPress, icon }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.bottomNavButton}>
      <View style={[styles.bottomNavIconWrap, active ? styles.bottomNavIconWrapActive : null]}>
        <Text style={[styles.bottomNavIcon, active ? styles.bottomNavIconActive : null]}>{icon}</Text>
      </View>
      <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CountRow({ label, value }) {
  return (
    <View style={styles.countRow}>
      <Text style={styles.countLabel}>{label}</Text>
      <Text style={styles.countValue}>{value}</Text>
    </View>
  );
}

function formatMoney(value) {
  const amount = Number(value ?? 0);
  return amount.toFixed(2).replace(".", ",");
}

function formatDateTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("pt-BR");
}

function parseNumberInput(value) {
  const text = String(value ?? "")
    .replace(/[R$\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(text || "0");
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function parseJsonInput(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON invalido em ${label}.`);
  }
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function currentDateYmd() {
  return new Date().toISOString().slice(0, 10);
}

function formatMonthShort(ym) {
  const [yearRaw, monthRaw] = String(ym || "").split("-");
  const year = Number(yearRaw);
  const mon = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) return String(ym || "");
  const dtf = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
  return dtf.format(new Date(Date.UTC(year, mon - 1, 1))).replace(".", "");
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState("http://192.168.0.10:3000");
  const [activeTab, setActiveTab] = useState("inicio");
  const [moreSection, setMoreSection] = useState("relatorios");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [contasFixas, setContasFixas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [receitasRegras, setReceitasRegras] = useState([]);
  const [calendarioAnual, setCalendarioAnual] = useState([]);
  const [cartoes, setCartoes] = useState([]);
  const [cartaoMovimentos, setCartaoMovimentos] = useState([]);
  const [syncLogs, setSyncLogs] = useState([]);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dashboardRefMonth, setDashboardRefMonth] = useState(currentMonthKey());
  const [projectionRefMonth, setProjectionRefMonth] = useState(currentMonthKey());
  const [reportRefMonth, setReportRefMonth] = useState(currentMonthKey());
  const [cardMovFilterMonth, setCardMovFilterMonth] = useState(currentMonthKey());
  const [cardMovFilterCardId, setCardMovFilterCardId] = useState("todos");

  const [lancamentoForm, setLancamentoForm] = useState({
    data: currentDateYmd(),
    descricao: "",
    categoria: "",
    valor: "",
    tipo: "despesa",
    atribuicao: "WALKER",
    metodo: "pix",
    quem_pagou: "WALKER",
    observacao: ""
  });

  const [cartaoForm, setCartaoForm] = useState({
    nome: "",
    banco: "C6",
    titular: "WALKER",
    final_cartao: "",
    padrao_atribuicao: "AMBOS"
  });

  const [contaFixaForm, setContaFixaForm] = useState({
    nome: "",
    dia_vencimento: "5",
    valor_previsto: "",
    categoria: "",
    atribuicao: "AMBOS",
    quem_pagou: "WALKER",
    avisar_dias_antes: "5,2"
  });

  const [categoriaForm, setCategoriaForm] = useState({
    nome: "",
    slug: "",
    ordem: "",
    cor: ""
  });

  const [calendarioForm, setCalendarioForm] = useState({
    mes: String(new Date().getMonth() + 1),
    dia_mes: "",
    evento: "",
    valor_estimado: "",
    categoria: "",
    atribuicao: "AMBOS",
    avisar_dias_antes: "10,5,2",
    observacao: ""
  });

  const [receitaRegraForm, setReceitaRegraForm] = useState({
    chave: "",
    valor: ""
  });

  const [movimentoForm, setMovimentoForm] = useState({
    cartao_id: "",
    data: new Date().toISOString().slice(0, 10),
    descricao: "",
    valor: "",
    atribuicao: "AMBOS"
  });

  const [editingLancamentoId, setEditingLancamentoId] = useState("");
  const [editingContaFixaId, setEditingContaFixaId] = useState("");
  const [editingCategoriaId, setEditingCategoriaId] = useState("");
  const [editingCalendarioId, setEditingCalendarioId] = useState("");
  const [editingReceitaRegraChave, setEditingReceitaRegraChave] = useState("");
  const [editingCartaoId, setEditingCartaoId] = useState("");
  const [editingMovimentoId, setEditingMovimentoId] = useState("");

  const [lancamentoFilterText, setLancamentoFilterText] = useState("");
  const [lancamentoFilterCategoria, setLancamentoFilterCategoria] = useState("todas");
  const [lancamentoSortKey, setLancamentoSortKey] = useState("data");
  const [lancamentoSortDir, setLancamentoSortDir] = useState("desc");
  const [lancamentoPageSize, setLancamentoPageSize] = useState(10);
  const [lancamentoPage, setLancamentoPage] = useState(1);

  const [saldoForm, setSaldoForm] = useState({
    mes: currentMonthKey(),
    saldoBB: "",
    saldoC6: "",
    saldoCarteira: ""
  });
  const [saldoResult, setSaldoResult] = useState(null);
  const [categoriaNormalizePreview, setCategoriaNormalizePreview] = useState(null);
  const [categoriaNormalizeRunResult, setCategoriaNormalizeRunResult] = useState(null);
  const [importMetadata, setImportMetadata] = useState(null);
  const [importPayloadText, setImportPayloadText] = useState(
    JSON.stringify(
      {
        sourceSheet: "2026",
        tipo: "despesa",
        year: 2026,
        monthStartCol: 2,
        startRow: 17,
        endRow: 300,
        skipMonthsAlreadyImported: true,
        onlyNegative: false,
        mapping: { descricaoCol: 1, valorCol: 2, diaCol: 3 },
        defaults: { metodo: "pix", quem_pagou: "WALKER", atribuicao: "WALKER", categoria: "SEM_CATEGORIA" }
      },
      null,
      2
    )
  );
  const [importPreviewResult, setImportPreviewResult] = useState(null);
  const [importRunResult, setImportRunResult] = useState(null);
  const [cardImportPayloadText, setCardImportPayloadText] = useState(
    JSON.stringify(
      {
        cartao_id: "",
        mes_ref: currentMonthKey(),
        lines: [{ data: `${currentMonthKey()}-01`, descricao: "COMPRA EXEMPLO", valor: 10.5 }]
      },
      null,
      2
    )
  );
  const [cardImportPreviewResult, setCardImportPreviewResult] = useState(null);
  const [cardImportRunResult, setCardImportRunResult] = useState(null);
  const [cardGerarPayloadText, setCardGerarPayloadText] = useState(
    JSON.stringify(
      {
        mes: currentMonthKey(),
        banco: "C6",
        quem_pagou: "WALKER",
        categoria: "CARTAO_CREDITO",
        dryRun: true
      },
      null,
      2
    )
  );
  const [cardGerarResult, setCardGerarResult] = useState(null);
  const [cardTotalizadoresQueryText, setCardTotalizadoresQueryText] = useState(
    JSON.stringify({ mes: currentMonthKey(), banco: "C6" }, null, 2)
  );
  const [cardTotalizadoresResult, setCardTotalizadoresResult] = useState(null);
  const [syncHealthResult, setSyncHealthResult] = useState(null);

  const loadingBootstrap = busyAction === "bootstrap";
  const loadingSync = busyAction === "sync";
  const loadingRefresh = busyAction === "refresh";
  const loadingSaveSaldo = busyAction === "save_saldo";
  const loadingCategoriaNormalizePreview = busyAction === "categoria_normalize_preview";
  const loadingCategoriaNormalizeRun = busyAction === "categoria_normalize_run";
  const loadingImportMetadata = busyAction === "import_metadata";
  const loadingImportPreview = busyAction === "import_preview";
  const loadingImportRun = busyAction === "import_run";
  const loadingCardImportPreview = busyAction === "card_import_preview";
  const loadingCardImportRun = busyAction === "card_import_run";
  const loadingCardGerarLancamentos = busyAction === "card_gerar_lancamentos";
  const loadingCardTotalizadores = busyAction === "card_totalizadores";
  const loadingSyncHealth = busyAction === "sync_health";
  const loadingRepairConnection = busyAction === "repair_connection";
  const loadingSaveLancamento = busyAction === "save_lancamento";
  const loadingDeleteLancamento = busyAction === "delete_lancamento";
  const loadingSaveContaFixa = busyAction === "save_conta_fixa";
  const loadingDeleteContaFixa = busyAction === "delete_conta_fixa";
  const loadingSaveCategoria = busyAction === "save_categoria";
  const loadingDeleteCategoria = busyAction === "delete_categoria";
  const loadingSaveCalendario = busyAction === "save_calendario";
  const loadingDeleteCalendario = busyAction === "delete_calendario";
  const loadingSaveReceitaRegra = busyAction === "save_receita_regra";
  const loadingDeleteReceitaRegra = busyAction === "delete_receita_regra";
  const loadingClearSyncLogs = busyAction === "clear_sync_logs";
  const loadingSaveCartao = busyAction === "save_cartao";
  const loadingDeleteCartao = busyAction === "delete_cartao";
  const loadingSaveMovimento = busyAction === "save_movimento";

  const counts = summary?.counts ?? {};
  const pendingOps = summary?.pending_ops ?? 0;
  const syncState = summary?.sync_state ?? null;
  const syncBadge = syncState?.last_sync_status ?? "idle";
  const showInicio = activeTab === "inicio";
  const showLancar = activeTab === "lancar";
  const showCartoes = activeTab === "cartoes";
  const showMais = activeTab === "mais";
  const showMaisRelatorios = activeTab === "mais" && moreSection === "relatorios";
  const showMaisCategorias = activeTab === "mais" && moreSection === "categorias";
  const showMaisContas = activeTab === "mais" && moreSection === "contas";
  const showMaisSync = activeTab === "mais" && moreSection === "sync";
  const sectionLabel = MORE_SECTIONS.find((item) => item.key === moreSection)?.label ?? "Mais";
  const titleByTab = showMais
    ? sectionLabel
    : activeTab === "inicio"
      ? "Inicio"
      : activeTab === "cartoes"
        ? "Cartoes"
        : "Lancar";
  const subtitleByTab = showMais
    ? "Area complementar (equivalente ao menu Mais da web)"
    : activeTab === "inicio"
      ? "Visao geral, saldo e operacao offline"
      : activeTab === "cartoes"
        ? "Gestao local de cartoes e compras"
        : "Cadastro e lista de lancamentos";

  function cardStyle(visible) {
    return [styles.card, visible ? null : styles.hidden];
  }

  const cardById = useMemo(() => {
    const map = new Map();
    for (const card of cartoes) {
      map.set(card.id, card);
    }
    return map;
  }, [cartoes]);

  const cartaoMovimentosFiltrados = useMemo(() => {
    return cartaoMovimentos.filter((item) => {
      if (cardMovFilterCardId !== "todos" && item.cartao_id !== cardMovFilterCardId) return false;
      if (cardMovFilterMonth && String(item.data || "").slice(0, 7) !== cardMovFilterMonth) return false;
      return true;
    });
  }, [cartaoMovimentos, cardMovFilterCardId, cardMovFilterMonth]);

  const categoriaOptions = useMemo(() => {
    const active = categorias.filter((item) => item.ativa !== false && String(item.nome ?? "").trim());
    return [...active].sort((a, b) => {
      const orderA = Number.isInteger(a.ordem) ? a.ordem : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isInteger(b.ordem) ? b.ordem : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.nome ?? "").localeCompare(String(b.nome ?? ""));
    });
  }, [categorias]);

  const calendarioOrdenado = useMemo(() => {
    return [...calendarioAnual].sort((a, b) => {
      const mesA = Number(a.mes ?? 0);
      const mesB = Number(b.mes ?? 0);
      if (mesA !== mesB) return mesA - mesB;
      const diaA = Number(a.dia_mes ?? 0);
      const diaB = Number(b.dia_mes ?? 0);
      if (diaA !== diaB) return diaA - diaB;
      return String(a.evento ?? "").localeCompare(String(b.evento ?? ""));
    });
  }, [calendarioAnual]);

  const receitasRegrasOrdenadas = useMemo(() => {
    return [...receitasRegras].sort((a, b) => String(a.chave ?? "").localeCompare(String(b.chave ?? "")));
  }, [receitasRegras]);

  const dashboardSnapshot = useMemo(() => {
    return computeMonthlySnapshotLocal(lancamentos, dashboardRefMonth);
  }, [lancamentos, dashboardRefMonth]);

  const balanceSnapshot = useMemo(() => {
    const monthRows = lancamentos.filter((item) => String(item?.data || "").slice(0, 7) === dashboardRefMonth);
    const receitas = monthRows
      .filter((item) => item.tipo === "receita")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const pagamentosWalker = monthRows
      .filter((item) => item.tipo === "despesa" && item.quem_pagou === "WALKER")
      .reduce((acc, item) => acc + Number(item.valor || 0), 0);
    const balancoSistema = receitas - pagamentosWalker;
    const saldoBB = saldoResult ? Number(saldoResult.saldoBB || 0) : parseNumberInput(saldoForm.saldoBB);
    const saldoC6 = saldoResult ? Number(saldoResult.saldoC6 || 0) : parseNumberInput(saldoForm.saldoC6);
    const saldoCarteira = saldoResult ? Number(saldoResult.saldoCarteira || 0) : parseNumberInput(saldoForm.saldoCarteira);
    const balancoReal = saldoBB + saldoC6 + saldoCarteira;
    const diferencaBalanco = balancoReal - balancoSistema;
    return {
      balancoSistema,
      balancoReal,
      diferencaBalanco
    };
  }, [lancamentos, dashboardRefMonth, saldoForm.saldoBB, saldoForm.saldoC6, saldoForm.saldoCarteira, saldoResult]);

  const projection90 = useMemo(() => {
    const fromDate = getMonthStartFromMonthKey(projectionRefMonth);
    if (!fromDate) return null;
    return computeProjection90DaysLocal({
      lancamentos,
      contasFixas,
      fromDate
    });
  }, [lancamentos, contasFixas, projectionRefMonth]);

  const reportLocal = useMemo(() => {
    return computeRelatorioMensalLocal(reportRefMonth, lancamentos, cartaoMovimentos);
  }, [reportRefMonth, lancamentos, cartaoMovimentos]);

  const reportParcelasDetalheLocal = useMemo(() => {
    return computeParcelasDetalheLocal(reportRefMonth, lancamentos, cartaoMovimentos);
  }, [reportRefMonth, lancamentos, cartaoMovimentos]);

  const comparativoMensal = useMemo(() => {
    return computeComparativoMensalLocal({
      referenceMonth: reportRefMonth,
      windowSize: 12,
      lancamentos,
      cartaoMovimentos
    });
  }, [reportRefMonth, lancamentos, cartaoMovimentos]);

  const lancamentoCategorias = useMemo(() => {
    return Array.from(new Set(lancamentos.map((item) => String(item?.categoria || "").trim()).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [lancamentos]);

  const lancamentosFiltrados = useMemo(() => {
    const query = lancamentoFilterText.trim().toLowerCase();
    return lancamentos.filter((item) => {
      if (lancamentoFilterCategoria !== "todas" && item.categoria !== lancamentoFilterCategoria) return false;
      if (!query) return true;
      const haystack = [
        String(item.descricao || ""),
        String(item.categoria || ""),
        String(item.observacao || ""),
        String(item.tipo || "")
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [lancamentos, lancamentoFilterText, lancamentoFilterCategoria]);

  const lancamentosOrdenados = useMemo(() => {
    const items = [...lancamentosFiltrados];
    items.sort((a, b) => {
      let av = 0;
      let bv = 0;
      if (lancamentoSortKey === "valor") {
        av = Number(a.valor || 0);
        bv = Number(b.valor || 0);
      } else {
        const as = String(a[lancamentoSortKey] ?? "");
        const bs = String(b[lancamentoSortKey] ?? "");
        if (as < bs) return lancamentoSortDir === "asc" ? -1 : 1;
        if (as > bs) return lancamentoSortDir === "asc" ? 1 : -1;
        return 0;
      }
      if (av === bv) return 0;
      return lancamentoSortDir === "asc" ? av - bv : bv - av;
    });
    return items;
  }, [lancamentosFiltrados, lancamentoSortKey, lancamentoSortDir]);

  const lancamentoTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(lancamentosOrdenados.length / lancamentoPageSize));
  }, [lancamentosOrdenados.length, lancamentoPageSize]);

  const lancamentosPaginados = useMemo(() => {
    const page = Math.min(Math.max(lancamentoPage, 1), lancamentoTotalPages);
    const start = (page - 1) * lancamentoPageSize;
    return lancamentosOrdenados.slice(start, start + lancamentoPageSize);
  }, [lancamentosOrdenados, lancamentoPage, lancamentoPageSize, lancamentoTotalPages]);

  const refreshSummary = useCallback(async () => {
    await initDb();
    const nextSummary = await getLocalSummary();
    setSummary(nextSummary);
  }, []);

  const refreshLancamentos = useCallback(async () => {
    await initDb();
    const rows = await listEntityRows("lancamentos", { limit: 1000 });
    setLancamentos(rows);
  }, []);

  const refreshContasFixas = useCallback(async () => {
    await initDb();
    const rows = await listEntityRows("contas_fixas", { limit: 20 });
    setContasFixas(rows);
  }, []);

  const refreshCategorias = useCallback(async () => {
    await initDb();
    const rows = await listEntityRows("categorias", { limit: 120 });
    setCategorias(rows);
  }, []);

  const refreshReceitasRegras = useCallback(async () => {
    await initDb();
    const rows = await listEntityRows("receitas_regras", { limit: 120 });
    setReceitasRegras(rows);
  }, []);

  const refreshCalendarioAnual = useCallback(async () => {
    await initDb();
    const rows = await listEntityRows("calendario_anual", { limit: 120 });
    setCalendarioAnual(rows);
  }, []);

  const refreshCartoes = useCallback(async () => {
    await initDb();
    const [cards, movimentos] = await Promise.all([
      listEntityRows("cartoes", { limit: 20 }),
      listEntityRows("cartao_movimentos", { limit: 20 })
    ]);
    setCartoes(cards);
    setCartaoMovimentos(movimentos);
  }, []);

  const refreshSyncLogs = useCallback(async () => {
    await initDb();
    const rows = await listSyncLogs({ limit: 60 });
    setSyncLogs(rows);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshSummary(),
      refreshLancamentos(),
      refreshContasFixas(),
      refreshCategorias(),
      refreshReceitasRegras(),
      refreshCalendarioAnual(),
      refreshCartoes(),
      refreshSyncLogs()
    ]);
  }, [
    refreshSummary,
    refreshLancamentos,
    refreshContasFixas,
    refreshCategorias,
    refreshReceitasRegras,
    refreshCalendarioAnual,
    refreshCartoes,
    refreshSyncLogs
  ]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (lancamentoPage > lancamentoTotalPages) {
      setLancamentoPage(lancamentoTotalPages);
    }
  }, [lancamentoPage, lancamentoTotalPages]);

  useEffect(() => {
    if (activeTab !== "mais") {
      setMoreMenuOpen(false);
    }
  }, [activeTab]);

  async function runAction(action, callback) {
    setBusyAction(action);
    setError("");
    setMessage("");
    try {
      await callback();
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Falha na operacao.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleBootstrap() {
    await runAction("bootstrap", async () => {
      const payload = await bootstrapNow(baseUrl, { includeInactiveCategories: true });
      await refreshAll();
      setMessage(
        `Bootstrap concluido. Lancamentos: ${payload.counts.lancamentos} | Cartoes: ${payload.counts.cartoes}`
      );
    });
  }

  async function handleSync() {
    await runAction("sync", async () => {
      const result = await syncNow(baseUrl);
      await refreshAll();
      setMessage(`Sync concluido. Operacoes enviadas: ${result.pushed}.`);
    });
  }

  async function handleRefresh() {
    await runAction("refresh", async () => {
      await refreshAll();
      setMessage("Resumo local atualizado.");
    });
  }

  async function handleSaveLancamento() {
    await runAction("save_lancamento", async () => {
      const observacao = [String(lancamentoForm.observacao || "").trim(), "[NATIVE_LOCAL]"]
        .filter((item) => item.length > 0)
        .join(" ");
      const payload = {
        data: lancamentoForm.data,
        descricao: lancamentoForm.descricao,
        categoria: lancamentoForm.categoria,
        valor: lancamentoForm.valor,
        observacao,
        tipo: lancamentoForm.tipo,
        atribuicao: lancamentoForm.atribuicao,
        metodo: lancamentoForm.metodo,
        quem_pagou: lancamentoForm.quem_pagou
      };
      const saved = editingLancamentoId
        ? await updateLancamentoLocal(editingLancamentoId, payload)
        : await createLancamentoLocal(payload);
      await refreshAll();
      setLancamentoForm((prev) => ({
        ...prev,
        data: currentDateYmd(),
        descricao: "",
        categoria: "",
        valor: "",
        observacao: ""
      }));
      setEditingLancamentoId("");
      setMessage(
        editingLancamentoId
          ? `Lancamento local atualizado e enfileirado: ${saved.id}`
          : `Lancamento local salvo e enfileirado: ${saved.id}`
      );
    });
  }

  async function handleDeleteLancamento(id) {
    await runAction("delete_lancamento", async () => {
      await deleteLancamentoLocal(id);
      await refreshAll();
      if (editingLancamentoId === id) {
        setEditingLancamentoId("");
      }
      setMessage(`Lancamento removido localmente: ${id}`);
    });
  }

  async function handleSaveContaFixa() {
    await runAction("save_conta_fixa", async () => {
      const saved = editingContaFixaId
        ? await updateContaFixaLocal(editingContaFixaId, contaFixaForm)
        : await createContaFixaLocal(contaFixaForm);
      await refreshAll();
      setContaFixaForm((prev) => ({
        ...prev,
        nome: "",
        valor_previsto: "",
        categoria: ""
      }));
      setEditingContaFixaId("");
      setMessage(
        editingContaFixaId
          ? `Conta fixa local atualizada e enfileirada: ${saved.nome}`
          : `Conta fixa local salva e enfileirada: ${saved.nome}`
      );
    });
  }

  async function handleDeleteContaFixa(id) {
    await runAction("delete_conta_fixa", async () => {
      await deleteContaFixaLocal(id);
      await refreshAll();
      if (editingContaFixaId === id) {
        setEditingContaFixaId("");
      }
      setMessage(`Conta fixa removida localmente: ${id}`);
    });
  }

  async function handleSaveCategoria() {
    await runAction("save_categoria", async () => {
      const saved = editingCategoriaId
        ? await updateCategoriaLocal(editingCategoriaId, categoriaForm)
        : await createCategoriaLocal(categoriaForm);
      await refreshAll();
      setCategoriaForm({
        nome: "",
        slug: "",
        ordem: "",
        cor: ""
      });
      setEditingCategoriaId("");
      setMessage(
        editingCategoriaId
          ? `Categoria local atualizada e enfileirada: ${saved.nome}`
          : `Categoria local salva e enfileirada: ${saved.nome}`
      );
    });
  }

  async function handleDeleteCategoria(id, nome) {
    await runAction("delete_categoria", async () => {
      await deleteCategoriaLocal(id);
      await refreshAll();
      if (editingCategoriaId === id) {
        setEditingCategoriaId("");
      }
      setLancamentoForm((prev) => ({
        ...prev,
        categoria: prev.categoria === nome ? "" : prev.categoria
      }));
      setContaFixaForm((prev) => ({
        ...prev,
        categoria: prev.categoria === nome ? "" : prev.categoria
      }));
      setMessage(`Categoria removida localmente: ${nome}`);
    });
  }

  async function handleToggleCategoriaAtiva(item) {
    await runAction("save_categoria", async () => {
      const next = await updateCategoriaLocal(item.id, { ativa: !(item.ativa !== false) });
      await refreshAll();
      setMessage(next.ativa ? `Categoria reativada: ${next.nome}` : `Categoria desativada: ${next.nome}`);
    });
  }

  async function handleSaveCalendario() {
    await runAction("save_calendario", async () => {
      const saved = editingCalendarioId
        ? await updateCalendarioAnualLocal(editingCalendarioId, calendarioForm)
        : await createCalendarioAnualLocal(calendarioForm);
      await refreshAll();
      setCalendarioForm((prev) => ({
        ...prev,
        dia_mes: "",
        evento: "",
        valor_estimado: "",
        categoria: "",
        observacao: ""
      }));
      setEditingCalendarioId("");
      setMessage(
        editingCalendarioId
          ? `Evento sazonal local atualizado e enfileirado: ${saved.evento}`
          : `Evento sazonal local salvo e enfileirado: ${saved.evento}`
      );
    });
  }

  async function handleDeleteCalendario(id, evento) {
    await runAction("delete_calendario", async () => {
      await deleteCalendarioAnualLocal(id);
      await refreshAll();
      if (editingCalendarioId === id) {
        setEditingCalendarioId("");
      }
      setMessage(`Evento sazonal removido localmente: ${evento}`);
    });
  }

  async function handleSaveReceitaRegra() {
    await runAction("save_receita_regra", async () => {
      const saved = editingReceitaRegraChave
        ? await updateReceitaRegraLocal(editingReceitaRegraChave, receitaRegraForm)
        : await createReceitaRegraLocal(receitaRegraForm);
      await refreshAll();
      setReceitaRegraForm((prev) => ({
        ...prev,
        chave: "",
        valor: ""
      }));
      setEditingReceitaRegraChave("");
      setMessage(
        editingReceitaRegraChave
          ? `Regra de receita atualizada localmente: ${saved.chave}`
          : `Regra de receita salva localmente: ${saved.chave}`
      );
    });
  }

  async function handleDeleteReceitaRegra(chave) {
    await runAction("delete_receita_regra", async () => {
      await deleteReceitaRegraLocal(chave);
      await refreshAll();
      if (editingReceitaRegraChave === chave) {
        setEditingReceitaRegraChave("");
      }
      setMessage(`Regra de receita removida localmente: ${chave}`);
    });
  }

  async function handleClearSyncLogs() {
    await runAction("clear_sync_logs", async () => {
      await clearSyncLogs();
      await refreshAll();
      setMessage("Historico de sincronizacao limpo.");
    });
  }

  async function handleSaveCartao() {
    await runAction("save_cartao", async () => {
      const saved = editingCartaoId
        ? await updateCartaoLocal(editingCartaoId, cartaoForm)
        : await createCartaoLocal(cartaoForm);
      await refreshAll();
      setCartaoForm((prev) => ({
        ...prev,
        nome: "",
        final_cartao: ""
      }));
      setMovimentoForm((prev) => ({
        ...prev,
        cartao_id: prev.cartao_id || saved.id,
        atribuicao: saved.padrao_atribuicao
      }));
      setEditingCartaoId("");
      setMessage(
        editingCartaoId
          ? `Cartao local atualizado e enfileirado: ${saved.nome}`
          : `Cartao local salvo e enfileirado: ${saved.nome}`
      );
    });
  }

  async function handleDeleteCartao(cardId) {
    await runAction("delete_cartao", async () => {
      await deleteCartaoLocal(cardId);
      await refreshAll();
      if (editingCartaoId === cardId) {
        setEditingCartaoId("");
      }
      setMovimentoForm((prev) => ({
        ...prev,
        cartao_id: prev.cartao_id === cardId ? "" : prev.cartao_id
      }));
      setMessage(`Cartao removido localmente: ${cardId}`);
    });
  }

  async function handleSaveMovimento() {
    await runAction("save_movimento", async () => {
      const payload = {
        cartao_id: movimentoForm.cartao_id,
        data: movimentoForm.data,
        descricao: movimentoForm.descricao,
        valor: movimentoForm.valor,
        atribuicao: movimentoForm.atribuicao,
        observacao: "[NATIVE_LOCAL_CARTAO]"
      };
      const saved = editingMovimentoId
        ? await updateCartaoMovimentoLocal(editingMovimentoId, payload)
        : await createCartaoMovimentoLocal(payload);
      await refreshAll();
      setMovimentoForm((prev) => ({
        ...prev,
        descricao: "",
        valor: ""
      }));
      setEditingMovimentoId("");
      setMessage(
        editingMovimentoId
          ? `Compra de cartao atualizada localmente: ${saved.id}`
          : `Compra de cartao salva localmente: ${saved.id}`
      );
    });
  }

  async function handleClassifyMovimento(id, atribuicao) {
    await runAction("classify_movimento", async () => {
      await classifyCartaoMovimentoLocal(id, atribuicao);
      await refreshAll();
      setMessage(`Compra classificada localmente: ${id}`);
    });
  }

  async function handleDeleteMovimento(id) {
    await runAction("delete_movimento", async () => {
      await deleteCartaoMovimentoLocal(id);
      await refreshAll();
      if (editingMovimentoId === id) {
        setEditingMovimentoId("");
      }
      setMessage(`Compra removida localmente: ${id}`);
    });
  }

  async function handleSaveSaldoReal() {
    await runAction("save_saldo", async () => {
      const payload = {
        mes: saldoForm.mes,
        saldoBB: parseNumberInput(saldoForm.saldoBB),
        saldoC6: parseNumberInput(saldoForm.saldoC6),
        saldoCarteira: parseNumberInput(saldoForm.saldoCarteira)
      };
      const response = await postJson(baseUrl, "/api/dashboard/saldo", payload);
      setSaldoResult(response?.data ?? null);
      setMessage(`Saldo real sincronizado para ${payload.mes}.`);
    });
  }

  async function handleCategoriaNormalizePreview() {
    await runAction("categoria_normalize_preview", async () => {
      const response = await getJson(baseUrl, "/api/categorias/normalizar/preview");
      setCategoriaNormalizePreview(response?.data ?? null);
      setMessage("Preview de normalizacao de categorias carregado.");
    });
  }

  async function handleCategoriaNormalizeRun() {
    await runAction("categoria_normalize_run", async () => {
      const response = await postJson(baseUrl, "/api/categorias/normalizar/run", { reativarInativas: true });
      setCategoriaNormalizeRunResult(response?.data ?? null);
      await refreshAll();
      setMessage("Normalizacao de categorias executada.");
    });
  }

  async function handleImportMetadata() {
    await runAction("import_metadata", async () => {
      const response = await getJson(baseUrl, "/api/importar/metadata");
      setImportMetadata(response?.data ?? null);
      setMessage("Metadata do importador carregada.");
    });
  }

  async function handleImportPreview() {
    await runAction("import_preview", async () => {
      const payload = parseJsonInput(importPayloadText, "import_preview");
      const response = await postJson(baseUrl, "/api/importar/preview", payload);
      setImportPreviewResult(response?.data ?? null);
      setMessage("Preview de importacao gerado.");
    });
  }

  async function handleImportRun() {
    await runAction("import_run", async () => {
      const payload = parseJsonInput(importPayloadText, "import_run");
      const response = await postJson(baseUrl, "/api/importar/run", {
        ...payload,
        dryRun: false
      });
      setImportRunResult(response?.data ?? null);
      await refreshAll();
      setMessage("Importacao executada.");
    });
  }

  async function handleCardImportPreview() {
    await runAction("card_import_preview", async () => {
      const payload = parseJsonInput(cardImportPayloadText, "cartoes_import_preview");
      const response = await postJson(baseUrl, "/api/cartoes/importar/preview", payload);
      setCardImportPreviewResult(response?.data ?? null);
      setMessage("Preview de importacao de cartao gerado.");
    });
  }

  async function handleCardImportRun() {
    await runAction("card_import_run", async () => {
      const payload = parseJsonInput(cardImportPayloadText, "cartoes_import_run");
      const response = await postJson(baseUrl, "/api/cartoes/importar/run", {
        ...payload,
        dryRun: false
      });
      setCardImportRunResult(response?.data ?? null);
      await refreshAll();
      setMessage("Importacao de cartao executada.");
    });
  }

  async function handleCardGerarLancamentos() {
    await runAction("card_gerar_lancamentos", async () => {
      const payload = parseJsonInput(cardGerarPayloadText, "cartoes_gerar_lancamentos");
      const response = await postJson(baseUrl, "/api/cartoes/gerar-lancamentos", payload);
      setCardGerarResult(response?.data ?? null);
      await refreshAll();
      setMessage("Geracao de lancamentos de cartao executada.");
    });
  }

  async function handleCardTotalizadores() {
    await runAction("card_totalizadores", async () => {
      const query = parseJsonInput(cardTotalizadoresQueryText, "cartoes_totalizadores");
      const params = new URLSearchParams();
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") return;
        params.set(key, String(value));
      });
      const response = await getJson(baseUrl, `/api/cartoes/totalizadores?${params.toString()}`);
      setCardTotalizadoresResult(response?.data ?? null);
      setMessage("Totalizadores de cartao carregados.");
    });
  }

  async function handleRepairConnection() {
    await runAction("repair_connection", async () => {
      const response = await postJson(baseUrl, "/api/bootstrap", {});
      await refreshAll();
      setMessage(response?.message ?? "Conexao reparada.");
    });
  }

  async function handleSyncHealth() {
    await runAction("sync_health", async () => {
      const response = await getJson(baseUrl, "/api/sync/health");
      setSyncHealthResult(response?.data ?? response ?? null);
      setMessage("Sync health carregado.");
    });
  }

  function startEditLancamento(item) {
    setEditingLancamentoId(item.id);
    setLancamentoForm({
      data: item.data ?? currentDateYmd(),
      descricao: item.descricao ?? "",
      categoria: item.categoria ?? "",
      valor: formatMoney(item.valor ?? 0),
      tipo: item.tipo ?? "despesa",
      atribuicao: item.atribuicao ?? "WALKER",
      metodo: item.metodo ?? "pix",
      quem_pagou: item.quem_pagou ?? "WALKER",
      observacao: String(item.observacao ?? "").replace("[NATIVE_LOCAL]", "").trim()
    });
  }

  function startEditContaFixa(item) {
    setEditingContaFixaId(item.id);
    setContaFixaForm({
      nome: item.nome ?? "",
      dia_vencimento: String(item.dia_vencimento ?? "5"),
      valor_previsto: item.valor_previsto == null ? "" : formatMoney(item.valor_previsto),
      categoria: item.categoria ?? "",
      atribuicao: item.atribuicao ?? "AMBOS",
      quem_pagou: item.quem_pagou ?? "WALKER",
      avisar_dias_antes: item.avisar_dias_antes ?? "5,2"
    });
  }

  function startEditCategoria(item) {
    setEditingCategoriaId(item.id);
    setCategoriaForm({
      nome: item.nome ?? "",
      slug: item.slug ?? "",
      ordem: item.ordem == null ? "" : String(item.ordem),
      cor: item.cor ?? ""
    });
  }

  function startEditReceitaRegra(item) {
    setEditingReceitaRegraChave(item.chave);
    setReceitaRegraForm({
      chave: item.chave ?? "",
      valor: item.valor ?? ""
    });
  }

  function startEditCalendario(item) {
    setEditingCalendarioId(item.id);
    setCalendarioForm({
      mes: String(item.mes ?? ""),
      dia_mes: item.dia_mes == null ? "" : String(item.dia_mes),
      evento: item.evento ?? "",
      valor_estimado: formatMoney(item.valor_estimado ?? 0),
      categoria: item.categoria ?? "",
      atribuicao: item.atribuicao ?? "AMBOS",
      avisar_dias_antes: item.avisar_dias_antes ?? "10,5,2",
      observacao: item.observacao ?? ""
    });
  }

  function startEditCartao(item) {
    setEditingCartaoId(item.id);
    setCartaoForm({
      nome: item.nome ?? "",
      banco: item.banco ?? "C6",
      titular: item.titular ?? "WALKER",
      final_cartao: item.final_cartao ?? "",
      padrao_atribuicao: item.padrao_atribuicao ?? "AMBOS"
    });
  }

  function startEditMovimento(item) {
    const atribuicao = item.alocacoes?.[0]?.atribuicao ?? movimentoForm.atribuicao;
    setEditingMovimentoId(item.id);
    setMovimentoForm({
      cartao_id: item.cartao_id ?? "",
      data: item.data ?? currentDateYmd(),
      descricao: item.descricao ?? "",
      valor: formatMoney(item.valor ?? 0),
      atribuicao
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <Text style={styles.topBrand}>FinancasG</Text>
      </View>

      {moreMenuOpen ? (
        <TouchableOpacity style={styles.moreOverlay} onPress={() => setMoreMenuOpen(false)} activeOpacity={1} />
      ) : null}

      {moreMenuOpen ? (
        <View style={styles.moreMenu}>
          {MORE_SECTIONS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.moreMenuItem}
              onPress={() => {
                setActiveTab("mais");
                setMoreSection(item.key);
                setMoreMenuOpen(false);
              }}
            >
              <Text style={styles.moreMenuItemText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>{titleByTab}</Text>
        <Text style={styles.subtitle}>{subtitleByTab}</Text>

        {showMais ? (
          <View style={styles.moreSectionRow}>
            {MORE_SECTIONS.map((item) => (
              <OptionChip
                key={item.key}
                label={item.label}
                selected={moreSection === item.key}
                onPress={() => setMoreSection(item.key)}
              />
            ))}
          </View>
        ) : null}

        <View style={cardStyle(showInicio || showMaisSync)}>
          <Text style={styles.label}>Backend URL</Text>
          <TextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="http://192.168.x.x:3000"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.hint}>Use o IP LAN do servidor Next.js.</Text>
        </View>

        <View style={cardStyle(showInicio)}>
          <Text style={styles.sectionTitle}>Acoes gerais</Text>
          <ActionButton
            label="Bootstrap completo"
            onPress={handleBootstrap}
            busy={loadingBootstrap}
            disabled={Boolean(busyAction)}
          />
          <ActionButton
            label="Sincronizar fila"
            onPress={handleSync}
            busy={loadingSync}
            disabled={Boolean(busyAction)}
          />
          <ActionButton
            label="Atualizar resumo local"
            onPress={handleRefresh}
            busy={loadingRefresh}
            disabled={Boolean(busyAction)}
          />
        </View>

        <View style={cardStyle(showInicio)}>
          <Text style={styles.sectionTitle}>Saldo real (legacy)</Text>
          <TextInput
            value={saldoForm.mes}
            onChangeText={(value) => setSaldoForm((prev) => ({ ...prev, mes: value }))}
            style={styles.input}
            placeholder="Mes (YYYY-MM)"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={saldoForm.saldoBB}
            onChangeText={(value) => setSaldoForm((prev) => ({ ...prev, saldoBB: value }))}
            style={styles.input}
            placeholder="Saldo BB"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={saldoForm.saldoC6}
            onChangeText={(value) => setSaldoForm((prev) => ({ ...prev, saldoC6: value }))}
            style={styles.input}
            placeholder="Saldo C6"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={saldoForm.saldoCarteira}
            onChangeText={(value) => setSaldoForm((prev) => ({ ...prev, saldoCarteira: value }))}
            style={styles.input}
            placeholder="Saldo carteira"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <ActionButton
            label="Sincronizar saldo"
            onPress={handleSaveSaldoReal}
            busy={loadingSaveSaldo}
            disabled={Boolean(busyAction)}
          />
          {saldoResult ? (
            <Text style={styles.hint}>
              Banco: R$ {formatMoney(saldoResult.saldoBanco)} | Carteira: R$ {formatMoney(saldoResult.saldoCarteira)}
            </Text>
          ) : null}
        </View>

        <View style={cardStyle(showMaisSync)}>
          <Text style={styles.sectionTitle}>Ferramentas online (paridade main)</Text>
          <ActionButton
            label="Reparar conexao"
            onPress={handleRepairConnection}
            busy={loadingRepairConnection}
            disabled={Boolean(busyAction)}
          />
          <ActionButton
            label="Sync health"
            onPress={handleSyncHealth}
            busy={loadingSyncHealth}
            disabled={Boolean(busyAction)}
          />
          {syncHealthResult ? <Text style={styles.hint}>Health: {JSON.stringify(syncHealthResult)}</Text> : null}

          <Text style={styles.label}>Categorias: normalizacao</Text>
          <View style={styles.inlineActions}>
            <ActionButton
              label="Preview normalizacao"
              onPress={handleCategoriaNormalizePreview}
              busy={loadingCategoriaNormalizePreview}
              disabled={Boolean(busyAction)}
            />
            <ActionButton
              label="Executar normalizacao"
              onPress={handleCategoriaNormalizeRun}
              busy={loadingCategoriaNormalizeRun}
              disabled={Boolean(busyAction)}
            />
          </View>
          {categoriaNormalizePreview ? (
            <Text style={styles.hint}>
              Em uso: {categoriaNormalizePreview.summary?.totalCategoriasEmUso ?? 0} | Faltantes:{" "}
              {categoriaNormalizePreview.summary?.missing ?? 0} | Inativas:{" "}
              {categoriaNormalizePreview.summary?.existingInactive ?? 0}
            </Text>
          ) : null}
          {categoriaNormalizeRunResult ? (
            <Text style={styles.hint}>
              Criadas: {categoriaNormalizeRunResult.created ?? 0} | Reativadas: {categoriaNormalizeRunResult.reativadas ?? 0}
            </Text>
          ) : null}

          <Text style={styles.label}>Importador historico</Text>
          <ActionButton
            label="Carregar metadata"
            onPress={handleImportMetadata}
            busy={loadingImportMetadata}
            disabled={Boolean(busyAction)}
          />
          {importMetadata ? (
            <Text style={styles.hint}>
              Abas: {Array.isArray(importMetadata.sheetNames) ? importMetadata.sheetNames.length : 0} | Legado:{" "}
              {Array.isArray(importMetadata.legacyCandidates) ? importMetadata.legacyCandidates.length : 0}
            </Text>
          ) : null}
          <TextInput
            value={importPayloadText}
            onChangeText={setImportPayloadText}
            style={[styles.input, styles.inputMultiline]}
            placeholder="JSON /api/importar/preview|run"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
          />
          <View style={styles.inlineActions}>
            <ActionButton
              label="Preview importar"
              onPress={handleImportPreview}
              busy={loadingImportPreview}
              disabled={Boolean(busyAction)}
            />
            <ActionButton
              label="Executar importar"
              onPress={handleImportRun}
              busy={loadingImportRun}
              disabled={Boolean(busyAction)}
            />
          </View>
          {importPreviewResult ? (
            <Text style={styles.hint}>
              Preview total: {importPreviewResult.totalCount ?? 0} | Importavel: {importPreviewResult.importableCount ?? 0}
            </Text>
          ) : null}
          {importRunResult ? (
            <Text style={styles.hint}>
              Importados: {importRunResult.imported ?? 0} | Preview: {importRunResult.previewCount ?? 0}
            </Text>
          ) : null}

          <Text style={styles.label}>Cartoes: importar fatura e gerar lancamentos</Text>
          <TextInput
            value={cardImportPayloadText}
            onChangeText={setCardImportPayloadText}
            style={[styles.input, styles.inputMultiline]}
            placeholder="JSON /api/cartoes/importar/preview|run"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
          />
          <View style={styles.inlineActions}>
            <ActionButton
              label="Preview cartao"
              onPress={handleCardImportPreview}
              busy={loadingCardImportPreview}
              disabled={Boolean(busyAction)}
            />
            <ActionButton
              label="Executar cartao"
              onPress={handleCardImportRun}
              busy={loadingCardImportRun}
              disabled={Boolean(busyAction)}
            />
          </View>
          {cardImportPreviewResult ? (
            <Text style={styles.hint}>
              Cartao preview: total {cardImportPreviewResult.total ?? 0} | novos {cardImportPreviewResult.novos ?? 0}
            </Text>
          ) : null}
          {cardImportRunResult ? (
            <Text style={styles.hint}>
              Cartao run: importados {cardImportRunResult.importados ?? 0} | pendentes {cardImportRunResult.pendentesClassificacao ?? 0}
            </Text>
          ) : null}

          <TextInput
            value={cardGerarPayloadText}
            onChangeText={setCardGerarPayloadText}
            style={[styles.input, styles.inputMultiline]}
            placeholder="JSON /api/cartoes/gerar-lancamentos"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
          />
          <ActionButton
            label="Gerar lancamentos cartao"
            onPress={handleCardGerarLancamentos}
            busy={loadingCardGerarLancamentos}
            disabled={Boolean(busyAction)}
          />
          {cardGerarResult ? (
            <Text style={styles.hint}>
              Gerados: {cardGerarResult.generated ?? 0} | Atualizados: {cardGerarResult.updated ?? 0} | Excluidos:{" "}
              {cardGerarResult.deleted ?? 0}
            </Text>
          ) : null}

          <TextInput
            value={cardTotalizadoresQueryText}
            onChangeText={setCardTotalizadoresQueryText}
            style={[styles.input, styles.inputMultiline]}
            placeholder="JSON query /api/cartoes/totalizadores"
            placeholderTextColor="#6b7280"
            multiline
            textAlignVertical="top"
          />
          <ActionButton
            label="Carregar totalizadores cartao"
            onPress={handleCardTotalizadores}
            busy={loadingCardTotalizadores}
            disabled={Boolean(busyAction)}
          />
          {cardTotalizadoresResult ? (
            <Text style={styles.hint}>
              Banco: {cardTotalizadoresResult.banco ?? "-"} | WALKER: R${" "}
              {formatMoney(cardTotalizadoresResult.porAtribuicao?.WALKER ?? 0)} | AMBOS: R${" "}
              {formatMoney(cardTotalizadoresResult.porAtribuicao?.AMBOS ?? 0)} | DEA: R${" "}
              {formatMoney(cardTotalizadoresResult.porAtribuicao?.DEA ?? 0)} | Pendentes:{" "}
              {cardTotalizadoresResult.pendentes ?? 0}
            </Text>
          ) : null}
        </View>

        <View style={cardStyle(showInicio)}>
          <Text style={styles.sectionTitle}>Dashboard local (offline)</Text>
          <TextInput
            value={dashboardRefMonth}
            onChangeText={setDashboardRefMonth}
            style={styles.input}
            placeholder="Mes referencia (YYYY-MM)"
            placeholderTextColor="#6b7280"
          />
          <CountRow label="mes" value={String(dashboardSnapshot?.mes ?? "-")} />
          <CountRow
            label="receitas_mes"
            value={`R$ ${formatMoney(dashboardSnapshot?.receitasMes ?? 0)}`}
          />
          <CountRow
            label="despesas_mes"
            value={`R$ ${formatMoney(dashboardSnapshot?.despesasMes ?? 0)}`}
          />
          <CountRow label="saldo_mes" value={`R$ ${formatMoney(dashboardSnapshot?.saldoMes ?? 0)}`} />
          <CountRow
            label="saldo_apos_acerto_dea"
            value={`R$ ${formatMoney(dashboardSnapshot?.saldoAposAcertoDEA ?? 0)}`}
          />
          <CountRow
            label="receber_pagar_dea"
            value={`R$ ${formatMoney(dashboardSnapshot?.receberPagarDEA ?? 0)}`}
          />
          <CountRow label="balanco_sistema" value={`R$ ${formatMoney(balanceSnapshot.balancoSistema)}`} />
          <CountRow label="balanco_real" value={`R$ ${formatMoney(balanceSnapshot.balancoReal)}`} />
          <CountRow label="diferenca_balanco" value={`R$ ${formatMoney(balanceSnapshot.diferencaBalanco)}`} />
        </View>

        <View style={cardStyle(showInicio)}>
          <Text style={styles.sectionTitle}>Projecao 90 dias (local)</Text>
          <TextInput
            value={projectionRefMonth}
            onChangeText={setProjectionRefMonth}
            style={styles.input}
            placeholder="Mes base (YYYY-MM)"
            placeholderTextColor="#6b7280"
          />
          {!projection90 ? (
            <Text style={styles.hint}>Informe um mes valido no formato YYYY-MM.</Text>
          ) : (
            <>
              <CountRow
                label="periodo"
                value={`${projection90.periodoInicio} ate ${projection90.periodoFim}`}
              />
              <CountRow
                label="base_ano_anterior"
                value={`${projection90.periodoBaseInicio} ate ${projection90.periodoBaseFim}`}
              />
              <CountRow
                label="receitas_previstas"
                value={`R$ ${formatMoney(projection90.receitasPrevistas)}`}
              />
              <CountRow
                label="despesas_previstas"
                value={`R$ ${formatMoney(projection90.despesasWalkerPrevistas)}`}
              />
              <CountRow
                label="saldo_projetado"
                value={`R$ ${formatMoney(projection90.saldoProjetado)}`}
              />
              <Text style={styles.label}>Despesas por mes</Text>
              {projection90.despesasWalkerPorMes.map((item) => (
                <View key={item.mes} style={styles.countRow}>
                  <Text style={styles.countLabel}>{item.mes}</Text>
                  <Text style={styles.countValue}>R$ {formatMoney(item.total)}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={cardStyle(showMaisRelatorios)}>
          <Text style={styles.sectionTitle}>Relatorio local detalhado</Text>
          <TextInput
            value={reportRefMonth}
            onChangeText={setReportRefMonth}
            style={styles.input}
            placeholder="Mes relatorio (YYYY-MM)"
            placeholderTextColor="#6b7280"
          />
          <CountRow label="receitas" value={`R$ ${formatMoney(reportLocal.receitas)}`} />
          <CountRow label="despesas" value={`R$ ${formatMoney(reportLocal.despesas)}`} />
          <CountRow label="saldo" value={`R$ ${formatMoney(reportLocal.saldo)}`} />
          <CountRow
            label="comprometimento_parcelas"
            value={`${(Number(reportLocal.comprometimentoParcelas || 0) * 100).toFixed(1)}%`}
          />
          <CountRow
            label="walker_final"
            value={`R$ ${formatMoney(reportLocal.totalPorAtribuicao.walkerFinal)}`}
          />
          <CountRow
            label="dea_final"
            value={`R$ ${formatMoney(reportLocal.totalPorAtribuicao.deaFinal)}`}
          />
          <CountRow
            label="receber_pagar_dea"
            value={`R$ ${formatMoney(reportLocal.receberPagarDEA)}`}
          />

          <Text style={styles.label}>Total por categoria</Text>
          {reportLocal.totalPorCategoria.length === 0 ? (
            <Text style={styles.hint}>Sem despesas no mes selecionado.</Text>
          ) : (
            reportLocal.totalPorCategoria.map((item) => (
              <View key={item.categoria} style={styles.countRow}>
                <Text style={styles.countLabel}>{item.categoria}</Text>
                <Text style={styles.countValue}>R$ {formatMoney(item.total)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisRelatorios)}>
          <Text style={styles.sectionTitle}>Parcelas ativas (local)</Text>
          <CountRow
            label="parcelas_mes"
            value={`R$ ${formatMoney(reportParcelasDetalheLocal.totalParcelasMes)}`}
          />
          <CountRow
            label="parcelado_em_aberto"
            value={`R$ ${formatMoney(reportParcelasDetalheLocal.totalParceladoEmAberto)}`}
          />
          {reportParcelasDetalheLocal.compras.length === 0 ? (
            <Text style={styles.hint}>Sem parcelas ativas no mes.</Text>
          ) : (
            reportParcelasDetalheLocal.compras.map((item) => (
              <View key={`${item.origem}-${item.id}`} style={styles.localItemBlock}>
                <Text style={styles.localTitle}>{item.descricao}</Text>
                <Text style={styles.localMeta}>
                  {item.origem === "cartoes" ? "Cartao" : "Lancamento"}
                  {item.cartao ? ` | ${item.cartao}` : ""}
                  {item.categoria ? ` | ${item.categoria}` : ""}
                  {item.estimado ? " | estimado" : ""}
                </Text>
                <Text style={styles.localMeta}>
                  Parcela R$ {formatMoney(item.valorParcela)} | Total R$ {formatMoney(item.valorTotalCompra)}
                </Text>
                <Text style={styles.localMeta}>
                  Pagas {item.pagas}/{item.totalParcelas} | Faltam {item.restantes}
                </Text>
                {item.mesesFuturos.length > 0 ? (
                  <View style={styles.chipRow}>
                    {item.mesesFuturos.slice(0, 6).map((future) => (
                      <Text key={`${item.id}-${future}`} style={styles.monthPill}>
                        {formatMonthShort(future)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisRelatorios)}>
          <Text style={styles.sectionTitle}>Comparativo mensal local (12 meses)</Text>
          <CountRow label="acumulado_receitas" value={`R$ ${formatMoney(comparativoMensal.totals.receitas)}`} />
          <CountRow label="acumulado_despesas" value={`R$ ${formatMoney(comparativoMensal.totals.despesas)}`} />
          <CountRow label="acumulado_saldo" value={`R$ ${formatMoney(comparativoMensal.totals.saldo)}`} />
          {comparativoMensal.rows.map((item) => (
            <View key={item.mes} style={styles.localItemBlock}>
              <View style={styles.localItemHeader}>
                <Text style={styles.localTitle}>{item.mes}</Text>
                <Text style={styles.localMeta}>
                  Comprometimento {(Number(item.comprometimentoParcelas || 0) * 100).toFixed(1)}%
                </Text>
              </View>
              <Text style={styles.localMeta}>
                Receitas R$ {formatMoney(item.receitas)} | Despesas R$ {formatMoney(item.despesas)} | Saldo R${" "}
                {formatMoney(item.saldo)}
              </Text>
              <Text style={styles.localMeta}>
                Saldo apos acerto DEA: R$ {formatMoney(item.saldoAposAcertoDEA)}
              </Text>
            </View>
          ))}
        </View>

        <View style={cardStyle(showMaisCategorias)}>
          <Text style={styles.sectionTitle}>
            {editingCategoriaId ? "Editar categoria local" : "Nova categoria local"}
          </Text>
          <TextInput
            value={categoriaForm.nome}
            onChangeText={(value) => setCategoriaForm((prev) => ({ ...prev, nome: value }))}
            style={styles.input}
            placeholder="Nome"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={categoriaForm.slug}
            onChangeText={(value) => setCategoriaForm((prev) => ({ ...prev, slug: value }))}
            style={styles.input}
            placeholder="Slug (opcional)"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={categoriaForm.ordem}
            onChangeText={(value) => setCategoriaForm((prev) => ({ ...prev, ordem: value }))}
            style={styles.input}
            placeholder="Ordem (opcional)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={categoriaForm.cor}
            onChangeText={(value) => setCategoriaForm((prev) => ({ ...prev, cor: value }))}
            style={styles.input}
            placeholder="Cor (opcional, ex.: #0ea5e9)"
            placeholderTextColor="#6b7280"
          />
          <ActionButton
            label={editingCategoriaId ? "Atualizar categoria local" : "Salvar categoria local"}
            onPress={handleSaveCategoria}
            busy={loadingSaveCategoria}
            disabled={Boolean(busyAction)}
          />
          {editingCategoriaId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingCategoriaId("");
                  setCategoriaForm({ nome: "", slug: "", ordem: "", cor: "" });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showMaisCategorias)}>
          <Text style={styles.sectionTitle}>
            {editingReceitaRegraChave ? "Editar regra de receita local" : "Nova regra de receita local"}
          </Text>
          <TextInput
            value={receitaRegraForm.chave}
            onChangeText={(value) => setReceitaRegraForm((prev) => ({ ...prev, chave: value }))}
            style={styles.input}
            placeholder="Chave (ex.: SALARIO_WALKER)"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={receitaRegraForm.valor}
            onChangeText={(value) => setReceitaRegraForm((prev) => ({ ...prev, valor: value }))}
            style={styles.input}
            placeholder="Valor da regra"
            placeholderTextColor="#6b7280"
          />
          <ActionButton
            label={editingReceitaRegraChave ? "Atualizar regra local" : "Salvar regra local"}
            onPress={handleSaveReceitaRegra}
            busy={loadingSaveReceitaRegra}
            disabled={Boolean(busyAction)}
          />
          {editingReceitaRegraChave ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingReceitaRegraChave("");
                  setReceitaRegraForm({ chave: "", valor: "" });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showLancar)}>
          <Text style={styles.sectionTitle}>
            {editingLancamentoId ? "Editar lancamento local" : "Novo lancamento local"}
          </Text>
          {editingLancamentoId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingLancamentoId("");
                  setLancamentoForm({
                    data: currentDateYmd(),
                    descricao: "",
                    categoria: "",
                    valor: "",
                    tipo: "despesa",
                    atribuicao: "WALKER",
                    metodo: "pix",
                    quem_pagou: "WALKER",
                    observacao: ""
                  });
                }}
              />
            </View>
          ) : null}
          <Text style={styles.label}>Tipo</Text>
          <View style={styles.chipRow}>
            {TIPO_LANCAMENTO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={lancamentoForm.tipo === item}
                onPress={() => setLancamentoForm((prev) => ({ ...prev, tipo: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Data</Text>
          <TextInput
            value={lancamentoForm.data}
            onChangeText={(value) => setLancamentoForm((prev) => ({ ...prev, data: value }))}
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#6b7280"
          />
          <View style={styles.inlineActions}>
            <OptionChip
              label="Hoje"
              selected={lancamentoForm.data === currentDateYmd()}
              onPress={() => setLancamentoForm((prev) => ({ ...prev, data: currentDateYmd() }))}
            />
          </View>

          <TextInput
            value={lancamentoForm.descricao}
            onChangeText={(value) => setLancamentoForm((prev) => ({ ...prev, descricao: value }))}
            style={styles.input}
            placeholder="Descricao"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={lancamentoForm.categoria}
            onChangeText={(value) => setLancamentoForm((prev) => ({ ...prev, categoria: value }))}
            style={styles.input}
            placeholder="Categoria"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.label}>Categorias locais</Text>
          <View style={styles.chipRow}>
            {categoriaOptions.length === 0 ? (
              <Text style={styles.hint}>Sem categorias locais ainda.</Text>
            ) : (
              categoriaOptions.map((item) => (
                <OptionChip
                  key={item.id}
                  label={item.nome}
                  selected={lancamentoForm.categoria === item.nome}
                  onPress={() => setLancamentoForm((prev) => ({ ...prev, categoria: item.nome }))}
                />
              ))
            )}
          </View>
          <TextInput
            value={lancamentoForm.valor}
            onChangeText={(value) => setLancamentoForm((prev) => ({ ...prev, valor: value }))}
            style={styles.input}
            placeholder="Valor (ex.: 12,34)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />

          <Text style={styles.label}>Atribuicao</Text>
          <View style={styles.chipRow}>
            {ATRIBUICAO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={lancamentoForm.atribuicao === item}
                onPress={() => setLancamentoForm((prev) => ({ ...prev, atribuicao: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Metodo</Text>
          <View style={styles.chipRow}>
            {METODO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={lancamentoForm.metodo === item}
                onPress={() => setLancamentoForm((prev) => ({ ...prev, metodo: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Quem pagou</Text>
          <View style={styles.chipRow}>
            {PESSOA_PAGADORA_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={lancamentoForm.quem_pagou === item}
                onPress={() => setLancamentoForm((prev) => ({ ...prev, quem_pagou: item }))}
              />
            ))}
          </View>

          <TextInput
            value={lancamentoForm.observacao}
            onChangeText={(value) => setLancamentoForm((prev) => ({ ...prev, observacao: value }))}
            style={styles.input}
            placeholder="Observacao (opcional)"
            placeholderTextColor="#6b7280"
          />
          <ActionButton
            label={editingLancamentoId ? "Atualizar lancamento local" : "Salvar lancamento local"}
            onPress={handleSaveLancamento}
            busy={loadingSaveLancamento}
            disabled={Boolean(busyAction)}
          />
        </View>

        <View style={cardStyle(showMaisContas)}>
          <Text style={styles.sectionTitle}>
            {editingContaFixaId ? "Editar conta fixa local" : "Nova conta fixa local"}
          </Text>
          <TextInput
            value={contaFixaForm.nome}
            onChangeText={(value) => setContaFixaForm((prev) => ({ ...prev, nome: value }))}
            style={styles.input}
            placeholder="Nome"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={contaFixaForm.categoria}
            onChangeText={(value) => setContaFixaForm((prev) => ({ ...prev, categoria: value }))}
            style={styles.input}
            placeholder="Categoria"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.label}>Categorias locais</Text>
          <View style={styles.chipRow}>
            {categoriaOptions.length === 0 ? (
              <Text style={styles.hint}>Sem categorias locais ainda.</Text>
            ) : (
              categoriaOptions.map((item) => (
                <OptionChip
                  key={item.id}
                  label={item.nome}
                  selected={contaFixaForm.categoria === item.nome}
                  onPress={() => setContaFixaForm((prev) => ({ ...prev, categoria: item.nome }))}
                />
              ))
            )}
          </View>
          <TextInput
            value={contaFixaForm.dia_vencimento}
            onChangeText={(value) => setContaFixaForm((prev) => ({ ...prev, dia_vencimento: value }))}
            style={styles.input}
            placeholder="Dia de vencimento (1-31)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={contaFixaForm.valor_previsto}
            onChangeText={(value) => setContaFixaForm((prev) => ({ ...prev, valor_previsto: value }))}
            style={styles.input}
            placeholder="Valor previsto (opcional)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={contaFixaForm.avisar_dias_antes}
            onChangeText={(value) => setContaFixaForm((prev) => ({ ...prev, avisar_dias_antes: value }))}
            style={styles.input}
            placeholder="Avisar dias antes (ex.: 5,2)"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Atribuicao</Text>
          <View style={styles.chipRow}>
            {ATRIBUICAO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={contaFixaForm.atribuicao === item}
                onPress={() => setContaFixaForm((prev) => ({ ...prev, atribuicao: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Quem pagou</Text>
          <View style={styles.chipRow}>
            {PESSOA_PAGADORA_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={contaFixaForm.quem_pagou === item}
                onPress={() => setContaFixaForm((prev) => ({ ...prev, quem_pagou: item }))}
              />
            ))}
          </View>

          <ActionButton
            label={editingContaFixaId ? "Atualizar conta fixa local" : "Salvar conta fixa local"}
            onPress={handleSaveContaFixa}
            busy={loadingSaveContaFixa}
            disabled={Boolean(busyAction)}
          />
          {editingContaFixaId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingContaFixaId("");
                  setContaFixaForm({
                    nome: "",
                    dia_vencimento: "5",
                    valor_previsto: "",
                    categoria: "",
                    atribuicao: "AMBOS",
                    quem_pagou: "WALKER",
                    avisar_dias_antes: "5,2"
                  });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showMaisContas)}>
          <Text style={styles.sectionTitle}>
            {editingCalendarioId ? "Editar evento sazonal local" : "Novo evento sazonal local"}
          </Text>
          <TextInput
            value={calendarioForm.mes}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, mes: value }))}
            style={styles.input}
            placeholder="Mes (1-12)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={calendarioForm.dia_mes}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, dia_mes: value }))}
            style={styles.input}
            placeholder="Dia do mes (opcional)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={calendarioForm.evento}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, evento: value }))}
            style={styles.input}
            placeholder="Evento"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={calendarioForm.categoria}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, categoria: value }))}
            style={styles.input}
            placeholder="Categoria"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.label}>Categorias locais</Text>
          <View style={styles.chipRow}>
            {categoriaOptions.length === 0 ? (
              <Text style={styles.hint}>Sem categorias locais ainda.</Text>
            ) : (
              categoriaOptions.map((item) => (
                <OptionChip
                  key={item.id}
                  label={item.nome}
                  selected={calendarioForm.categoria === item.nome}
                  onPress={() => setCalendarioForm((prev) => ({ ...prev, categoria: item.nome }))}
                />
              ))
            )}
          </View>
          <TextInput
            value={calendarioForm.valor_estimado}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, valor_estimado: value }))}
            style={styles.input}
            placeholder="Valor estimado"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />
          <TextInput
            value={calendarioForm.avisar_dias_antes}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, avisar_dias_antes: value }))}
            style={styles.input}
            placeholder="Avisar dias antes (ex.: 10,5,2)"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={calendarioForm.observacao}
            onChangeText={(value) => setCalendarioForm((prev) => ({ ...prev, observacao: value }))}
            style={styles.input}
            placeholder="Observacao (opcional)"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Atribuicao</Text>
          <View style={styles.chipRow}>
            {ATRIBUICAO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={calendarioForm.atribuicao === item}
                onPress={() => setCalendarioForm((prev) => ({ ...prev, atribuicao: item }))}
              />
            ))}
          </View>

          <ActionButton
            label={editingCalendarioId ? "Atualizar evento sazonal local" : "Salvar evento sazonal local"}
            onPress={handleSaveCalendario}
            busy={loadingSaveCalendario}
            disabled={Boolean(busyAction)}
          />
          {editingCalendarioId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingCalendarioId("");
                  setCalendarioForm({
                    mes: String(new Date().getMonth() + 1),
                    dia_mes: "",
                    evento: "",
                    valor_estimado: "",
                    categoria: "",
                    atribuicao: "AMBOS",
                    avisar_dias_antes: "10,5,2",
                    observacao: ""
                  });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showCartoes)}>
          <Text style={styles.sectionTitle}>{editingCartaoId ? "Editar cartao local" : "Novo cartao local"}</Text>
          <TextInput
            value={cartaoForm.nome}
            onChangeText={(value) => setCartaoForm((prev) => ({ ...prev, nome: value }))}
            style={styles.input}
            placeholder="Nome do cartao"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={cartaoForm.final_cartao}
            onChangeText={(value) => setCartaoForm((prev) => ({ ...prev, final_cartao: value }))}
            style={styles.input}
            placeholder="Final (opcional)"
            placeholderTextColor="#6b7280"
          />

          <Text style={styles.label}>Banco</Text>
          <View style={styles.chipRow}>
            {BANCO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={cartaoForm.banco === item}
                onPress={() => setCartaoForm((prev) => ({ ...prev, banco: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Titular</Text>
          <View style={styles.chipRow}>
            {TITULAR_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={cartaoForm.titular === item}
                onPress={() => setCartaoForm((prev) => ({ ...prev, titular: item }))}
              />
            ))}
          </View>

          <Text style={styles.label}>Atribuicao default</Text>
          <View style={styles.chipRow}>
            {ATRIBUICAO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={cartaoForm.padrao_atribuicao === item}
                onPress={() => setCartaoForm((prev) => ({ ...prev, padrao_atribuicao: item }))}
              />
            ))}
          </View>

          <ActionButton
            label={editingCartaoId ? "Atualizar cartao local" : "Salvar cartao local"}
            onPress={handleSaveCartao}
            busy={loadingSaveCartao}
            disabled={Boolean(busyAction)}
          />
          {editingCartaoId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingCartaoId("");
                  setCartaoForm({
                    nome: "",
                    banco: "C6",
                    titular: "WALKER",
                    final_cartao: "",
                    padrao_atribuicao: "AMBOS"
                  });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showCartoes)}>
          <Text style={styles.sectionTitle}>
            {editingMovimentoId ? "Editar compra de cartao (local)" : "Nova compra de cartao (local)"}
          </Text>
          <Text style={styles.label}>Cartao</Text>
          <View style={styles.chipRow}>
            {cartoes.map((card) => (
              <OptionChip
                key={card.id}
                label={card.nome}
                selected={movimentoForm.cartao_id === card.id}
                onPress={() =>
                  setMovimentoForm((prev) => ({
                    ...prev,
                    cartao_id: card.id,
                    atribuicao: card.padrao_atribuicao ?? prev.atribuicao
                  }))
                }
              />
            ))}
          </View>

          <TextInput
            value={movimentoForm.data}
            onChangeText={(value) => setMovimentoForm((prev) => ({ ...prev, data: value }))}
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={movimentoForm.descricao}
            onChangeText={(value) => setMovimentoForm((prev) => ({ ...prev, descricao: value }))}
            style={styles.input}
            placeholder="Descricao da compra"
            placeholderTextColor="#6b7280"
          />
          <TextInput
            value={movimentoForm.valor}
            onChangeText={(value) => setMovimentoForm((prev) => ({ ...prev, valor: value }))}
            style={styles.input}
            placeholder="Valor"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
          />

          <Text style={styles.label}>Atribuicao</Text>
          <View style={styles.chipRow}>
            {ATRIBUICAO_OPTIONS.map((item) => (
              <OptionChip
                key={item}
                label={item}
                selected={movimentoForm.atribuicao === item}
                onPress={() => setMovimentoForm((prev) => ({ ...prev, atribuicao: item }))}
              />
            ))}
          </View>

          <ActionButton
            label={editingMovimentoId ? "Atualizar compra local" : "Salvar compra local"}
            onPress={handleSaveMovimento}
            busy={loadingSaveMovimento}
            disabled={Boolean(busyAction)}
          />
          {editingMovimentoId ? (
            <View style={styles.inlineActions}>
              <OptionChip
                label="Cancelar edicao"
                selected={false}
                onPress={() => {
                  setEditingMovimentoId("");
                  setMovimentoForm({
                    cartao_id: "",
                    data: currentDateYmd(),
                    descricao: "",
                    valor: "",
                    atribuicao: "AMBOS"
                  });
                }}
              />
            </View>
          ) : null}
        </View>

        <View style={cardStyle(showInicio)}>
          <Text style={styles.sectionTitle}>Resumo local</Text>
          <CountRow label="lancamentos" value={String(counts.lancamentos ?? 0)} />
          <CountRow label="contas_fixas" value={String(counts.contas_fixas ?? 0)} />
          <CountRow label="calendario_anual" value={String(counts.calendario_anual ?? 0)} />
          <CountRow label="receitas_regras" value={String(counts.receitas_regras ?? 0)} />
          <CountRow label="categorias" value={String(counts.categorias ?? 0)} />
          <CountRow label="cartoes" value={String(counts.cartoes ?? 0)} />
          <CountRow label="cartao_movimentos" value={String(counts.cartao_movimentos ?? 0)} />
          <CountRow label="pending_sync_ops" value={String(pendingOps)} />
          <CountRow label="sync_status" value={syncBadge} />
          <CountRow label="last_sync_at" value={String(syncState?.last_sync_at ?? "-")} />
        </View>

        <View style={cardStyle(showMaisSync)}>
          <Text style={styles.sectionTitle}>Historico de sync</Text>
          <ActionButton
            label="Limpar historico"
            onPress={handleClearSyncLogs}
            busy={loadingClearSyncLogs}
            disabled={Boolean(busyAction)}
          />
          {syncLogs.length === 0 ? (
            <Text style={styles.hint}>Sem eventos de sync registrados.</Text>
          ) : (
            syncLogs.map((log) => (
              <View key={log.log_id} style={styles.localItemBlock}>
                <View style={styles.localItemHeader}>
                  <Text style={styles.localTitle}>{log.event}</Text>
                  <Text style={styles.localMeta}>{String(log.level || "info").toUpperCase()}</Text>
                </View>
                <Text style={styles.localMeta}>{log.message}</Text>
                <Text style={styles.localMeta}>{formatDateTime(log.created_at)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisCategorias)}>
          <Text style={styles.sectionTitle}>Categorias locais</Text>
          {categorias.length === 0 ? (
            <Text style={styles.hint}>Nenhuma categoria local.</Text>
          ) : (
            categorias.map((item) => (
              <View key={item.id} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{item.nome}</Text>
                  <Text style={styles.localMeta}>
                    slug: {item.slug || "-"} | ordem: {item.ordem == null ? "-" : item.ordem}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditCategoria(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label={item.ativa === false ? "Reativar" : "Desativar"}
                    onPress={() => handleToggleCategoriaAtiva(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteCategoria(item.id, item.nome)}
                    busy={loadingDeleteCategoria}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisCategorias)}>
          <Text style={styles.sectionTitle}>Regras de receitas locais</Text>
          {receitasRegrasOrdenadas.length === 0 ? (
            <Text style={styles.hint}>Nenhuma regra local.</Text>
          ) : (
            receitasRegrasOrdenadas.map((item) => (
              <View key={item.chave} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{item.chave}</Text>
                  <Text style={styles.localMeta}>{item.valor}</Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditReceitaRegra(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteReceitaRegra(item.chave)}
                    busy={loadingDeleteReceitaRegra}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showCartoes)}>
          <Text style={styles.sectionTitle}>Cartoes locais</Text>
          {cartoes.length === 0 ? (
            <Text style={styles.hint}>Nenhum cartao local.</Text>
          ) : (
            cartoes.map((card) => (
              <View key={card.id} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{card.nome}</Text>
                  <Text style={styles.localMeta}>
                    {card.banco} | {card.titular} | default {card.padrao_atribuicao}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditCartao(card)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteCartao(card.id)}
                    busy={loadingDeleteCartao}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisContas)}>
          <Text style={styles.sectionTitle}>Contas fixas locais</Text>
          {contasFixas.length === 0 ? (
            <Text style={styles.hint}>Nenhuma conta fixa local.</Text>
          ) : (
            contasFixas.map((item) => (
              <View key={item.id} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{item.nome}</Text>
                  <Text style={styles.localMeta}>
                    dia {item.dia_vencimento} | {item.categoria} |{" "}
                    {item.valor_previsto === null ? "-" : `R$ ${formatMoney(item.valor_previsto)}`}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditContaFixa(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteContaFixa(item.id)}
                    busy={loadingDeleteContaFixa}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showMaisContas)}>
          <Text style={styles.sectionTitle}>Calendario anual local</Text>
          {calendarioOrdenado.length === 0 ? (
            <Text style={styles.hint}>Nenhum evento sazonal local.</Text>
          ) : (
            calendarioOrdenado.map((item) => (
              <View key={item.id} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{item.evento}</Text>
                  <Text style={styles.localMeta}>
                    mes {item.mes}
                    {item.dia_mes == null ? "" : ` dia ${item.dia_mes}`} | {item.categoria} | R${" "}
                    {formatMoney(item.valor_estimado)}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditCalendario(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteCalendario(item.id, item.evento)}
                    busy={loadingDeleteCalendario}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={cardStyle(showCartoes)}>
          <Text style={styles.sectionTitle}>Compras de cartao locais</Text>
          <TextInput
            value={cardMovFilterMonth}
            onChangeText={setCardMovFilterMonth}
            style={styles.input}
            placeholder="Mes filtro (YYYY-MM)"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.label}>Cartao filtro</Text>
          <View style={styles.chipRow}>
            <OptionChip
              label="Todos"
              selected={cardMovFilterCardId === "todos"}
              onPress={() => setCardMovFilterCardId("todos")}
            />
            {cartoes.map((card) => (
              <OptionChip
                key={card.id}
                label={card.nome}
                selected={cardMovFilterCardId === card.id}
                onPress={() => setCardMovFilterCardId(card.id)}
              />
            ))}
          </View>
          {cartaoMovimentosFiltrados.length === 0 ? (
            <Text style={styles.hint}>Nenhuma compra local.</Text>
          ) : (
            cartaoMovimentosFiltrados.map((item) => {
              const card = cardById.get(item.cartao_id);
              const statusColor = item.status === "conciliado" ? styles.badgeOk : styles.badgeWarn;
              return (
                <View key={item.id} style={styles.localItemBlock}>
                  <View style={styles.localItemHeader}>
                    <Text style={styles.localTitle}>{item.descricao}</Text>
                    <Text style={[styles.badge, statusColor]}>{item.status}</Text>
                  </View>
                  <Text style={styles.localMeta}>
                    {item.data} | {card?.nome ?? item.cartao_id} | R$ {formatMoney(item.valor)}
                  </Text>
                  <View style={styles.inlineActions}>
                    <OptionChip
                      label="Editar"
                      selected={false}
                      onPress={() => startEditMovimento(item)}
                    />
                    <OptionChip
                      label="Conciliar WALKER"
                      selected={false}
                      onPress={() => handleClassifyMovimento(item.id, "WALKER")}
                    />
                    <OptionChip
                      label="Conciliar AMBOS"
                      selected={false}
                      onPress={() => handleClassifyMovimento(item.id, "AMBOS")}
                    />
                    <OptionChip
                      label="Excluir"
                      selected={false}
                      onPress={() => handleDeleteMovimento(item.id)}
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={cardStyle(showLancar)}>
          <Text style={styles.sectionTitle}>Lancamentos locais</Text>
          <TextInput
            value={lancamentoFilterText}
            onChangeText={(value) => {
              setLancamentoFilterText(value);
              setLancamentoPage(1);
            }}
            style={styles.input}
            placeholder="Buscar por descricao/categoria/obs/tipo"
            placeholderTextColor="#6b7280"
          />
          <Text style={styles.label}>Filtro de categoria</Text>
          <View style={styles.chipRow}>
            <OptionChip
              label="Todas"
              selected={lancamentoFilterCategoria === "todas"}
              onPress={() => {
                setLancamentoFilterCategoria("todas");
                setLancamentoPage(1);
              }}
            />
            {lancamentoCategorias.map((cat) => (
              <OptionChip
                key={cat}
                label={cat}
                selected={lancamentoFilterCategoria === cat}
                onPress={() => {
                  setLancamentoFilterCategoria(cat);
                  setLancamentoPage(1);
                }}
              />
            ))}
          </View>

          <Text style={styles.label}>Ordenacao</Text>
          <View style={styles.inlineActions}>
            {["data", "tipo", "descricao", "categoria", "valor"].map((key) => (
              <OptionChip
                key={key}
                label={key}
                selected={lancamentoSortKey === key}
                onPress={() => setLancamentoSortKey(key)}
              />
            ))}
            <OptionChip
              label={lancamentoSortDir === "asc" ? "asc" : "desc"}
              selected
              onPress={() => setLancamentoSortDir((prev) => (prev === "asc" ? "desc" : "asc"))}
            />
            <OptionChip
              label={`p/${lancamentoPageSize}`}
              selected
              onPress={() => {
                const next = lancamentoPageSize === 10 ? 20 : lancamentoPageSize === 20 ? 50 : 10;
                setLancamentoPageSize(next);
                setLancamentoPage(1);
              }}
            />
          </View>

          <Text style={styles.hint}>
            {lancamentosFiltrados.length} registro(s) filtrados | pagina {Math.min(lancamentoPage, lancamentoTotalPages)} de{" "}
            {lancamentoTotalPages}
          </Text>

          {lancamentosPaginados.length === 0 ? (
            <Text style={styles.hint}>Nenhum lancamento local.</Text>
          ) : (
            lancamentosPaginados.map((item) => (
              <View key={item.id} style={styles.localItem}>
                <View style={styles.localItemText}>
                  <Text style={styles.localTitle}>{item.descricao}</Text>
                  <Text style={styles.localMeta}>
                    {item.data} | {item.tipo} | {item.categoria} | {item.atribuicao} | {item.metodo} | R${" "}
                    {formatMoney(item.valor)}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <ActionButton
                    label="Editar"
                    onPress={() => startEditLancamento(item)}
                    busy={false}
                    disabled={Boolean(busyAction)}
                  />
                  <ActionButton
                    label="Excluir"
                    onPress={() => handleDeleteLancamento(item.id)}
                    busy={loadingDeleteLancamento}
                    disabled={Boolean(busyAction)}
                    variant="danger"
                  />
                </View>
              </View>
            ))
          )}

          <View style={styles.inlineActions}>
            <OptionChip
              label="Anterior"
              selected={false}
              onPress={() => setLancamentoPage((prev) => Math.max(prev - 1, 1))}
            />
            <OptionChip
              label="Proxima"
              selected={false}
              onPress={() => setLancamentoPage((prev) => Math.min(prev + 1, lancamentoTotalPages))}
            />
          </View>
        </View>

        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.bottomNav}>
        <View style={styles.bottomNavInner}>
          <BottomNavButton
            label="Inicio"
            icon="H"
            active={activeTab === "inicio"}
            onPress={() => setActiveTab("inicio")}
          />
          <BottomNavButton
            label="Cartoes"
            icon="C"
            active={activeTab === "cartoes"}
            onPress={() => setActiveTab("cartoes")}
          />
          <BottomNavButton
            label="Mais"
            icon="M"
            active={activeTab === "mais"}
            onPress={() => {
              setActiveTab("mais");
              setMoreMenuOpen((prev) => !prev);
            }}
          />
        </View>
        <TouchableOpacity style={styles.launchButton} onPress={() => setActiveTab("lancar")}>
          <Text style={styles.launchButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#eef1e7"
  },
  topBar: {
    height: 50,
    borderBottomColor: "#d1d5db",
    borderBottomWidth: 1,
    backgroundColor: "#f8fafc",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: 16
  },
  topBrand: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 2
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 112,
    gap: 14
  },
  title: {
    color: "#0b1a3d",
    fontSize: 22,
    fontWeight: "900"
  },
  subtitle: {
    color: "#4b5563",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4
  },
  hidden: {
    display: "none"
  },
  moreSectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  moreOverlay: {
    position: "absolute",
    top: 50,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: "rgba(15, 23, 42, 0.15)"
  },
  moreMenu: {
    position: "absolute",
    right: 16,
    bottom: 78,
    zIndex: 40,
    width: 180,
    borderRadius: 14,
    borderColor: "#d1d5db",
    borderWidth: 1,
    backgroundColor: "#ffffff",
    padding: 8,
    gap: 4
  },
  moreMenuItem: {
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  moreMenuItemText: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "700"
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 14,
    borderColor: "#d1d5db",
    borderWidth: 1,
    gap: 8
  },
  label: {
    color: "#111827",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  sectionTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  input: {
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    color: "#0f172a",
    fontSize: 14,
    backgroundColor: "#f8fafc"
  },
  inputMultiline: {
    minHeight: 140,
    paddingTop: 10
  },
  hint: {
    color: "#6b7280",
    fontSize: 12
  },
  button: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  buttonDark: {
    backgroundColor: "#0f172a"
  },
  buttonDanger: {
    backgroundColor: "#b91c1c"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  chip: {
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#ffffff"
  },
  chipSelected: {
    borderColor: "#0f766e",
    backgroundColor: "#ccfbf1"
  },
  chipText: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "700"
  },
  chipTextSelected: {
    color: "#115e59"
  },
  countRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomColor: "#e5e7eb",
    borderBottomWidth: 1,
    paddingVertical: 4
  },
  countLabel: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700"
  },
  countValue: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "800"
  },
  localItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderBottomColor: "#e5e7eb",
    borderBottomWidth: 1,
    paddingVertical: 8
  },
  localItemBlock: {
    borderBottomColor: "#e5e7eb",
    borderBottomWidth: 1,
    paddingVertical: 8,
    gap: 6
  },
  localItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  localItemText: {
    flex: 1
  },
  rowActions: {
    flexDirection: "row",
    gap: 6
  },
  localTitle: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "700"
  },
  localMeta: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600"
  },
  badge: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  badgeOk: {
    color: "#065f46",
    backgroundColor: "#d1fae5"
  },
  badgeWarn: {
    color: "#92400e",
    backgroundColor: "#fef3c7"
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  monthPill: {
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: "#475569",
    fontSize: 11,
    fontWeight: "700",
    backgroundColor: "#f8fafc"
  },
  success: {
    color: "#065f46",
    backgroundColor: "#d1fae5",
    borderColor: "#6ee7b7",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    fontWeight: "700"
  },
  error: {
    color: "#991b1b",
    backgroundColor: "#fee2e2",
    borderColor: "#fca5a5",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    fontWeight: "700"
  },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 10,
    backgroundColor: "transparent",
    alignItems: "center"
  },
  bottomNavInner: {
    width: "100%",
    borderTopColor: "#d1d5db",
    borderTopWidth: 1,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingTop: 22,
    paddingBottom: 10,
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center"
  },
  bottomNavButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
    gap: 2
  },
  bottomNavIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  bottomNavIconWrapActive: {
    backgroundColor: "#e2e8f0"
  },
  bottomNavIcon: {
    color: "#64748b",
    fontSize: 18,
    fontWeight: "700"
  },
  bottomNavIconActive: {
    color: "#0f172a"
  },
  bottomNavLabel: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  bottomNavLabelActive: {
    color: "#0f172a"
  },
  launchButton: {
    position: "absolute",
    top: -18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#f8fafc",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5
  },
  launchButtonText: {
    color: "#ffffff",
    fontSize: 30,
    lineHeight: 32,
    fontWeight: "600"
  }
});
