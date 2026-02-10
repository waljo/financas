# RFC - Offline-First Sync API (Android + Web)

Status: Proposed  
Owner: Produto/Engenharia  
Scope: Contrato tecnico para sincronizacao offline-first do app atual (Next.js + Sheets-first)

## 1. Objetivo
Definir um contrato de sincronizacao que permita:
- uso offline no Android (consulta e escrita local),
- sincronizacao manual e automatica quando online,
- reconciliacao com a planilha legada sem expor tokens Google no cliente.

Este RFC cobre principalmente:
- `GET /api/sync/pull`
- `POST /api/sync/push`

Endpoints auxiliares sugeridos:
- `GET /api/sync/status`
- `POST /api/sync/run`

## 2. Premissas (codigo atual)
- Fonte de verdade atual: Google Sheets (`src/lib/sheets/sheetsClient.ts`).
- Integracao Google ocorre apenas no servidor com refresh token em env (`src/lib/config.ts`, `src/lib/sheets/auth.ts`).
- CRUD principal ja existe em rotas App Router (`src/app/api/*`).
- Sincronizacao com legado ja existe para lancamentos (`src/app/api/lancamentos/route.ts`).

## 3. Entidades sincronizadas
- `LANCAMENTOS`
- `CONTAS_FIXAS`
- `CALENDARIO_ANUAL`
- `RECEITAS_REGRAS`
- `CATEGORIAS`
- `CARTOES`
- `CARTAO_MOVIMENTOS`
- `CARTAO_ALOCACOES`

## 4. Campos de controle de sync
Para diff confiavel, cada registro deve ter (ou derivar):
- `id: string` (UUID)
- `updated_at: string` (ISO)
- `deleted_at: string | null` (soft delete para sync incremental)
- `revision: string` (hash/etag de conteudo normalizado)

Observacao:
- Onde hoje nao existe `updated_at` em certas abas, incluir migracao de schema.
- `revision` pode ser calculado no servidor sem persistir no Sheets inicialmente.

## 5. Modelo de conflito
Regra default (fase inicial):
- `server_wins` para manter consistencia do repositorio remoto.

Quando houver conflito:
- resposta retorna `conflict` por item,
- cliente marca item como "conflito" para resolucao posterior.

Politicas suportadas por operacao:
- `server_wins` (default)
- `client_wins` (apenas quando permitido)
- `manual` (pendente de resolucao humana)

## 6. Idempotencia e fila (outbox)
Cada operacao enviada pelo cliente deve conter:
- `op_id` (UUID unico por operacao)
- `device_id`
- `entity`
- `action` (`create|update|delete`)
- `base_revision` (revision conhecida no cliente no momento da edicao)
- `payload`
- `occurred_at`

Servidor deve manter tabela de deduplicacao por `op_id`:
- se `op_id` ja processado, retornar mesmo resultado sem duplicar efeito.

## 7. Endpoint: GET /api/sync/pull

### 7.1 Query params
- `since`: cursor/ISO do ultimo pull aplicado no cliente.
- `entities` (opcional): lista separada por virgula.
- `limit` (opcional): pagina.
- `cursor` (opcional): pagina seguinte.

Exemplo:
`GET /api/sync/pull?since=2026-02-10T10:00:00.000Z&entities=LANCAMENTOS,CONTAS_FIXAS&limit=500`

### 7.2 Response 200
```json
{
  "server_time": "2026-02-10T16:30:45.120Z",
  "next_cursor": null,
  "high_watermark": "2026-02-10T16:30:45.000Z",
  "changes": [
    {
      "entity": "LANCAMENTOS",
      "id": "8e9b7c2a-5a0d-4e1f-9416-61e5bdf64410",
      "action": "upsert",
      "updated_at": "2026-02-10T16:29:31.000Z",
      "deleted_at": null,
      "revision": "sha256:9f3d...",
      "data": {
        "id": "8e9b7c2a-5a0d-4e1f-9416-61e5bdf64410",
        "data": "2026-02-10",
        "tipo": "despesa",
        "descricao": "Farmacia",
        "categoria": "SAUDE",
        "valor": 89.9,
        "atribuicao": "AMBOS",
        "metodo": "pix",
        "parcela_total": null,
        "parcela_numero": null,
        "observacao": "",
        "created_at": "2026-02-10T16:29:31.000Z",
        "updated_at": "2026-02-10T16:29:31.000Z",
        "quem_pagou": "WALKER"
      }
    },
    {
      "entity": "CONTAS_FIXAS",
      "id": "b17ec0d9-4db4-4cd2-a3bb-4fa3d4e03fd0",
      "action": "delete",
      "updated_at": "2026-02-10T16:30:00.000Z",
      "deleted_at": "2026-02-10T16:30:00.000Z",
      "revision": "sha256:deleted",
      "data": null
    }
  ]
}
```

### 7.3 Erros
- `400 invalid_since`
- `401 unauthorized`
- `429 rate_limited`
- `500 internal_error`

## 8. Endpoint: POST /api/sync/push

### 8.1 Request body
```json
{
  "device_id": "android-9baf1c4c",
  "client_time": "2026-02-10T16:31:12.000Z",
  "operations": [
    {
      "op_id": "d3d718d3-ec2d-4c69-b150-e6579bb5b7dd",
      "entity": "LANCAMENTOS",
      "action": "update",
      "record_id": "8e9b7c2a-5a0d-4e1f-9416-61e5bdf64410",
      "base_revision": "sha256:9f3d...",
      "conflict_policy": "server_wins",
      "occurred_at": "2026-02-10T16:30:50.000Z",
      "payload": {
        "descricao": "Farmacia Drogasil",
        "valor": 90.5
      }
    }
  ]
}
```

