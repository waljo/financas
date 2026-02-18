# Android Nativo - Implementacao Atual

## Entregue nesta etapa

### 1) Contrato e bootstrap backend
- Contrato: `src/lib/mobileNative/contracts.ts`
- Endpoint: `src/app/api/mobile/bootstrap/route.ts`
- Funcoes:
  - snapshot completo para hidratacao local;
  - contadores por entidade;
  - parametro `include_inactive_categories`.

### 2) Base do app Android (Expo)
- Pasta: `apps/android-native`
- Banco local: SQLite (`entity_rows`, `sync_ops`, `sync_state`)
- Arquivos principais:
  - `apps/android-native/App.js`
  - `apps/android-native/src/db/store.js`
  - `apps/android-native/src/bootstrap/bootstrapService.js`
  - `apps/android-native/src/sync/manualSync.js`

### 3) Fluxos funcionais iniciais
- Bootstrap completo do backend para SQLite local.
- Fila local de operacoes.
- Sync manual da fila para `/api/sync/push`.
- Resumo local com contagens por entidade e estado de sync.
- Cadastro e exclusao local de lancamentos com enfileiramento de sync.
- Cadastro e exclusao local de contas fixas com enfileiramento de sync.
- Cadastro e exclusao local de categorias com enfileiramento de sync.
- Cadastro/exclusao local de cartoes.
- Cadastro/classificacao/exclusao local de compras de cartao.
- Selecao de categorias locais nos formularios de lancamentos e contas fixas.
- Cadastro e exclusao local de eventos do calendario anual com enfileiramento de sync.
- Cadastro e exclusao local de receitas_regras (fonte para projecoes).
- Historico detalhado de sincronizacao persistido localmente (sync_logs).
- Dashboard local (resumo mensal) calculado diretamente do banco local.
- Projecao de 90 dias local calculada offline com base no historico local.
- Relatorio mensal detalhado local (totais, atribuicao, categorias).
- Detalhe local de parcelas ativas (lancamentos + cartao_movimentos).
- Comparativo mensal local (janela de 12 meses com acumulados).
- UX de formulario de lancamentos melhorada: seletores de tipo/atribuicao/metodo/quem pagou e atalho para data de hoje.
- Edicao local implementada para lancamentos, contas fixas, categorias, calendario, regras de receita, cartoes e compras.
- Lista de lancamentos com busca, filtro por categoria, ordenacao e paginacao.
- Ferramentas online no app nativo para paridade funcional da web:
  - reparar conexao (`/api/bootstrap`) e sync health (`/api/sync/health`);
  - importador historico (`/api/importar/metadata`, `/preview`, `/run`);
  - normalizacao de categorias (`/api/categorias/normalizar/preview`, `/run`);
  - cartoes avancado (`/api/cartoes/importar/preview`, `/run`, `/totalizadores`, `/gerar-lancamentos`).

## Proximos incrementos (fase 2)
1. Melhorias de UX para formularios (campos enum adicionais e menos JSON manual nas ferramentas online).
2. Filtro/paginacao no historico de sync.
3. Politica de delta download (pull incremental por `updated_at`).
