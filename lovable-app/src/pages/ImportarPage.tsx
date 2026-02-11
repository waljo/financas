import { useCallback, useEffect, useMemo, useState } from "react";

interface MetadataResponse {
  sheetNames: string[];
  legacyCandidates: Array<{
    sheetName: string;
    monthBlocks: Array<{ label: string; month: number; startCol: number }>;
  }>;
}

interface PreviewMonthItem {
  month: number;
  monthLabel: string;
  startCol: number;
  count: number;
  duplicateCount: number;
  existingCount: number;
  existingCountTipo: number;
  alreadyImported: boolean;
  alreadyImportedTipo: boolean;
  willSkip: boolean;
  sample: Array<{
    data: string;
    tipo: string;
    descricao: string;
    valor: number;
    atribuicao: string;
    quem_pagou: string;
  }>;
}

interface PreviewResponse {
  year: number;
  tipo: "despesa" | "receita";
  onlyNegative: boolean;
  skipMonthsAlreadyImported: boolean;
  totalCount: number;
  importableCount: number;
  monthPreviews: PreviewMonthItem[];
}

interface RunMonthResult {
  month: number;
  monthLabel: string;
  startCol: number;
  previewCount: number;
  duplicateCount: number;
  existingCount: number;
  existingCountTipo: number;
  imported: number;
  skipped: boolean;
  skipReason: string | null;
}

interface RunResponse {
  year: number;
  tipo: "despesa" | "receita";
  onlyNegative: boolean;
  dryRun: boolean;
  skipMonthsAlreadyImported: boolean;
  previewCount: number;
  importableCount: number;
  imported: number;
  monthResults: RunMonthResult[];
}

type ApiPayload<T> = {
  data: T;
  message?: string;
};

