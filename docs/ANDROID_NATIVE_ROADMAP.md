# Android Nativo - Roadmap de Migracao

## Objetivo final
Entregar um app Android nativo (React Native) em que o banco local do celular seja a fonte de verdade operacional. O Google Sheets vira somente destino de sincronizacao manual.

## Decisao tecnica
- Runtime nativo: React Native (Expo).
- Banco local: SQLite no device.
- Sincronizacao: push manual para backend atual (`/api/sync/push`) + bootstrap inicial completo (`/api/mobile/bootstrap`).
- Regra de ouro: nenhuma tela principal depende de internet para funcionar.

## Fases

### Fase 1 - Backend de suporte ao nativo
Status: concluida

Entregaveis:
- contrato de bootstrap para o app nativo;
- endpoint de snapshot completo para hidratar banco local no celular;
- reaproveitamento do sync manual existente.

Resultado esperado:
- app nativo consegue fazer carga inicial completa (uma vez online) e depois operar offline.

### Fase 2 - Casca do app Android nativo
Status: em andamento

Entregaveis:
- projeto `apps/android-native`;
- navegacao e layout mobile-first equivalente ao app atual;
- camada de repositorio local (SQLite) e fila de operacoes.

Resultado esperado:
- lancamentos, categorias, contas fixas, calendario e cartoes funcionando localmente.

Progresso atual:
- lancamentos: CRUD local + fila de sync.
- contas fixas: CRUD local + fila de sync.
- categorias: CRUD local + uso nos formularios + fila de sync.
- calendario anual: CRUD local + fila de sync.
- cartoes e movimentos: CRUD/classificacao local + fila de sync.
- receitas_regras: CRUD local + fila de sync.
- sincronizacao: historico local detalhado de eventos (sync_logs).
- analytics local: dashboard mensal e projecao 90 dias offline.
- relatorios locais: resumo mensal e detalhe de parcelas ativas offline.
- comparativo local: visao mensal acumulada dos ultimos 12 meses.
- ux de formularios: lancamentos com seletores de enum e atalho de data.
- paridade funcional com fluxos da main concluida (crud completo, relatorios, importacao e operacoes avancadas via ferramentas online).

### Fase 3 - Fluxo de sincronizacao bidirecional controlado
Status: pendente

Entregaveis:
- bootstrap incremental (delta por `updated_at`);
- politicas de conflito por entidade;
- painel de sync no app nativo com diagnostico detalhado.

Resultado esperado:
- usuario consegue operar 100% offline e sincronizar quando quiser, sem perda de dados.

### Fase 4 - Publicacao Android
Status: pendente

Entregaveis:
- assinatura/release;
- pipeline de build Android;
- distribuicao via APK interno e/ou Play Store.

Resultado esperado:
- instalacao nativa definitiva no Android, sem dependencia de PWA.

## Criticos de arquitetura
- Fonte de verdade operacional: local no device.
- Sync manual e explicito: nunca automatico por tras.
- Sem bloquear UX por indisponibilidade de Sheets/OAuth.
- Migracao sem regressao no app web atual.
