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
- `npm run mobile:lan` -> app em `0.0.0.0` e exibe IP local para Android
- `npm run mobile:lan:https -- --cert ./localhost+2.pem --key ./localhost+2-key.pem` -> app LAN + HTTPS (recomendado para offline/PWA no Android)
- `npm run build` -> build de producao
- `npm run typecheck` -> validacao TypeScript
- `npm test` -> testes de dominio (60/40, RECEBER/PAGAR DEA)
- `npm run alertas` -> checa vencimentos e envia email (e opcionalmente Calendar)
- `npm run importar:cli -- --config ./import-config.example.json` -> importador CLI
- `node scripts/importar.js --config ./import-config.example.json` -> wrapper CLI solicitado
- `npm run sync -- --health` -> testa endpoint de sync mobile
- `npm run sync -- --file ./data/lancamentos-pendentes.json` -> envia lote de teste para `/api/sync/push`

## 4) Estrutura do projeto
- `src/lib/sheets` -> OAuth + wrapper de leitura/escrita no Sheets
- `src/domain` -> regras financeiras (divisao, saldo, projecao)
- `src/app` -> UI + rotas API
- `src/lib/mobileOffline` -> fila offline (IndexedDB) + sync sob demanda
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
- `/sync` status da fila local + botao `Sincronizar agora` (modo mobile offline)
- `/offline` diagnostico de fallback offline (modo mobile offline)

## 7) Mobile Offline + PWA (nova versao)

### Feature flag
Ative no `.env.local`:

```env
MOBILE_OFFLINE_MODE=true
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/SEU_ID/exec
APPS_SCRIPT_APP_TOKEN=troque-por-um-token-forte
```

`APPS_SCRIPT_*` e opcional. Sem essas variaveis, a rota `/api/sync/push` grava direto na aba `LANCAMENTOS` via OAuth (com dedupe por `id`).

Com a flag ativa:
- novos lancamentos em `/lancar` entram na fila local (IndexedDB)
- nada e enviado automaticamente para o Sheets
- o envio ocorre somente em `/sync` ao clicar `Sincronizar agora`
- se `APPS_SCRIPT_WEB_APP_URL` e `APPS_SCRIPT_APP_TOKEN` estiverem vazios, o app usa fallback automatico para sync direto no Google Sheets (OAuth existente)

### IndexedDB usado
- store `lancamentos_local`: `id, payload, synced, created_at, updated_at`
- store `sync_state`: `id=global, last_sync_at, last_sync_status, last_sync_error`

### Rodar no PC e abrir no Android (LAN)
1. No PC, rode:
   - `npm run mobile:lan`
2. Pegue o IP exibido no terminal (ex.: `http://192.168.15.8:3000`).
3. No Android (mesma rede Wi-Fi), abra esse endereco no Chrome.
4. Instale como app:
   - menu do Chrome -> `Adicionar a tela inicial`.

### HTTPS local (necessario para offline em IP da LAN)
No Android/Chrome, `service worker` (base do modo offline de paginas) exige contexto seguro.
Isso significa: `https://...` ou `http://localhost`.
Se voce abrir por `http://<IP_DA_LAN>:3000`, o cadastro pode funcionar online, mas o carregamento offline da pagina nao sera garantido.

Opcao simples com comando unico (`mobile:lan:https`):
1. Gere certificado local confiavel:
   - `mkcert -install`
   - `mkcert 127.0.0.1 localhost <SEU_IP_LAN>`
2. Rode um unico comando:
   - `npm run mobile:lan:https -- --cert ./localhost+2.pem --key ./localhost+2-key.pem`
3. No Android, acesse `https://<SEU_IP_LAN>:3443`.
4. Instale como app (Adicionar à tela inicial).

Tambem funciona por variavel de ambiente:
- `MOBILE_HTTPS_CERT_PATH=./localhost+2.pem`
- `MOBILE_HTTPS_KEY_PATH=./localhost+2-key.pem`

## 8) Google Apps Script Web App (API do legado)

### 8.1 Criar script
1. Abra `script.new` (Google Apps Script).
2. Cole o codigo abaixo em `Code.gs`.
3. Ajuste o token em `APP_TOKEN`.
4. Publique como Web App:
   - Deploy -> New deployment -> Web app
   - Execute as: `Me`
   - Who has access: `Anyone` (ou restricao equivalente no seu contexto)
5. Copie a URL final `/exec` e configure em `APPS_SCRIPT_WEB_APP_URL`.