### 8.2 Response 200
```json
{
  "server_time": "2026-02-10T16:31:13.120Z",
  "results": [
    {
      "op_id": "d3d718d3-ec2d-4c69-b150-e6579bb5b7dd",
      "status": "applied",
      "entity": "LANCAMENTOS",
      "record_id": "8e9b7c2a-5a0d-4e1f-9416-61e5bdf64410",
      "new_revision": "sha256:2a91...",
      "updated_at": "2026-02-10T16:31:13.000Z",
      "legacy_sync": {
        "status": "ok",
        "message": null
      }
    }
  ],
  "has_conflicts": false
}
```

### 8.3 Resultado por operacao (status)
- `applied`: operacao aplicada.
- `duplicate`: `op_id` ja processado (idempotencia).
- `conflict`: divergencia de `base_revision`.
- `rejected`: payload invalido ou regra de negocio violada.
- `failed`: erro temporario de infraestrutura.

### 8.4 Exemplo de conflito
```json
{
  "op_id": "d3d718d3-ec2d-4c69-b150-e6579bb5b7dd",
  "status": "conflict",
  "entity": "LANCAMENTOS",
  "record_id": "8e9b7c2a-5a0d-4e1f-9416-61e5bdf64410",
  "reason_code": "revision_mismatch",
  "server_record": {
    "revision": "sha256:7ce1...",
    "updated_at": "2026-02-10T16:31:00.000Z",
    "data": {
      "descricao": "Farmacia",
      "valor": 89.9
    }
  }
}
```

### 8.5 Erros de endpoint
- `400 invalid_payload`
- `401 unauthorized`
- `413 payload_too_large`
- `429 rate_limited`
- `500 internal_error`

## 9. Endpoint auxiliar: GET /api/sync/status
Objetivo: UX de status na nav/dashboard.

Response:
```json
{
  "online": true,
  "last_pull_at": "2026-02-10T16:30:45.120Z",
  "last_push_at": "2026-02-10T16:31:13.120Z",
  "pending_ops": 3,
  "failed_ops": 1,
  "conflicts": 0
}
```

## 10. Endpoint auxiliar: POST /api/sync/run
Objetivo: botao "Sincronizar agora" no desktop/mobile.

Comportamento:
- executa `push` pendente + `pull` incremental,
- retorna resumo final.

## 11. Observabilidade minima
Logs por ciclo de sync:
- `sync_cycle_id`
- `device_id`
- latencia pull/push
- numero de ops aplicadas, rejeitadas, conflito
- erros por codigo

Metricas sugeridas:
- `sync_push_success_rate`
- `sync_conflict_rate`
- `sync_lag_seconds` (now - last_pull_at)
- `outbox_depth`

## 12. Seguranca
- Tokens Google permanecem no servidor.
- Cliente nunca recebe refresh token/secret.
- Exigir autenticacao de usuario para endpoints `/api/sync/*`.
- Rate limit em push/pull.
- Sanitizacao de payload + validacao com Zod.

## 13. Compatibilidade com legado
Para `LANCAMENTOS`:
- manter pipeline atual de espelhamento legado (append/remove),
- incluir `legacy_sync.status` no resultado de `push`.
- em caso de erro legado: marcar status sem perder operacao principal no sistema.

## 14. Plano de entrega (resumo)
- Fase 1: deploy remoto + auth + botao sincronizar manual.
- Fase 2: pull + cache local leitura.
- Fase 3: outbox push + idempotencia.
- Fase 4: conflitos + observabilidade + UX de resolucao.

## 15. Decisoes abertas
- Definir armazenador da deduplicacao de `op_id` (SQLite server atual vs DB dedicado).
- Definir prazo de retencao de historico de operacoes.
- Definir politica final de conflito por entidade (alem de server_wins).

## 16. Impacto no codigo (paths alvo)
Para manter a evolucao incremental, os proximos PRs devem concentrar mudancas nestes pontos.

Arquivos novos sugeridos:
- `src/lib/sync/types.ts` (tipos de pull/push, operation result, conflict)
- `src/lib/sync/revision.ts` (geracao de revision hash por registro)
- `src/lib/sync/outboxStore.ts` (persistencia de fila pendente no cliente)
- `src/lib/sync/engine.ts` (orquestracao de push -> pull -> reconcile)
- `src/lib/sync/idempotencyStore.ts` (deduplicacao por `op_id` no servidor)
- `src/lib/storage/localDb.ts` (IndexedDB/SQLite adapter para cache offline)

Arquivos existentes com alteracao:
- `src/lib/sheets/schema.ts` (campos `updated_at`, `deleted_at` onde faltar)
- `src/lib/sheets/sheetsClient.ts` (leitura incremental por data/revision)
- `src/app/api/lancamentos/route.ts` (retornar revision/updated_at de forma consistente)
- `src/app/api/contas-fixas/route.ts` (soft delete compativel com pull incremental)
- `src/app/api/dashboard/route.ts` (status resumido de sync para UI)

Rotas novas sugeridas:
- `src/app/api/sync/pull/route.ts`
- `src/app/api/sync/push/route.ts`
- `src/app/api/sync/status/route.ts`
- `src/app/api/sync/run/route.ts`

UI/UX mobile para status e acionamento:
- `src/components/AppNav.tsx` (acao "Sincronizar agora")
- `src/app/page.tsx` (indicador online/offline + ultimo sync)
- `src/app/globals.css` (estados visuais de sync: ok, pendente, erro, conflito)
