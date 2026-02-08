import { computeComprometimentoParcelasDetalhe, filterByMonth } from "@/domain/calculations";
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
    const lancamentosMes = filterByMonth(lancamentos, query.mes);
    const receitasMes = lancamentosMes
      .filter((item) => item.tipo === "receita")
      .reduce((acc, item) => acc + item.valor, 0);

    const items: Array<{
      id: string;
      origem: "lancamentos" | "cartoes";
      descricao: string;
      categoria?: string;
      cartao?: string | null;
      valorParcela: number;
      parcelaTotal: number | null;
      parcelaNumero: number | null;
      mesReferencia: string;
    }> = lancamentosMes
      .filter((item) => item.tipo === "despesa")
      .filter((item) => item.parcela_total && item.parcela_total > 1)
      .filter((item) => item.metodo === "cartao")
      .map((item) => ({
        id: item.id,
        origem: "lancamentos" as const,
        descricao: item.descricao,
        categoria: item.categoria,
        valorParcela: splitByAtribuicao(item.atribuicao, item.valor).walker,
        parcelaTotal: item.parcela_total,
        parcelaNumero: item.parcela_numero,
        mesReferencia: query.mes
      }))
      .filter((item) => item.valorParcela > 0.009);

    try {
      await ensureCartoesDb();
      const movimentos = await readCartaoMovimentosComAlocacoes();
      const fromCards = movimentos
        .filter((item) => item.mes_ref === query.mes)
        .filter((item) => item.parcela_total && item.parcela_total > 1)
        .map((item) => {
          const valorWalker = item.alocacoes.reduce(
            (acc, alocacao) => acc + splitByAtribuicao(alocacao.atribuicao, alocacao.valor).walker,
            0
          );

          return {
            id: item.id,
            origem: "cartoes" as const,
            descricao: item.descricao,
            categoria: "CARTAO_CREDITO",
            cartao: item.cartao?.nome ?? null,
            valorParcela: valorWalker,
            parcelaTotal: item.parcela_total,
            parcelaNumero: item.parcela_numero,
            mesReferencia: item.mes_ref
          };
        })
        .filter((item) => item.valorParcela > 0.009);
      items.push(...fromCards);
    } catch {
      // Mantem resposta com dados de LANCAMENTOS mesmo se modulo de cartoes estiver indisponivel.
    }

    const detalhe = computeComprometimentoParcelasDetalhe({
      month: query.mes,
      receitasMes,
      items
    });

    return jsonOk({ data: detalhe });
  } catch (error) {
    return jsonError(error);
  }
}
