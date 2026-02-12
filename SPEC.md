# SPEC - MVP Financas Pessoais (Sheets-first)

## Objetivo
Construir um app web (Next.js + TypeScript + Tailwind) para lancamentos rapidos, relatorios, alertas e importacao historica, mantendo compatibilidade total com Google Sheets como fonte da verdade.

## Decisoes de arquitetura
- Stack: Next.js (App Router) + TypeScript + Tailwind.
- Fonte da verdade (MVP): Google Sheets.
- Integracoes Google: OAuth2 via `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN` em `.env.local`.
- Camadas:
  - `src/lib/sheets`: autenticacao OAuth + wrappers de leitura/escrita.
  - `src/domain`: regras financeiras (divisao 60/40, saldos, relatorios, projecoes).
  - `src/app`: UI e APIs (App Router).
  - `scripts`: alertas, setup Google, importador CLI.

## Compatibilidade com planilha antiga
Regras preservadas da planilha `Contas Fixas.xlsx`:
1. `TOTAL DESPESAS` (linha equivalente ao C4):
   - WALKER = 100%
   - DEA = 0% para Walker
   - AMBOS = 60% Walker / 40% DEA
   - AMBOS_I = 40% Walker / 60% DEA
2. `RECEBER/PAGAR DEA` (equivalente ao C5): mantido usando `atribuicao` + `quem_pagou`.
3. `BALANCO (SALDO REAL - SISTEMA)`:
   - saldo real = banco consolidado (BB + C6) + carteira
   - saldo sistema = receitas recebidas - pagamentos feitos
4. Regra Petrobras:
   - receitas do mes = salario D-25 do mes anterior + salario D-10 do mes corrente
   - no D-25, AMS grande risco + assistencia suplementar entram como receita
   - esses mesmos valores entram tambem como despesa `AMBOS`
   - extensivel para despesas adicionais relacionadas (ex.: odontologico)

## Modelo normalizado no Sheets
Abas garantidas:
- `LANCAMENTOS`
- `CONTAS_FIXAS`
- `CALENDARIO_ANUAL`
- `RECEITAS_REGRAS`

### Colunas
`LANCAMENTOS`:
- id, data, tipo, descricao, categoria, valor, atribuicao, metodo,
- parcela_total, parcela_numero, observacao,
- created_at, updated_at,
- `quem_pagou` (extensao necessaria para preservar C5 e D3)

`CONTAS_FIXAS`:
- id, nome, dia_vencimento, valor_previsto, atribuicao, categoria,
- avisar_dias_antes, ativo

`CALENDARIO_ANUAL`:
- id, mes, evento, valor_estimado, avisar_dias_antes, atribuicao,
- categoria, observacao
- `dia_mes` opcional (quando ausente, assume dia 1)

`RECEITAS_REGRAS`:
- chave, valor

## Endpoints/API (App Router)
- `POST /api/bootstrap`
  - garante abas e cabecalhos no Sheets.
- `GET /api/lancamentos?mes=YYYY-MM`
- `POST /api/lancamentos`
- `PUT /api/lancamentos`
- `DELETE /api/lancamentos?id=...`
- `GET /api/contas-fixas`
- `POST /api/contas-fixas`
- `PUT /api/contas-fixas`
- `DELETE /api/contas-fixas?id=...`
- `GET /api/calendario-anual`
- `POST /api/calendario-anual`
- `PUT /api/calendario-anual`
- `DELETE /api/calendario-anual?id=...`
- `GET /api/relatorios?mes=YYYY-MM`
- `GET /api/dashboard?mes=YYYY-MM`
- `GET /api/importar/metadata`
  - lista abas de origem e detecta blocos mensais.
- `POST /api/importar/preview`
  - estima linhas a importar com mapeamento.
- `POST /api/importar/run`
  - importa para `LANCAMENTOS` com UUID.

## Funcoes de dominio principais
- `splitByAtribuicao(atribuicao, valor)`
- `computeMonthlyBalance(lancamentosMes)`
- `computeReceberPagarDEA(lancamentosMes)`
- `computeComprometimentoParcelas(lancamentosMes, receitasMes)`
- `computeProjection90Days({ lancamentos, contasFixas, calendarioAnual, receitasRules })`
- `applyPetrobrasRules(...)`

## Fluxos de UI
Paginas:
- `/` Dashboard
- `/lancar` novo lancamento (mobile-first)
- `/contas-fixas` CRUD
- `/calendario-anual` CRUD
- `/relatorios` filtros por mes
- `/importar` importador guiado em 5 passos
  - suporta importacao de `despesas` e `receitas` do layout legado

## Scripts
- `npm run setup:google` - guia pratico para configurar OAuth no Google Cloud.
- `npm run alertas` - verifica vencimentos e envia email (Gmail API) e opcionalmente cria eventos no Calendar.
- `npm run importar:cli -- --config ./import-config.json` - importacao via JSON.

## Validacoes e erros
- Zod para validar payloads de API e linhas importadas.
- Tratamento padronizado de erro (status HTTP + mensagem clara).
- Falhas de credencial Google retornam instrucoes de correcao no erro.

## Fora do escopo imediato (MVP+)
- Multiusuario completo com ACL.
- Banco relacional secundario.
- Agendamento cron em producao (fica preparado, execucao manual local inicialmente).

## Processo de Desenvolvimento Assistido por IA

Este projeto utiliza IA (Codex) como ferramenta de apoio ao desenvolvimento,
seguindo um framework estruturado de prompts versionados.

### Objetivos do uso de IA
- aumentar consistência de decisões técnicas e de produto
- garantir aderência ao escopo do MVP
- manter padrões éticos e legais em funcionalidades financeiras
- reforçar UX mobile-first em todas as interfaces

### Autoridade de decisão
Ao utilizar Codex/IA, os seguintes arquivos devem ser considerados como fonte de verdade:
- `SPEC.md`
- `prompts/system.md`
- `prompts/router.md`
- `docs/legal_guardrails.md`

### Modos especializados
A IA pode operar sob modos especializados conforme a tarefa:
- Planejamento Financeiro (decisão, risco, metas)
- Micro-SaaS (MVP, escopo, métricas)
- UX Mobile (smartphone-first)
- Análise de Comportamento (fricção e erro do usuário)

A escolha dos modos segue as regras definidas em `prompts/router.md`.

### Limites
- O uso de IA não substitui revisão humana
- A IA não recomenda produtos financeiros
- A IA não assume responsabilidade técnica ou legal

## Addendum - Mobile Offline Sync (2026-02-12)
- Feature flag `MOBILE_OFFLINE_MODE` controla a nova versao mobile offline sem alterar o fluxo padrao.
- PWA adicionada com manifest, icones e service worker para instalacao no Android.
- Cadastro offline em `/lancar` salva em IndexedDB (`lancamentos_local`) com `id` UUID e status `synced`.
- Sincronizacao sob demanda em `/sync` (push em lote para Apps Script Web App) via botao `Sincronizar agora`.
- Dedupe por `id` no lote enviado e no destino (Apps Script), sem pull inicial do legado para evitar conflitos.
