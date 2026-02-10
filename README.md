# Financas Pessoais (MVP) - Next.js + Google Sheets

App de financas pessoais com foco em lancamento rapido, relatorios, alertas e importacao da planilha legada, mantendo Google Sheets como fonte da verdade.

## 1) Requisitos
- Node.js 24+
- npm 10+
- Conta Google com acesso a:
  - Google Sheets API
  - Gmail API
  - Google Calendar API (opcional)

## 2) Setup rapido
1. Copie variaveis de ambiente:
   - `cp .env.example .env.local`
2. Configure credenciais Google em `.env.local`.
3. Instale dependencias:
   - `npm install`
4. Configure OAuth guiado:
   - `npm run setup:google`
5. Garanta as abas normalizadas no Sheets:
   - `npm run bootstrap:sheets`
6. Rode o app local:
   - `npm run dev`

## 3) Scripts principais
- `npm run dev` -> app local em `http://localhost:3000`
- `npm run typecheck` -> validacao TypeScript
- `npm test` -> testes de dominio (60/40, RECEBER/PAGAR DEA)
- `npm run alertas` -> checa vencimentos e envia email (e opcionalmente Calendar)
- `npm run importar:cli -- --config ./import-config.example.json` -> importador CLI
- `node scripts/importar.js --config ./import-config.example.json` -> wrapper CLI solicitado
- `./scripts/smoke_deploy.sh https://SEU_DOMINIO YYYY-MM` -> smoke test de deploy em producao

## 3.1) Sincronizacao (Fase 1)
- `GET /api/sync/status` -> retorna estado atual da sincronizacao e cache local.
- `POST /api/sync/run` -> executa sincronizacao manual (recarrega cache local a partir do Sheets).
- UI mobile: menu `Mais` contem o card de status e acao `Sincronizar agora`.

## 4) Estrutura do projeto
- `src/lib/sheets` -> OAuth + wrapper de leitura/escrita no Sheets
- `src/domain` -> regras financeiras (divisao, saldo, projecao)
- `src/app` -> UI + rotas API
- `scripts` -> alertas, setup Google, bootstrap e importador CLI

## 5) Abas normalizadas no Google Sheets
O bootstrap garante:
- `LANCAMENTOS`
- `CONTAS_FIXAS`
- `CALENDARIO_ANUAL`
- `RECEITAS_REGRAS`

### Colunas
`LANCAMENTOS`
- id, data, tipo, descricao, categoria, valor, atribuicao, metodo,
- parcela_total, parcela_numero, observacao, created_at, updated_at,
- quem_pagou

`CONTAS_FIXAS`
- id, nome, dia_vencimento, valor_previsto, atribuicao, categoria,
- avisar_dias_antes, ativo

`CALENDARIO_ANUAL`
- id, mes, evento, valor_estimado, avisar_dias_antes, atribuicao,
- categoria, observacao, dia_mes

`RECEITAS_REGRAS`
- chave, valor

## 6) Paginas
- `/` Dashboard
- `/lancar` novo lancamento
- `/contas-fixas` CRUD de contas fixas
- `/calendario-anual` CRUD de sazonais
- `/relatorios` relatorio mensal
- `/importar` importador guiado (5 passos)

## 7) Compatibilidade com planilha antiga
Regras preservadas:
- Divisao 60/40 e AMBOS_I invertido
- `RECEBER/PAGAR DEA` com base em `atribuicao + quem_pagou`
- Balanço: `(saldo banco + carteira) - (receitas - pagamentos WALKER)`
- Regra Petrobras:
  - receitas D-25 + D-10
  - AMS grande risco e assistencia suplementar entram como receita e despesa compartilhada
  - permite despesas extras (ex.: odontologico)

## 8) Importacao historica
### GUI (`/importar`)
1. Selecione aba origem (ex.: 2026)
2. Escolha tipo de importacao (`despesa` ou `receita`)
3. Selecione um ou varios meses (multi-selecao)
4. Informe range de linhas
  - receitas legadas normalmente: linhas 11-15
  - despesas legadas normalmente: linhas 17+
5. Mapeie colunas
6. Gere preview por mes (quantidade + amostra + status de ja importado)
7. Execute importacao em lote

Observacao:
- A opcao \"Pular meses ja importados\" evita reimportar meses que ja tenham lancamentos no sistema.

### CLI
- Edite `import-config.example.json`
- Rode:
  - `node scripts/importar.js --config ./import-config.example.json`

## 9) Alertas
`npm run alertas`:
- Contas fixas: dispara quando `dias ate vencimento` bate com `avisar_dias_antes`
- Sazonais: usa `mes + dia_mes` (ou dia 1 por padrao)
- Email: Gmail API
- Calendar: opcional com `CREATE_CALENDAR_EVENTS=true`

## 10) Seguranca
- Nunca commitar `.env.local`, refresh token ou credenciais.
- `.gitignore` ja bloqueia arquivos sensiveis comuns.

## 11) Proximos passos recomendados
1. Preencher `RECEITAS_REGRAS` com valores Petrobras para melhorar projecao.
2. Definir cron (GitHub Actions/servidor) para `npm run alertas` diario.
3. Evoluir CRUD com edicao/exclusao na UI.

## Uso de IA (Codex) e Prompts do Projeto

Este projeto utiliza prompts versionados para garantir:
- consistência ética e financeira
- qualidade de UX (mobile-first)
- decisões de produto alinhadas ao MVP

### Estrutura
- `prompts/system.md`: persona base (planejador financeiro + orquestrador de produto)
- `prompts/router.md`: define quais modos usar conforme a tarefa
- `prompts/modes/`: modos especializados (financeiro, micro-SaaS, UX mobile, comportamento)
- `prompts/task_templates/`: templates de tarefas (feature, UX review, bugfix)
- `docs/legal_guardrails.md`: limites éticos e legais obrigatórios
- `docs/codex_workflow.md`: workflow oficial de uso do Codex
- `docs/rfc_offline_sync_api.md`: contrato tecnico de sync offline-first (pull/push/conflitos)
- `docs/implementation_log.md`: log incremental das implementacoes e validacoes
- `docs/deploy_checklist.md`: checklist pratico de deploy da Fase 1
- `docs/deploy_railway_runbook.md`: passo a passo de deploy no Railway

### Regra obrigatória
Ao usar Codex/IA neste projeto, considerar como autoridade:
- `prompts/system.md`
- `prompts/router.md`
- `docs/legal_guardrails.md`
- `SPEC.md`

### Prompt padrão recomendado
Ao iniciar uma tarefa com Codex, usar o padrão definido em:
`docs/codex_workflow.md`

Isso evita sugestões fora de escopo, problemas legais e inconsistências de UX.
