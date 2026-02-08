import { computeReport } from "@/domain/calculations";
import { splitByAtribuicao } from "@/domain/attribution";
import { jsonError, jsonOk } from "@/lib/http";
import { ensureCartoesDb, readCartaoMovimentosComAlocacoes } from "@/lib/sheets/cartoesClient";
import { readLancamentos } from "@/lib/sheets/sheetsClient";
import { reportQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mes = searchParams.get("mes") ?? "";
    const query = reportQuerySchema.parse({ mes });

    const lancamentos = await readLancamentos();
    const report = computeReport(query.mes, lancamentos);

    const parcelasLancamentosCartaoWalker = lancamentos
      .filter((item) => item.data.startsWith(query.mes))
      .filter((item) => item.tipo === "despesa")
      .filter((item) => item.parcela_total && item.parcela_total > 1)
      .filter((item) => item.metodo === "cartao")
      .reduce((acc, item) => acc + splitByAtribuicao(item.atribuicao, item.valor).walker, 0);

    let parcelasCartaoMesWalker = 0;
    try {
      await ensureCartoesDb();
      const movimentosCartao = await readCartaoMovimentosComAlocacoes();
      parcelasCartaoMesWalker = movimentosCartao
        .filter((item) => item.mes_ref === query.mes)
        .filter((item) => item.parcela_total && item.parcela_total > 1)
        .reduce(
          (acc, item) =>
            acc +
            item.alocacoes.reduce(
              (sum, alocacao) => sum + splitByAtribuicao(alocacao.atribuicao, alocacao.valor).walker,
              0
            ),
          0
        );
    } catch {
      parcelasCartaoMesWalker = 0;
    }

    const parcelasWalkerCartao = parcelasLancamentosCartaoWalker + parcelasCartaoMesWalker;
    const comprometimentoWalkerCartao = report.receitas > 0 ? parcelasWalkerCartao / report.receitas : 0;
    const reportWithWalkerCartao = {
      ...report,
      comprometimentoParcelas: comprometimentoWalkerCartao
    };

    return jsonOk({ data: reportWithWalkerCartao });
  } catch (error) {
    return jsonError(error);
  }
}
