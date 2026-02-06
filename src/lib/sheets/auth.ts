import { google } from "googleapis";
import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";

export function getOAuthClient() {
  const config = getConfig();

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: config.googleRefreshToken
  });

  return oauth2Client;
}

export function getSheetsApi() {
  return google.sheets({
    version: "v4",
    auth: getOAuthClient()
  });
}

export function getGmailApi() {
  return google.gmail({
    version: "v1",
    auth: getOAuthClient()
  });
}

export function getCalendarApi() {
  return google.calendar({
    version: "v3",
    auth: getOAuthClient()
  });
}

export function ensureGoogleScopesConfigured() {
  const config = getConfig();
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new AppError("Credenciais Google OAuth nao configuradas", 500, "GOOGLE_OAUTH_MISSING");
  }
}
