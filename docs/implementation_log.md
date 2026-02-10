# Implementation Log

Registro incremental de mudancas tecnicas no projeto.

## 2026-02-10 - RFC de sync offline-first
Resumo:
- Formalizado o contrato tecnico de sincronizacao offline/online.
- Definidos endpoints `pull/push/status/run`, modelo de conflito, idempotencia e observabilidade.
- Documentados paths alvo para implementacao incremental.

Arquivos alterados:
- `docs/rfc_offline_sync_api.md`
- `README.md`

Validacao:
- `npm run lint` sem erros.

## 2026-02-10 - Fase 1 (sync manual + status mobile)
Resumo:
- Criada engine de sincronizacao manual para recarregar cache local de lancamentos a partir do Google Sheets.
- Criados endpoints:
  - `GET /api/sync/status`
  - `POST /api/sync/run`
- Atualizada navegacao mobile (`menu mais`) com:
  - status de sincronizacao,
  - botao `Sincronizar agora`,
  - indicador visual online/offline no topo.

Arquivos alterados:
- `src/lib/sheets/lancamentosCacheClient.ts`
- `src/lib/sync/engine.ts`
- `src/app/api/sync/status/route.ts`
- `src/app/api/sync/run/route.ts`
- `src/components/AppNav.tsx`

Validacao:
- `npm run typecheck` sem erros.
- `npm run lint` sem erros.

## 2026-02-10 - Checklist de deploy (Fase 1)
Resumo:
- Criado checklist operacional de deploy para acesso fora da rede local.
- Inclui setup Google Cloud, variaveis de ambiente, persistencia SQLite, validacao pos-deploy e rollback.

Arquivos alterados:
- `docs/deploy_checklist.md`
- `README.md`

## 2026-02-10 - Execucao tecnica do checklist (Railway)
Resumo:
- Preparado projeto para deploy Docker no Railway com `Next.js standalone`.
- Adicionado healthcheck em `GET /api/health`.
- Adicionada protecao opcional de Basic Auth via middleware:
  - `APP_BASIC_AUTH_USER`
  - `APP_BASIC_AUTH_PASS`
- Criado runbook operacional Railway e script de smoke test de producao.

Arquivos alterados:
- `Dockerfile`
- `.dockerignore`
- `railway.json`
- `next.config.mjs`
- `middleware.ts`
- `src/app/api/health/route.ts`
- `.env.example`
- `docs/deploy_railway_runbook.md`
- `scripts/smoke_deploy.sh`
- `docs/deploy_checklist.md`
- `README.md`

Validacao:
- `npm run lint` sem erros.
- `npm run typecheck` sem erros.
- `npm run build` sem erros.

Observacao:
- A criacao do projeto no Railway e o deploy final na sua conta dependem de login/credenciais do provedor.
- O comando `railway login --browserless` nao executa neste terminal por modo nao interativo.

## 2026-02-10 - Correcao de bloqueio de seguranca Railway
Resumo:
- Atualizado `next` para `14.2.35` e `eslint-config-next` para `14.2.35` para atender o bloqueio de vulnerabilidade do deploy no Railway.

Arquivos alterados:
- `package.json`
- `package-lock.json`

Validacao:
- `npm run lint` sem erros.
- `npm run typecheck` sem erros.
- `npm run build` com `Next.js 14.2.35`.

## 2026-02-10 - Correcao de build Railway (node:sqlite)
Resumo:
- Ajustado `Dockerfile` para `node:24-alpine` em todos os estagios.
- Motivo: erro de build em `/api/cartoes/importar/run` ao coletar page data por uso de `node:sqlite`.

Arquivos alterados:
- `Dockerfile`
- `README.md`
- `docs/deploy_checklist.md`

## 2026-02-10 - Fase 2 (offline leitura via Service Worker)
Resumo:
- Implementado Service Worker para cache offline de leitura.
- Registro automatico do SW na navegacao principal.
- Adicionado aviso de modo offline por cache no menu de sincronizacao.
- Reforcado pre-cache para conviver com Basic Auth e adicionado fallback `offline.html`.

Arquivos alterados:
- `public/sw.js`
- `public/offline.html`
- `src/components/AppNav.tsx`
- `middleware.ts`
- `README.md`

## 2026-02-10 - Fase 3 (escrita offline inicial)
Resumo:
- Implementada outbox local de lancamentos para `POST/PUT/DELETE`.
- Operacoes de lancamento na tela `/lancar` agora entram na fila quando offline.
- Sincronizacao automatica ao reconectar e opcao manual de flush de pendencias.
- Menu inferior (`Mais`) passou a mostrar pendencias offline e incluir flush antes da sync manual.
- Refinada deteccao offline por ping em `/api/health` e cache de assets `/_next/*` no Service Worker.

Arquivos alterados:
- `src/lib/offline/lancamentosOutbox.ts`
- `src/app/lancar/page.tsx`
- `src/components/AppNav.tsx`
- `README.md`
