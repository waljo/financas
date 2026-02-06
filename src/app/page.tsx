"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [saldoBanco, setSaldoBanco] = useState("");
  const [saldoCarteira, setSaldoCarteira] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [bootstrapMsg, setBootstrapMsg] = useState<string>("");

  async function fetchDashboard(nextMonth: string, nextSaldoBanco: string, nextSaldoCarteira: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ mes: nextMonth });
      if (nextSaldoBanco.trim() !== "") {
        params.set("saldoBanco", nextSaldoBanco);
      }
      if (nextSaldoCarteira.trim() !== "") {
        params.set("saldoCarteira", nextSaldoCarteira);
      }
      const response = await fetch(`/api/dashboard?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao carregar dashboard");
      }
      setData(payload.data);
      if (payload.data) {
        setSaldoBanco(String(payload.data.saldoBancoReferencia));
        setSaldoCarteira(String(payload.data.saldoCarteiraReferencia));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard(month, saldoBanco, saldoCarteira);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrapSheets() {
    setBootstrapMsg("Configurando abas...");
    const response = await fetch("/api/bootstrap", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      setBootstrapMsg(payload.message ?? "Falha no bootstrap");
      return;
    }
    setBootstrapMsg("Abas normalizadas prontas.");
    await fetchDashboard(month, saldoBanco, saldoCarteira);
  }

  const receberPagarDEA = data?.receberPagarDEA ?? 0;
  const deaLabel = receberPagarDEA > 0 ? "Receber DEA" : receberPagarDEA < 0 ? "Pagar DEA" : "Acerto DEA";
  const deaValue = Math.abs(receberPagarDEA);

  const cards = [
    { label: "Receitas do mes", value: data?.receitasMes ?? 0 },
    { label: "Despesas do mes", value: data?.despesasMes ?? 0 },
    { label: "Saldo do mes", value: data?.saldoMes ?? 0 },
    { label: "Saldo apos acerto DEA", value: data?.saldoAposAcertoDEA ?? 0 },
    { label: deaLabel, value: deaValue },
    { label: "Saldo sistema", value: data?.balancoSistema ?? 0 },
    { label: "Saldo real", value: data?.balancoReal ?? 0 },
    { label: "Balanco", value: data?.diferencaBalanco ?? 0 },
    { label: "Projecao 90 dias", value: data?.projecao90Dias?.saldoProjetado ?? 0 }
  ];

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-ink/70">
          Compatibilidade com a planilha: balanco = saldo real (BB + C6 + carteira) - saldo sistema.
        </p>
      </header>

      <div className="grid gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-sm md:grid-cols-4">
        <label className="text-sm">
          Mes
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setSaldoBanco("");
              setSaldoCarteira("");
            }}
          />
        </label>
        <label className="text-sm">
          Saldo banco (BB + C6)
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            value={saldoBanco}
            onChange={(event) => setSaldoBanco(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Carteira
          <input
            className="mt-1 w-full rounded-lg border border-ink/20 px-3 py-2"
            type="number"
            value={saldoCarteira}
            onChange={(event) => setSaldoCarteira(event.target.value)}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-ink px-4 py-2 text-sand"
            onClick={() => fetchDashboard(month, saldoBanco, saldoCarteira)}
            disabled={loading}
          >
            {loading ? "Carregando..." : "Atualizar"}
          </button>
          <button
            type="button"
            className="rounded-lg bg-pine px-4 py-2 text-white"
            onClick={bootstrapSheets}
          >
            Bootstrap abas
          </button>
        </div>
      </div>

      {data ? (
        <p className="text-sm text-ink/70">
          Fonte do saldo real:{" "}
          {data.fonteSaldoReal === "legacy"
            ? "planilha legada (C7/C8)"
            : data.fonteSaldoReal === "mixed"
              ? "misto (manual + planilha legada)"
              : "manual"}
        </p>
      ) : null}

      {bootstrapMsg ? <p className="text-sm text-pine">{bootstrapMsg}</p> : null}
      {error ? <p className="rounded-lg bg-coral/20 p-3 text-sm text-coral">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
            <p className="text-sm text-ink/70">{card.label}</p>
            <p className="mt-2 text-xl font-semibold">
              {card.value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </article>
        ))}
      </div>

      {data?.projecao90Dias ? (
        <article className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Detalhe projecao 90 dias</h2>
          <p className="text-sm text-ink/70">
            {data.projecao90Dias.periodoInicio} ate {data.projecao90Dias.periodoFim}
          </p>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <p>Receitas previstas: R$ {data.projecao90Dias.receitasPrevistas.toFixed(2)}</p>
            <p>Despesas fixas: R$ {data.projecao90Dias.despesasFixasPrevistas.toFixed(2)}</p>
            <p>Despesas sazonais: R$ {data.projecao90Dias.despesasSazonaisPrevistas.toFixed(2)}</p>
            <p>Parcelas: R$ {data.projecao90Dias.parcelasPrevistas.toFixed(2)}</p>
          </div>
        </article>
      ) : null}
    </section>
  );
}
