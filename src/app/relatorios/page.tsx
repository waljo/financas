"use client";

import { useCallback, useEffect, useState } from "react";
import type { RelatorioMensal } from "@/lib/types";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function RelatoriosPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<RelatorioMensal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  useEffect(() => {
    load();
  }, [load]);

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
            <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
              <p className="text-sm text-ink/70">Comprometimento parcelas</p>
              <p className="text-xl font-semibold">{(data.comprometimentoParcelas * 100).toFixed(1)}%</p>
            </article>
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
    </section>
  );
}
