function printSection(title: string, lines: string[]) {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) {
    console.log(line);
  }
}

console.log("Setup Google OAuth para Financas (local)");
console.log("Data: 2026-02-06");

printSection("1) Criar projeto no Google Cloud", [
  "Acesse https://console.cloud.google.com/",
  "Crie/seleciona um projeto.",
  "Ative APIs: Google Sheets API, Gmail API e Google Calendar API."
]);

printSection("2) Configurar OAuth consent", [
  "No menu APIs & Services > OAuth consent screen:",
  "Escolha External (ou Internal no Workspace), preencha nome e email.",
  "Adicione escopos:",
  "- https://www.googleapis.com/auth/spreadsheets",
  "- https://www.googleapis.com/auth/gmail.send",
  "- https://www.googleapis.com/auth/calendar",
  "Adicione seu email em Test users."
]);

printSection("3) Criar credencial OAuth Client", [
  "APIs & Services > Credentials > Create Credentials > OAuth client ID",
  "Tipo: Web application",
  "Authorized redirect URIs: http://localhost:3000/api/google/callback",
  "Copie Client ID e Client Secret."
]);

printSection("4) Gerar refresh token", [
  "Use OAuth Playground ou script proprio para trocar authorization code por refresh token.",
  "Escopos devem incluir Sheets/Gmail/Calendar.",
  "Salve CLIENT_ID, CLIENT_SECRET e REFRESH_TOKEN em .env.local."
]);

printSection("5) Variaveis obrigatorias (.env.local)", [
  "GOOGLE_CLIENT_ID=...",
  "GOOGLE_CLIENT_SECRET=...",
  "GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback",
  "GOOGLE_REFRESH_TOKEN=...",
  "GOOGLE_SPREADSHEET_ID=...",
  "ALERT_RECIPIENTS=email1@...[,email2@...]",
  "GMAIL_FROM=seu_email@...",
  "GOOGLE_CALENDAR_ID=primary (opcional)",
  "CREATE_CALENDAR_EVENTS=false"
]);

printSection("6) Fluxo local", [
  "npm install",
  "npm run bootstrap:sheets",
  "npm run dev",
  "npm run alertas"
]);

console.log("\nDica: nunca commitar .env.local nem tokens.");
