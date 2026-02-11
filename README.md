# Financas Pessoais (MVP) - Next.js + Google Sheets

App de financas pessoais com foco em lancamento rapido, relatorios, alertas e importacao da planilha legada, mantendo Google Sheets como fonte da verdade.

## 1) Requisitos
- Node.js 20+
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
- `npm run lovable:install` -> instala dependencias do front Lovable (`lovable-app`)
- `npm run lovable:dev` -> front Lovable em `http://localhost:5173` (consome API via proxy para `:3000`)
- `npm run lovable:build` -> build do front Lovable
- `npm run typecheck` -> validacao TypeScript
- `npm test` -> testes de dominio (60/40, RECEBER/PAGAR DEA)
- `npm run alertas` -> checa vencimentos e envia email (e opcionalmente Calendar)
- `npm run importar:cli -- --config ./import-config.example.json` -> importador CLI
- `node scripts/importar.js --config ./import-config.example.json` -> wrapper CLI solicitado

## 3.1) Front compatível com Lovable (React + Vite + TS + Tailwind)
Foi iniciado um frontend paralelo em `lovable-app` para compatibilidade direta com o Lovable.

Estado atual da migracao:
- shell de navegacao mobile
- Dashboard funcional consumindo `/api/dashboard`, `/api/lancamentos`, `/api/sync/*`
- rotas placeholder para demais telas (`cartoes`, `relatorios`, `categorias`, etc.)

Como rodar local em paralelo:
1. terminal A: `npm run dev` (backend/app atual Next em `:3000`)
2. terminal B: `npm run lovable:install` (uma vez)
3. terminal B: `npm run lovable:dev` (frontend Lovable em `:5173`)

Configuracao opcional:
- `lovable-app/.env` com `VITE_API_BASE_URL=https://seu-backend`
- sem `VITE_API_BASE_URL`, o Vite usa proxy local para `http://localhost:3000`

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
