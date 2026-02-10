# Runbook de Deploy - Railway

Este runbook executa a Fase 1 no Railway para acesso fora da rede local.

## 1) Pre-condicoes
- Repositorio atualizado com:
  - `Dockerfile`
  - `railway.json`
  - `src/app/api/health/route.ts`
- Conta Railway ativa.
- Projeto Google Cloud com APIs habilitadas.

## 2) Criar o servico no Railway (UI)
1. Acesse Railway e clique em `New Project`.
2. Selecione `Deploy from GitHub Repo`.
3. Escolha este repositorio.
4. Confirme que o Railway detectou `Dockerfile`.

## 3) Configurar volume persistente
1. No service, adicione `Volume`.
2. Mount path recomendado: `/data`.
3. Salve.

## 4) Configurar variaveis de ambiente
Obrigatorias:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` = `https://SEU_DOMINIO/api/google/callback`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_SPREADSHEET_ID`

Recomendadas para este deploy:
- `LANCAMENTOS_CACHE_DB_PATH` = `/data/lancamentos.sqlite`
- `CARTOES_DB_PATH` = `/data/cartoes.sqlite`

Opcionais:
- `ALERT_RECIPIENTS`
- `GMAIL_FROM`
- `GOOGLE_CALENDAR_ID`
- `CREATE_CALENDAR_EVENTS` = `false` (ou `true`)

Seguranca opcional (fortemente recomendado em URL publica):
- `APP_BASIC_AUTH_USER`
- `APP_BASIC_AUTH_PASS`

## 5) Ajuste no Google OAuth
No OAuth Client do Google Cloud:
- Authorized redirect URI:
  - `https://SEU_DOMINIO/api/google/callback`

Se o deploy gerar novo dominio, atualizar aqui imediatamente.

## 6) Deploy
1. Disparar deploy pela branch principal.
2. Aguardar status `Success`.
3. Validar healthcheck:
  - `GET https://SEU_DOMINIO/api/health`

## 7) Smoke test rapido
Use o script do repositorio:

```bash
chmod +x scripts/smoke_deploy.sh
./scripts/smoke_deploy.sh https://SEU_DOMINIO 2026-02
```

Ou manual:

```bash
curl -sS https://SEU_DOMINIO/api/health
curl -sS "https://SEU_DOMINIO/api/sync/status?checkConnection=true"
curl -sS -X POST https://SEU_DOMINIO/api/sync/run
curl -sS "https://SEU_DOMINIO/api/dashboard?mes=2026-02"
```

## 8) Validacao no Android (fora da rede local)
- Abrir `https://SEU_DOMINIO`.
- Entrar no menu `Mais`.
- Confirmar status de sincronizacao.
- Executar `Sincronizar agora`.

## 9) Troubleshooting
- Erro OAuth redirect mismatch:
  - conferir `GOOGLE_REDIRECT_URI` e URI no Google Cloud.
- Falha de sync com Sheets:
  - validar `GOOGLE_REFRESH_TOKEN` e `GOOGLE_SPREADSHEET_ID`.
- SQLite nao persiste:
  - conferir volume montado em `/data` e variaveis `*_DB_PATH`.
