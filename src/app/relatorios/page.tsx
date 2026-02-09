"use client";

import { useCallback, useEffect, useState } from "react";
import type { RelatorioMensal, RelatorioParcelasDetalhe } from "@/lib/types";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function RelatoriosPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<RelatorioMensal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [parcelasOpen, setParcelasOpen] = useState(false);
  const [parcelasLoading, setParcelasLoading] = useState(false);
  const [parcelasError, setParcelasError] = useState("");
  const [parcelasByMonth, setParcelasByMonth] = useState<Record<string, RelatorioParcelasDetalhe>>({});

  const parcelasDetalhe = parcelasByMonth[month] ?? null;

  function formatMonthShort(ym: string) {
    const [yearRaw, monthRaw] = ym.split("-");
    const year = Number(yearRaw);
    const mon = Number(monthRaw);
    if (!Number.isInteger(year) || !Number.isInteger(mon) || mon < 1 || mon > 12) return ym;
    const dtf = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
    return dtf.format(new Date(Date.UTC(year, mon - 1, 1))).replace(".", "");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/relatorios?mes=${month}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar relatorio");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }, [month]);

  const loadParcelasDetalhe = useCallback(
    async (targetMonth: string) => {
      if (parcelasByMonth[targetMonth]) return;
      setParcelasLoading(true);
      setParcelasError("");
      try {
        const response = await fetch(`/api/relatorios/parcelas?mes=${targetMonth}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? "Erro ao carregar detalhe das parcelas");
        setParcelasByMonth((prev) => ({ ...prev, [targetMonth]: payload.data }));
      } catch (err) {
        setParcelasError(err instanceof Error ? err.message : "Erro inesperado ao carregar detalhe das parcelas");
      } finally {
        setParcelasLoading(false);
      }
    },
    [parcelasByMonth]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!parcelasOpen) return;
    void loadParcelasDetalhe(month);
  }, [month, parcelasOpen, loadParcelasDetalhe]);

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Relatorios</h1>
        <p className="text-sm text-ink/70">Totais por categoria, atribuicao, saldo e comprometimento com parcelas.</p>
      </header>

      <div className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto]">
        <label className="text-sm">
          Mes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="self-end rounded-lg bg-ink px-4 py-2 font-semibold text-sand"
        >
          {loading ? "Carregando..." : "Gerar relatorio"}
        </button>
      </div>

      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
              <p className="text-sm text-ink/70">Receitas</p>
              <p className="text-xl font-semibold">R$ {data.receitas.toFixed(2)}</p>
            </article>
            <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
              <p className="text-sm text-ink/70">Despesas</p>
              <p className="text-xl font-semibold">R$ {data.despesas.toFixed(2)}</p>
            </article>
            <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
              <p className="text-sm text-ink/70">Saldo</p>
              <p className="text-xl font-semibold">R$ {data.saldo.toFixed(2)}</p>
            </article>
            <button
              type="button"
              className="rounded-2xl border border-ink/10 bg-white p-4 text-left shadow-sm"
              onClick={() => {
                setParcelasOpen(true);
              }}
            >
              <p className="text-sm text-ink/70">Comprometimento parcelas</p>
              <p className="text-xl font-semibold">{(data.comprometimentoParcelas * 100).toFixed(1)}%</p>
              <p className="mt-1 text-xs text-ink/60">
                WALKER 100% + AMBOS 60% + AMBOS_I 40%. Toque para detalhes.
              </p>
            </button>
          </div>

          <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">Divisao por atribuicao</h2>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              <p>WALKER final: R$ {data.totalPorAtribuicao.walkerFinal.toFixed(2)}</p>
              <p>DEA final: R$ {data.totalPorAtribuicao.deaFinal.toFixed(2)}</p>
              <p>RECEBER/PAGAR DEA: R$ {data.receberPagarDEA.toFixed(2)}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Total por categoria</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left">
                    <th className="px-2 py-2">Categoria</th>
                    <th className="px-2 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.totalPorCategoria.map((item) => (
                    <tr key={item.categoria} className="border-b border-ink/5">
                      <td className="px-2 py-2">{item.categoria}</td>
                      <td className="px-2 py-2">R$ {item.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {parcelasOpen ? (
        <div className="fixed inset-0 z-[120]">
          <button
            type="button"
            aria-label="Fechar detalhe de parcelas"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setParcelasOpen(false)}
          />
          <section className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-28 shadow-2xl md:pb-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Parcelas ativas ({month})</h2>
                <p className="text-sm text-ink/70">WALKER 100% + AMBOS 60% + AMBOS_I 40%.</p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-ink/20 px-3 py-1 text-sm"
                onClick={() => setParcelasOpen(false)}
              >
                Fechar
              </button>
            </div>

            {parcelasLoading && !parcelasDetalhe ? (
              <div className="space-y-2">
                <div className="h-16 animate-pulse rounded-lg bg-sand" />
                <div className="h-16 animate-pulse rounded-lg bg-sand" />
                <div className="h-16 animate-pulse rounded-lg bg-sand" />
              </div>
            ) : null}

            {parcelasError ? (
              <div className="rounded-lg border border-coral/30 bg-coral/10 p-3">
                <p className="text-sm text-coral">{parcelasError}</p>
                <button
                  type="button"
                  className="mt-2 rounded border border-ink/20 px-3 py-1 text-sm"
                  onClick={() => void loadParcelasDetalhe(month)}
                >
                  Tentar novamente
                </button>
              </div>
            ) : null}

            {parcelasDetalhe ? (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <article className="rounded-lg border border-ink/10 bg-sand p-3">
                    <p className="text-xs text-ink/70">Parcelas do mes</p>
                    <p className="text-lg font-semibold">R$ {parcelasDetalhe.totalParcelasMes.toFixed(2)}</p>
                  </article>
                  <article className="rounded-lg border border-ink/10 bg-sand p-3">
                    <p className="text-xs text-ink/70">Total parcelado em aberto</p>
                    <p className="text-lg font-semibold">R$ {parcelasDetalhe.totalParceladoEmAberto.toFixed(2)}</p>
                  </article>
                </div>

                {parcelasDetalhe.compras.length === 0 ? (
                  <p className="rounded-lg border border-ink/10 bg-sand p-3 text-sm text-ink/70">
                    Sem parcelas ativas neste mes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {parcelasDetalhe.compras.map((item) => (
                      <article key={`${item.origem}-${item.id}`} className="rounded-lg border border-ink/10 p-3 text-sm">
                        <p className="font-medium">{item.descricao}</p>
                        <p className="text-xs text-ink/60">
                          {item.origem === "cartoes" ? "Cartao" : "Lancamento"}
                          {item.cartao ? ` | ${item.cartao}` : ""}
                          {item.categoria ? ` | ${item.categoria}` : ""}
                          {item.estimado ? " | estimado" : ""}
                        </p>
                        <div className="mt-2 grid gap-1 text-xs text-ink/80 md:grid-cols-2">
                          <p>Parcela: R$ {item.valorParcela.toFixed(2)}</p>
                          <p>Valor total: R$ {item.valorTotalCompra.toFixed(2)}</p>
                          <p>
                            Pagas: {item.pagas}/{item.totalParcelas}
                          </p>
                          <p>Faltam: {item.restantes}</p>
                        </div>
                        {item.mesesFuturos.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.mesesFuturos.slice(0, 6).map((future) => (
                              <span
                                key={`${item.id}-${future}`}
                                className="rounded-full border border-ink/15 bg-sand px-2 py-0.5 text-[11px] text-ink/70"
                              >
                                {formatMonthShort(future)}
                              </span>
                            ))}
                            {item.mesesFuturos.length > 6 ? (
                              <span className="rounded-full border border-ink/15 bg-sand px-2 py-0.5 text-[11px] text-ink/70">
                                +{item.mesesFuturos.length - 6}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
