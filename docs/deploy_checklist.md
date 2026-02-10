# Checklist de Deploy (Fase 1)

Objetivo desta fase: deixar o app acessivel no Android fora da rede local, com sincronizacao manual (`Sincronizar agora`) funcionando em producao.

## 0) Itens ja executados no repositorio

- [x] `Dockerfile` para deploy em container.
- [x] `railway.json` com healthcheck.
- [x] endpoint `GET /api/health`.
- [x] middleware de Basic Auth opcional por env (`APP_BASIC_AUTH_USER`, `APP_BASIC_AUTH_PASS`).
- [x] script de smoke test (`scripts/smoke_deploy.sh`).
- [x] runbook Railway (`docs/deploy_railway_runbook.md`).

## 1) Plataforma de deploy (recomendado)

Recomendacao para este projeto atual: **Railway** (ou VPS/Render com disco persistente), porque o app usa SQLite local em:
- `data/lancamentos.sqlite`
- `data/cartoes.sqlite`

Em ambientes serverless puros, esse armazenamento local pode nao ser persistente.

Checklist:
- [ ] Criar projeto no provedor.
- [ ] Conectar o repositorio Git.
- [ ] Configurar deploy automatico pela branch principal.
- [ ] Confirmar runtime Node 20+.

## 2) Preparacao Google Cloud (obrigatorio)

Checklist:
- [ ] No Google Cloud Console, confirmar APIs ativas:
  - [ ] Google Sheets API
  - [ ] Gmail API (se usar alertas)
  - [ ] Google Calendar API (se usar eventos)
- [ ] Em OAuth Client, adicionar URI de redirecionamento de producao:
  - [ ] `https://SEU_DOMINIO/api/google/callback`
- [ ] Manter tambem o redirect local para desenvolvimento (opcional):
  - [ ] `http://localhost:3000/api/google/callback`
- [ ] Gerar/validar refresh token de producao para o mesmo client OAuth.

## 3) Variaveis de ambiente em producao

Configurar no painel do provedor:

Obrigatorias:
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_REDIRECT_URI` = `https://SEU_DOMINIO/api/google/callback`
- [ ] `GOOGLE_REFRESH_TOKEN`
- [ ] `GOOGLE_SPREADSHEET_ID`

Opcionais:
- [ ] `ALERT_RECIPIENTS`
- [ ] `GMAIL_FROM`
- [ ] `GOOGLE_CALENDAR_ID`
- [ ] `CREATE_CALENDAR_EVENTS` (`true` ou `false`)

Importante para persistencia SQLite:
- [ ] `LANCAMENTOS_CACHE_DB_PATH` apontando para volume persistente (ex.: `/data/lancamentos.sqlite`)
- [ ] `CARTOES_DB_PATH` apontando para volume persistente (ex.: `/data/cartoes.sqlite`)

## 4) Configuracao de storage persistente

Checklist:
- [ ] Criar volume persistente no provedor (ex.: mount path `/data`).
- [ ] Garantir permissao de escrita no path montado.
- [ ] Validar que o container/servico enxerga `/data`.

## 5) Build e start do servico

Checklist:
- [ ] Build command via Dockerfile.
- [ ] Start command via Dockerfile (`node server.js` no container standalone).
- [ ] Porta HTTP configurada pelo provedor (padrao Next.js em producao).
- [ ] HTTPS ativo no dominio final.

## 6) Validacao funcional pos-deploy

Com app no ar, executar:

Checklist de API:
- [ ] `POST /api/bootstrap` retorna sucesso.
- [ ] `GET /api/dashboard?mes=YYYY-MM` retorna dados.
- [ ] `GET /api/sync/status?checkConnection=true` retorna status.
- [ ] `POST /api/sync/run` conclui sem erro.

Checklist de UI:
- [ ] Dashboard abre no Android via 4G/5G (fora da rede do notebook).
- [ ] Menu `Mais` mostra status de sincronizacao.
- [ ] Botao `Sincronizar agora` executa e mostra feedback visual.
- [ ] Botao `Reparar conexao` continua funcional.

## 7) Seguranca minima para producao

Estado atual: existe Basic Auth opcional via middleware.

Antes de divulgar URL publicamente:
- [ ] Definir `APP_BASIC_AUTH_USER` e `APP_BASIC_AUTH_PASS` no provedor, OU
- [ ] Aplicar restricao equivalente no edge do provedor.

Tambem obrigatorio:
- [ ] Nunca expor `.env.local` no repositorio.
- [ ] Rotacionar refresh token se houver suspeita de vazamento.

## 8) Smoke test rapido (copiar e executar)

Substitua `SEU_DOMINIO` e `MES`:

```bash
curl -sS https://SEU_DOMINIO/api/dashboard?mes=MES | head
curl -sS "https://SEU_DOMINIO/api/sync/status?checkConnection=true" | head
curl -sS -X POST https://SEU_DOMINIO/api/sync/run | head
```

## 9) Rollback

Checklist:
- [ ] Manter ultima release estavel no provedor.
- [ ] Se deploy falhar, rollback imediato para release anterior.
- [ ] Validar endpoints de dashboard/sync apos rollback.

## 10) Definicao de pronto (Fase 1)

Considerar Fase 1 concluida quando:
- [ ] App abre no Android fora da rede local.
- [ ] Integracao com Google Sheets funciona em producao.
- [ ] `Sincronizar agora` funciona em producao.
- [ ] Dados SQLite de cache/cartoes persistem entre reinicios do servico.
