# SPEC - Mobile Offline Sync (PWA + Sync Sob Demanda)

## Objetivo
Criar uma nova versão mobile instalável (Android/PWA), offline-first para cadastro/consulta operacional, com sincronização manual para Google Sheets legado somente ao clicar em **Sincronizar agora**, sem quebrar o comportamento atual quando a feature estiver desativada.

## Decisões de arquitetura
- Feature flag principal: `MOBILE_OFFLINE_MODE`.
- Modo padrão (flag `false`): comportamento atual intacto (Sheets-first via APIs existentes).
- Modo mobile offline (flag `true`):
  - lançamentos novos em `/lancar` entram em fila local (IndexedDB), sem `POST` imediato no Sheets;
  - sincronização ocorre apenas via botão em `/sync`.
- PWA:
  - `manifest` + ícones + service worker;
  - cache básico de shell/rotas e fallback de navegação para `/offline`.

## Fluxo offline/sync
1. Usuário cria lançamento em `/lancar`.
2. App gera `id` UUID no cliente e salva em `lancamentos_local` com `synced=false`.
3. Tela `/sync` mostra pendências e estado da última tentativa.
4. Usuário clica **Sincronizar agora**:
   - valida conectividade;
   - envia lote para API interna `/api/sync/push`;
   - API interna encaminha para Apps Script Web App (`/addLancamentosBatch`) com `X-APP-TOKEN`;
   - se Apps Script nao estiver configurado, usa fallback direto no Google Sheets via OAuth existente;
   - em sucesso, app marca registros como `synced=true` e atualiza `sync_state`.
5. Pull do Sheets fica fora do escopo inicial (somente push).

## IndexedDB
- Store `lancamentos_local`:
  - `id`, `payload`, `synced`, `created_at`, `updated_at`
- Store `sync_state`:
  - `id` (`global`), `last_sync_at`, `last_sync_status`

## Dedupe
- ID obrigatório UUID por lançamento.
- Cliente deduplica por `id` antes do envio em lote.
- Apps Script ignora duplicados por `id` na aba `LANCAMENTOS`.

## Arquivos previstos (alterar/criar)
- Feature flag e boot:
  - `src/app/layout.tsx`
  - `src/components/FeatureFlagsProvider.tsx` (novo)
  - `src/components/PwaRegistrar.tsx` (novo)
- PWA:
  - `src/app/manifest.ts` (novo)
  - `public/sw.js` (novo)
  - `public/icons/*` (novos)
  - `src/app/offline/page.tsx` (novo)
- Offline queue:
  - `src/lib/mobileOffline/db.ts` (novo)
  - `src/lib/mobileOffline/queue.ts` (novo)
- Sync sob demanda:
  - `src/app/api/sync/push/route.ts` (novo)
  - `src/app/sync/page.tsx` (novo)
  - `scripts/sync.ts` (novo, opcional CLI)
- Integração UI existente:
  - `src/app/lancar/page.tsx`
  - `src/components/AppNav.tsx`
- Documentação/config:
  - `.env.example`
  - `README.md`
  - `SPEC.md` (adendo resumido)
  - `docs/MOBILE_OFFLINE_SYNC.md` (novo)

## Estratégia de risco mínimo
- Mudanças condicionadas por `MOBILE_OFFLINE_MODE`.
- Rotas e regras de negócio atuais mantidas.
- Sem alteração do schema remoto existente.
