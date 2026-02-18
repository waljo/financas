# Mobile Offline Sync - Implementacao

## Objetivo
Entregar uma variante mobile instalavel (PWA) que funcione offline para cadastro operacional e sincronize com Google Sheets legado somente sob demanda, em modo single-user.

## Escopo implementado
- Feature flag: `MOBILE_OFFLINE_MODE`.
- PWA: manifest + icones + service worker.
- Fila local no cliente (IndexedDB) para novos lancamentos.
- Tela `/sync` com status, pendentes e botao `Sincronizar agora`.
- Push em lote para Apps Script (`addLancamentosBatch`) via API interna.
- Fallback automatico: sem `APPS_SCRIPT_*`, o push ocorre direto no Google Sheets via OAuth existente.
- Sem pull inicial do legado (evita conflito).

## Arquitetura

### 1) Feature flag
- Arquivo: `src/lib/mobileOffline/flags.ts`
- Comportamento:
  - `false`: fluxo atual permanece (Sheets-first direto).
  - `true`: ativa PWA/SW e fluxo de fila + sync manual.

### 2) IndexedDB local
- Arquivo: `src/lib/mobileOffline/db.ts`
- Stores:
  - `lancamentos_local`: `id, payload, synced, created_at, updated_at`
  - `sync_state`: `id=global, last_sync_at, last_sync_status, last_sync_error`

### 3) Queue e sync client-side
- Arquivo: `src/lib/mobileOffline/queue.ts`
- Funcoes principais:
  - `enqueueLancamentoLocal(...)`
  - `readSyncDashboard()`
  - `syncLancamentosNow()`
- Regras:
  - gera/garante UUID por item
  - deduplica por `id` antes do envio
  - atualiza `sync_state` em sucesso/erro

### 4) Backend de sync
- Arquivos:
  - `src/lib/mobileOffline/appsScriptClient.ts`
  - `src/app/api/sync/push/route.ts`
  - `src/app/api/sync/health/route.ts`
- Fluxo:
  - `/api/sync/push` valida lote, deduplica, normaliza timestamps e encaminha para Apps Script.
  - autenticacao por `APPS_SCRIPT_APP_TOKEN` (header + corpo `appToken`).
  - sem Apps Script configurado, `/api/sync/push` faz insercao direta em `LANCAMENTOS` com dedupe por `id`.
  - `/api/sync/health` valida disponibilidade do Web App.

### 4.1) Bootstrap para cliente nativo
- Arquivo:
  - `src/app/api/mobile/bootstrap/route.ts`
- Endpoint:
  - `GET /api/mobile/bootstrap`
- Retorno:
  - snapshot completo para hidratar banco local nativo (`lancamentos`, `contas_fixas`, `calendario_anual`, `receitas_regras`, `categorias`, `cartoes`, `cartao_movimentos`)

### 5) UI
- `src/app/lancar/page.tsx`
  - quando flag ativa, `POST` direto vira enqueue local.
  - consulta do mes mescla remoto + local por `id`.
- `src/app/sync/page.tsx`
  - mostra conectividade, ultima sync, pendentes e lista da fila.
- `src/components/AppNav.tsx`
  - adiciona entradas `Sync` e `Offline` no menu quando flag ativa.

### 6) PWA
- Arquivos:
  - `src/app/manifest.ts`
  - `public/sw.js`
  - `public/icons/*`
  - `src/components/PwaRegistrar.tsx`
  - `src/app/offline/page.tsx`
- Registro do SW ocorre apenas com `MOBILE_OFFLINE_MODE=true`.

## Fluxo fim a fim (online/offline)
1. Usuario abre `/lancar`.
2. Cadastra lancamento (online ou offline).
3. App grava localmente em `lancamentos_local` com `synced=false`.
4. Usuario abre `/sync` e toca `Sincronizar agora` quando estiver online.
5. API envia lote para Apps Script `addLancamentosBatch`.
6. Retorno de sucesso marca itens locais como `synced=true`.

## Dedupe
- Cliente: dedupe por `id` no lote.
- Destino Apps Script: ignora IDs ja existentes na aba `LANCAMENTOS`.

## Trade-offs
- Nao foi implementado pull inicial para evitar conflitos e simplificar merge.
- Edicao/exclusao de receitas permanece no fluxo online; no modo offline mobile exibimos bloqueio explicito.
- Service worker faz cache do shell e fallback de navegacao; APIs continuam network-first.

## Como testar

### 1) Build
- `npm run typecheck`
- `npm run build`

### 2) Fluxo offline local
1. Ative `MOBILE_OFFLINE_MODE=true` no `.env.local`.
2. Rode `npm run mobile:lan`.
3. Abra no Android (mesma rede).
4. Cadastre lancamentos em `/lancar` (com internet desligada para validar offline).
5. Verifique pendencias em `/sync`.

### 3) Sync manual
1. Configure `APPS_SCRIPT_WEB_APP_URL` e `APPS_SCRIPT_APP_TOKEN`.
2. Clique `Sincronizar agora` em `/sync`.
3. Confirme `pending=0` e registros na aba `LANCAMENTOS`.
4. Repita o sync com os mesmos IDs e valide que o Apps Script ignora duplicados.