export default function ImportarPage() {
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [runSummary, setRunSummary] = useState<RunResponse | null>(null);

  const [sourceSheet, setSourceSheet] = useState("");
  const [tipoImportacao, setTipoImportacao] = useState<"despesa" | "receita">("despesa");
  const [selectedMonthCols, setSelectedMonthCols] = useState<number[]>([]);
  const [skipMonthsAlreadyImported, setSkipMonthsAlreadyImported] = useState(true);
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [startRow, setStartRow] = useState("17");
  const [endRow, setEndRow] = useState("130");

  const [descricaoCol, setDescricaoCol] = useState("2");
  const [valorCol, setValorCol] = useState("3");
  const [diaCol, setDiaCol] = useState("4");
  const [atribuicaoCol, setAtribuicaoCol] = useState("5");
  const [quemPagouCol, setQuemPagouCol] = useState("6");
  const [categoriaCol, setCategoriaCol] = useState("");
  const [defaultsCategoria, setDefaultsCategoria] = useState("");
  const [defaultsAtribuicao, setDefaultsAtribuicao] = useState("AMBOS");
  const [defaultsQuemPagou, setDefaultsQuemPagou] = useState("WALKER");

  const activeSheetMonths = useMemo(
    () => metadata?.legacyCandidates.find((item) => item.sheetName === sourceSheet)?.monthBlocks ?? [],
    [metadata, sourceSheet]
  );
  const baseStartCol = useMemo(() => {
    const january = activeSheetMonths.find((item) => item.month === 1);
    if (january) return january.startCol;
    return activeSheetMonths[0]?.startCol ?? null;
  }, [activeSheetMonths]);

  const inferredYear = useMemo(() => {
    const parsed = Number(sourceSheet);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      return null;
    }
    return parsed;
  }, [sourceSheet]);

  function setInitialMonthsFromSheet(sheetName: string, data: MetadataResponse | null) {
    const blocks = data?.legacyCandidates.find((item) => item.sheetName === sheetName)?.monthBlocks ?? [];
    setSelectedMonthCols(blocks[0] ? [blocks[0].startCol] : []);
  }

  const loadMetadata = useCallback(async () => {
    setLoadingMeta(true);
    setError("");
    try {
      const response = await fetch("/api/importar/metadata");
      const payload = (await response.json()) as ApiPayload<MetadataResponse>;
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar metadata");
      setMetadata(payload.data);

      const first = payload.data.legacyCandidates[0];
      if (first) {
        setSourceSheet(first.sheetName);
        setInitialMonthsFromSheet(first.sheetName, payload.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  function applyTipoPreset(tipo: "despesa" | "receita") {
    setTipoImportacao(tipo);
    setPreview(null);
    setRunSummary(null);

    if (tipo === "receita") {
      setStartRow("11");
      setEndRow("15");
      setAtribuicaoCol("");
      setQuemPagouCol("");
      setDefaultsAtribuicao("WALKER");
      setDefaultsQuemPagou("WALKER");
      if (!defaultsCategoria) {
        setDefaultsCategoria("RECEITAS");
      }
      return;
    }

    setStartRow("17");
    setEndRow("130");
    setAtribuicaoCol("5");
    setQuemPagouCol("6");
    setDefaultsAtribuicao("AMBOS");
    setDefaultsQuemPagou("WALKER");
  }

  function applyAutoMapping() {
    if (!baseStartCol) {
      return;
    }
    setDescricaoCol(String(baseStartCol));
    setValorCol(String(baseStartCol + 1));
    setDiaCol(String(baseStartCol + 2));
    setAtribuicaoCol(String(baseStartCol + 3));
    setQuemPagouCol(String(baseStartCol + 4));
  }

  function toggleMonth(startCol: number) {
    setPreview(null);
    setRunSummary(null);
    setSelectedMonthCols((prev) =>
      prev.includes(startCol) ? prev.filter((item) => item !== startCol) : [...prev, startCol].sort((a, b) => a - b)
    );
  }

  function selectAllMonths() {
    setPreview(null);
    setRunSummary(null);
    setSelectedMonthCols(activeSheetMonths.map((item) => item.startCol));
  }

  function clearMonthSelection() {
    setPreview(null);
    setRunSummary(null);
    setSelectedMonthCols([]);
  }

  function buildRequestBody() {
    if (!inferredYear) {
      throw new Error("Nao foi possivel inferir o ano pela aba origem. Use uma aba no formato YYYY.");
    }
    if (!selectedMonthCols.length) {
      throw new Error("Selecione ao menos um mes.");
    }

    return {
      sourceSheet,
      tipo: tipoImportacao,
      year: inferredYear,
      monthStartCols: selectedMonthCols,
      startRow: Number(startRow),
      endRow: Number(endRow),
      skipMonthsAlreadyImported,
      onlyNegative,
      mapping: {
        descricaoCol: Number(descricaoCol),
        valorCol: Number(valorCol),
        diaCol: Number(diaCol),
        ...(atribuicaoCol ? { atribuicaoCol: Number(atribuicaoCol) } : {}),
        ...(quemPagouCol ? { quemPagouCol: Number(quemPagouCol) } : {}),
        ...(categoriaCol ? { categoriaCol: Number(categoriaCol) } : {})
      },
      defaults: {
        ...(defaultsCategoria ? { categoria: defaultsCategoria } : {}),
        ...(defaultsAtribuicao ? { atribuicao: defaultsAtribuicao } : {}),
        metodo: "outro",
        quem_pagou: defaultsQuemPagou
      }
    };
  }

  async function doPreview() {
    setError("");
    setMessage("");
    setRunSummary(null);

    try {
      const body = buildRequestBody();

      const response = await fetch("/api/importar/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as ApiPayload<PreviewResponse>;
      if (!response.ok) {
        throw new Error(payload.message ?? "Erro no preview");
      }

      setPreview(payload.data);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "Erro no preview");
    }
  }

  async function runImport() {
    if (!preview) {
      setError("Execute o preview antes da importacao.");
      return;
    }

    setError("");
    setMessage("Importando...");

    try {
      const body = {
        ...buildRequestBody(),
        dryRun: false
      };

      const response = await fetch("/api/importar/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const payload = (await response.json()) as ApiPayload<RunResponse>;
      if (!response.ok) {
        throw new Error(payload.message ?? "Erro na importacao");
      }

      setRunSummary(payload.data);
      setMessage(`Importacao concluida: ${payload.data.imported} linhas.`);
    } catch (err) {
      setMessage("");
      setRunSummary(null);
      setError(err instanceof Error ? err.message : "Erro na importacao");
    }
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Importar historico (modo guiado)</h1>
        <p className="text-sm text-ink/70">
          1) Aba origem 2) Selecao de meses 3) Mapeamento 4) Preview por mes 5) Importacao em lote.
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Passo 1 - Origem e meses</h2>
          <button type="button" onClick={() => void loadMetadata()} className="rounded-lg border border-ink/20 px-3 py-1 text-sm">
            Recarregar metadata
          </button>
        </div>

        {loadingMeta ? <p className="text-sm">Carregando...</p> : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Aba origem
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={sourceSheet}
              onChange={(event) => {
                const nextSheet = event.target.value;
                setSourceSheet(nextSheet);
                setInitialMonthsFromSheet(nextSheet, metadata);
                setTimeout(() => applyAutoMapping(), 0);
                setPreview(null);
                setRunSummary(null);
              }}
            >
              {(metadata?.legacyCandidates ?? []).map((item) => (
                <option key={item.sheetName} value={item.sheetName}>
                  {item.sheetName}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Tipo de importacao
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={tipoImportacao}
              onChange={(event) => applyTipoPreset(event.target.value as "despesa" | "receita")}
            >
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
            </select>
          </label>
        </div>

        <div className="rounded-lg bg-sand p-3 text-sm">
          <p>
            <strong>Ano inferido:</strong> {inferredYear ?? "indisponivel"}
          </p>
          <p>
            <strong>Coluna base (jan):</strong> {baseStartCol ?? "indisponivel"}
          </p>
          <p>
            <strong>Meses detectados:</strong>{" "}
            {activeSheetMonths.length
              ? activeSheetMonths.map((item) => `${item.label}(col ${item.startCol})`).join(" | ")
              : "Nenhum bloco detectado."}
          </p>
          <p className="mt-1 text-ink/70">
            Dica: receitas legadas normalmente usam linhas 11-15; despesas, linhas 17+.
          </p>
        </div>

        <div className="rounded-lg border border-ink/15 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <strong>Selecionar meses:</strong>
            <button type="button" onClick={selectAllMonths} className="rounded border border-ink/20 px-2 py-1">
              Todos
            </button>
            <button type="button" onClick={clearMonthSelection} className="rounded border border-ink/20 px-2 py-1">
              Limpar
            </button>
            <span className="text-ink/70">Selecionados: {selectedMonthCols.length}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {activeSheetMonths.map((item) => {
              const checked = selectedMonthCols.includes(item.startCol);
              return (
                <label key={`${item.label}-${item.startCol}`} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={() => toggleMonth(item.startCol)} />
                  {item.label} (col {item.startCol})
                </label>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipMonthsAlreadyImported}
            onChange={(event) => {
              setSkipMonthsAlreadyImported(event.target.checked);
              setPreview(null);
              setRunSummary(null);
            }}
          />
          Pular meses que ja tem lancamentos importados no sistema
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyNegative}
            onChange={(event) => {
              setOnlyNegative(event.target.checked);
              setPreview(null);
              setRunSummary(null);
            }}
          />
          Importar apenas valores negativos (ajustes)
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Passos 2 e 3 - Range e mapeamento</h2>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded border border-ink/20 px-3 py-1"
            onClick={applyAutoMapping}
            disabled={!baseStartCol}
          >
            Auto-mapear colunas (bloco de janeiro)
          </button>
          <span className="text-ink/70">
            Para 2021, janeiro comeca na coluna A. Para 2022+, janeiro comeca na coluna B.
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">
            Linha inicial
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={startRow}
              onChange={(event) => setStartRow(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Linha final
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={endRow}
              onChange={(event) => setEndRow(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Coluna descricao
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={descricaoCol}
              onChange={(event) => setDescricaoCol(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Coluna valor
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={valorCol}
              onChange={(event) => setValorCol(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Coluna dia
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={diaCol}
              onChange={(event) => setDiaCol(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Coluna atribuicao (opcional)
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={atribuicaoCol}
              onChange={(event) => setAtribuicaoCol(event.target.value)}
              placeholder="Ex.: 5"
            />
          </label>
          <label className="text-sm">
            Coluna quem pagou (opcional)
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={quemPagouCol}
              onChange={(event) => setQuemPagouCol(event.target.value)}
              placeholder="Ex.: 6"
            />
          </label>
          <label className="text-sm">
            Coluna categoria (opcional)
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              type="number"
              value={categoriaCol}
              onChange={(event) => setCategoriaCol(event.target.value)}
            />
          </label>
        </div>

        <p className="text-sm text-ink/70">
          Observacao: as colunas abaixo sao as do bloco de Janeiro. O sistema aplica automaticamente o deslocamento para
          os outros meses.
        </p>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Categoria default
            <input
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={defaultsCategoria}
              onChange={(event) => setDefaultsCategoria(event.target.value)}
              placeholder={tipoImportacao === "receita" ? "RECEITAS" : "Despesas gerais"}
            />
          </label>
          <label className="text-sm">
            Atribuicao default
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={defaultsAtribuicao}
              onChange={(event) => setDefaultsAtribuicao(event.target.value)}
            >
              <option value="WALKER">WALKER</option>
              <option value="DEA">DEA</option>
              <option value="AMBOS">AMBOS</option>
              <option value="AMBOS_I">AMBOS_I</option>
            </select>
          </label>
          <label className="text-sm">
            Quem pagou default
            <select
              className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
              value={defaultsQuemPagou}
              onChange={(event) => setDefaultsQuemPagou(event.target.value)}
            >
              <option value="WALKER">WALKER</option>
              <option value="DEA">DEA</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Passos 4 e 5 - Preview e importacao</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void doPreview()} className="rounded-lg bg-ink px-4 py-2 text-sand">
            Gerar preview
          </button>
          <button type="button" onClick={() => void runImport()} className="rounded-lg bg-pine px-4 py-2 text-white">
            Executar importacao
          </button>
        </div>

        {preview ? (
          <div className="space-y-3 rounded-lg bg-sand p-3 text-sm">
            <p>
              <strong>Tipo:</strong> {preview.tipo} | <strong>Total no preview:</strong> {preview.totalCount} |{" "}
              <strong>Importavel:</strong> {preview.importableCount}
            </p>
            {preview.onlyNegative ? <p className="text-ink/70">Filtro ativo: somente negativos.</p> : null}

            {preview.monthPreviews.map((monthItem) => (
              <div key={`${monthItem.month}-${monthItem.startCol}`} className="rounded border border-ink/15 bg-white p-3">
                <p>
                  <strong>{monthItem.monthLabel}</strong> (col {monthItem.startCol}) | linhas: {monthItem.count} | ja no
                  sistema (total): {monthItem.existingCount} | ja no sistema ({preview.tipo}): {monthItem.existingCountTipo}
                </p>
                {monthItem.duplicateCount > 0 ? (
                  <p className="text-amber-700">
                    {monthItem.duplicateCount} linha(s) duplicadas foram ignoradas automaticamente.
                  </p>
                ) : null}
                <p className={monthItem.willSkip ? "text-coral" : "text-pine"}>
                  {monthItem.willSkip ? `Sera pulado (ja importado para ${preview.tipo}).` : "Sera importado."}
                </p>
                {preview.onlyNegative ? <p className="text-ink/70">Modo ajustes: nao pula meses ja importados.</p> : null}

                {monthItem.sample.length ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead>
                        <tr className="border-b border-ink/15 text-left">
                          <th className="px-2 py-1">Data</th>
                          <th className="px-2 py-1">Tipo</th>
                          <th className="px-2 py-1">Descricao</th>
                          <th className="px-2 py-1">Valor</th>
                          <th className="px-2 py-1">Atrib.</th>
                          <th className="px-2 py-1">Quem pagou</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthItem.sample.map((item, index) => (
                          <tr key={`${monthItem.month}-${item.data}-${index}`} className="border-b border-ink/10">
                            <td className="px-2 py-1">{item.data}</td>
                            <td className="px-2 py-1">{item.tipo}</td>
                            <td className="px-2 py-1">{item.descricao}</td>
                            <td className="px-2 py-1">{item.valor}</td>
                            <td className="px-2 py-1">{item.atribuicao}</td>
                            <td className="px-2 py-1">{item.quem_pagou}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-ink/70">Sem linhas validas para esse mes com o mapeamento atual.</p>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {runSummary ? (
          <div className="rounded-lg border border-ink/15 bg-white p-3 text-sm">
            <p>
              <strong>Importado:</strong> {runSummary.imported} | <strong>Preview:</strong> {runSummary.previewCount} |{" "}
              <strong>Importavel:</strong> {runSummary.importableCount}
            </p>
            {runSummary.onlyNegative ? <p className="text-ink/70">Filtro ativo: somente negativos.</p> : null}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs">
                <thead>
                  <tr className="border-b border-ink/15 text-left">
                    <th className="px-2 py-1">Mes</th>
                    <th className="px-2 py-1">Col</th>
                    <th className="px-2 py-1">Preview</th>
                    <th className="px-2 py-1">Duplicadas</th>
                    <th className="px-2 py-1">Ja existente</th>
                    <th className="px-2 py-1">Importado</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runSummary.monthResults.map((item) => (
                    <tr key={`${item.month}-${item.startCol}`} className="border-b border-ink/10">
                      <td className="px-2 py-1">{item.monthLabel}</td>
                      <td className="px-2 py-1">{item.startCol}</td>
                      <td className="px-2 py-1">{item.previewCount}</td>
                      <td className="px-2 py-1">{item.duplicateCount}</td>
                      <td className="px-2 py-1">
                        {item.existingCount} (tipo: {item.existingCountTipo})
                      </td>
                      <td className="px-2 py-1">{item.imported}</td>
                      <td className="px-2 py-1">{item.skipped ? "Pulado" : "Importado"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}
      {message ? <p className="rounded-lg bg-mint/40 p-3 text-sm text-ink">{message}</p> : null}
    </section>
  );
}
