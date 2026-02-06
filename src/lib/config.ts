import { AppError } from "@/lib/errors";

export interface AppConfig {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  googleRefreshToken: string;
  googleSpreadsheetId: string;
  gmailFrom?: string;
  alertRecipients: string[];
  googleCalendarId?: string;
  createCalendarEvents: boolean;
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      `Variavel obrigatoria ausente: ${name}. Configure em .env.local`,
      500,
      "MISSING_ENV"
    );
  }
  return value;
}

export function getConfig(): AppConfig {
  const recipientsRaw = process.env.ALERT_RECIPIENTS ?? "";
  const recipients = recipientsRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    googleClientId: readRequired("GOOGLE_CLIENT_ID"),
    googleClientSecret: readRequired("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri: readRequired("GOOGLE_REDIRECT_URI"),
    googleRefreshToken: readRequired("GOOGLE_REFRESH_TOKEN"),
    googleSpreadsheetId: readRequired("GOOGLE_SPREADSHEET_ID"),
    gmailFrom: process.env.GMAIL_FROM?.trim(),
    alertRecipients: recipients,
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID?.trim(),
    createCalendarEvents: (process.env.CREATE_CALENDAR_EVENTS ?? "false").toLowerCase() === "true"
  };
}

export function getConfigSafe(): Partial<AppConfig> {
  return {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    gmailFrom: process.env.GMAIL_FROM,
    alertRecipients: (process.env.ALERT_RECIPIENTS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID,
    createCalendarEvents: (process.env.CREATE_CALENDAR_EVENTS ?? "false").toLowerCase() === "true"
  };
}