### 8.2 Codigo `.gs` (copiar/colar)
```javascript
const SHEET_NAME = "LANCAMENTOS";
const APP_TOKEN = "troque-por-um-token-forte";

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function resolveRoute(e) {
  const pathInfo = (e && e.pathInfo ? e.pathInfo : "").replace(/^\/+/, "");
  if (pathInfo) return pathInfo;
  return (e && e.parameter && e.parameter.route ? e.parameter.route : "").trim();
}

function getOrCreateLancamentosSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "id", "data", "tipo", "descricao", "categoria", "valor", "atribuicao", "metodo",
      "parcela_total", "parcela_numero", "observacao", "quem_pagou", "created_at", "updated_at"
    ]);
  }

  return sheet;
}

function readExistingIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const map = {};
  values.forEach((row) => {
    const id = String(row[0] || "").trim();
    if (id) map[id] = true;
  });
  return map;
}

function checkToken_(data, e) {
  const tokenFromBody = data && data.appToken ? String(data.appToken) : "";
  const tokenFromQuery = e && e.parameter && e.parameter.token ? String(e.parameter.token) : "";
  const token = tokenFromBody || tokenFromQuery;
  return token === APP_TOKEN;
}

function doGet(e) {
  const route = resolveRoute(e);

  if (route === "health" || !route) {
    return jsonOut({ ok: true, service: "apps-script-sync", route: route || "root" });
  }

  return jsonOut({ ok: false, message: "Rota GET nao encontrada", route });
}

function doPost(e) {
  const route = resolveRoute(e);
  if (route !== "addLancamentosBatch") {
    return jsonOut({ ok: false, message: "Rota POST nao encontrada", route });
  }

  let data = {};
  try {
    data = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (error) {
    return jsonOut({ ok: false, message: "JSON invalido" });
  }

  if (!checkToken_(data, e)) {
    return jsonOut({ ok: false, message: "Token invalido" });
  }

  const lancamentos = Array.isArray(data.lancamentos) ? data.lancamentos : [];
  if (lancamentos.length === 0) {
    return jsonOut({ ok: true, inserted: 0, duplicates: 0, synced_ids: [] });
  }

  const sheet = getOrCreateLancamentosSheet_();
  const existingIds = readExistingIds_(sheet);

  const toInsert = [];
  const syncedIds = [];
  let duplicates = 0;

  lancamentos.forEach((item) => {
    const id = String(item.id || "").trim();
    if (!id) return;

    if (existingIds[id]) {
      duplicates += 1;
      syncedIds.push(id);
      return;
    }

    existingIds[id] = true;
    syncedIds.push(id);

    toInsert.push([
      id,
      item.data || "",
      item.tipo || "",
      item.descricao || "",
      item.categoria || "",
      Number(item.valor || 0),
      item.atribuicao || "",
      item.metodo || "",
      item.parcela_total == null ? "" : Number(item.parcela_total),
      item.parcela_numero == null ? "" : Number(item.parcela_numero),
      item.observacao || "",
      item.quem_pagou || "",
      item.created_at || new Date().toISOString(),
      item.updated_at || new Date().toISOString()
    ]);
  });

  if (toInsert.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, toInsert.length, toInsert[0].length)
      .setValues(toInsert);
  }

  return jsonOut({
    ok: true,
    inserted: toInsert.length,
    duplicates,
    synced_ids: syncedIds
  });
}
```

## 9) Compatibilidade com planilha antiga
Regras preservadas:
- Divisao 60/40 e AMBOS_I invertido
- `RECEBER/PAGAR DEA` com base em `atribuicao + quem_pagou`
- Balanço: `(saldo banco + carteira) - (receitas - pagamentos WALKER)`
- Regra Petrobras:
  - receitas D-25 + D-10
  - AMS grande risco e assistencia suplementar entram como receita e despesa compartilhada
  - permite despesas extras (ex.: odontologico)

## 10) Importacao historica
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
- A opcao "Pular meses ja importados" evita reimportar meses que ja tenham lancamentos no sistema.

### CLI
- Edite `import-config.example.json`
- Rode:
  - `node scripts/importar.js --config ./import-config.example.json`

## 11) Alertas
`npm run alertas`:
- Contas fixas: dispara quando `dias ate vencimento` bate com `avisar_dias_antes`
- Sazonais: usa `mes + dia_mes` (ou dia 1 por padrao)
- Email: Gmail API
- Calendar: opcional com `CREATE_CALENDAR_EVENTS=true`

## 12) Seguranca
- Nunca commitar `.env.local`, refresh token ou credenciais.
- `.gitignore` ja bloqueia arquivos sensiveis comuns.

## 13) Uso de IA (Codex) e Prompts do Projeto
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

### Regra obrigatoria
Ao usar Codex/IA neste projeto, considerar como autoridade:
- `prompts/system.md`
- `prompts/router.md`
- `docs/legal_guardrails.md`
- `SPEC.md`

### Prompt padrão recomendado
Ao iniciar uma tarefa com Codex, usar o padrão definido em:
`docs/codex_workflow.md`
