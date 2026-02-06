import { config as loadEnv } from "dotenv";
import { addMonths, differenceInCalendarDays, format, isAfter, setDate, startOfDay } from "date-fns";
import { getConfig } from "../src/lib/config";
import { getCalendarApi, getGmailApi } from "../src/lib/sheets/auth";
import { readCalendarioAnual, readContasFixas } from "../src/lib/sheets/sheetsClient";
import type { CalendarioAnual, ContaFixa } from "../src/lib/types";
import { parseCsvNumbers } from "../src/lib/utils";

loadEnv({ path: ".env.local" });
loadEnv();

interface AlertItem {
  type: "conta_fixa" | "sazonal";
  title: string;
  dueDate: Date;
  daysUntil: number;
  amount: number;
  category: string;
}

function dueDateForConta(conta: ContaFixa, baseDate: Date): Date {
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const maxDay = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
  const day = Math.min(conta.dia_vencimento, maxDay);
  return setDate(monthStart, day);
}

function nextDueDateConta(conta: ContaFixa, today: Date): Date {
  const currentMonthDue = dueDateForConta(conta, today);
  if (isAfter(currentMonthDue, today) || differenceInCalendarDays(currentMonthDue, today) === 0) {
    return currentMonthDue;
  }
  const nextMonth = addMonths(today, 1);
  return dueDateForConta(conta, nextMonth);
}

function nextDateSazonal(item: CalendarioAnual, today: Date): Date {
  const day = item.dia_mes && item.dia_mes > 0 ? item.dia_mes : 1;
  const currentYear = today.getFullYear();
  let candidate = new Date(currentYear, item.mes - 1, day);

  if (differenceInCalendarDays(candidate, today) < 0) {
    candidate = new Date(currentYear + 1, item.mes - 1, day);
  }

  return candidate;
}

function buildAlerts(contas: ContaFixa[], sazonais: CalendarioAnual[], today: Date): AlertItem[] {
  const alerts: AlertItem[] = [];

  for (const conta of contas) {
    if (!conta.ativo) continue;
    const dueDate = nextDueDateConta(conta, today);
    const daysUntil = differenceInCalendarDays(dueDate, today);
    const triggerDays = parseCsvNumbers(conta.avisar_dias_antes);

    if (triggerDays.includes(daysUntil)) {
      alerts.push({
        type: "conta_fixa",
        title: conta.nome,
        dueDate,
        daysUntil,
        amount: conta.valor_previsto ?? 0,
        category: conta.categoria
      });
    }
  }

  for (const evento of sazonais) {
    const dueDate = nextDateSazonal(evento, today);
    const daysUntil = differenceInCalendarDays(dueDate, today);
    const triggerDays = parseCsvNumbers(evento.avisar_dias_antes);

    if (triggerDays.includes(daysUntil)) {
      alerts.push({
        type: "sazonal",
        title: evento.evento,
        dueDate,
        daysUntil,
        amount: evento.valor_estimado,
        category: evento.categoria
      });
    }
  }

  return alerts.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

function createEmailBody(alerts: AlertItem[], today: Date): string {
  const lines: string[] = [];
  lines.push(`Alertas financeiros - ${format(today, "yyyy-MM-dd")}`);
  lines.push("");

  for (const alert of alerts) {
    lines.push(
      `- [${alert.type}] ${alert.title} | vencimento ${format(alert.dueDate, "yyyy-MM-dd")} | em ${alert.daysUntil} dia(s) | R$ ${alert.amount.toFixed(2)} | categoria ${alert.category}`
    );
  }

  if (alerts.length === 0) {
    lines.push("Nenhum alerta para hoje.");
  }

  return lines.join("\n");
}

function toBase64Url(text: string): string {
  return Buffer.from(text)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendEmail(alerts: AlertItem[], today: Date): Promise<void> {
  const config = getConfig();
  if (!config.alertRecipients.length) {
    console.log("ALERT_RECIPIENTS nao definido. Email nao enviado.");
    return;
  }

  if (!config.gmailFrom) {
    console.log("GMAIL_FROM nao definido. Email nao enviado.");
    return;
  }

  const gmail = getGmailApi();
  const body = createEmailBody(alerts, today);

  const rawMessage = [
    `From: ${config.gmailFrom}`,
    `To: ${config.alertRecipients.join(", ")}`,
    `Subject: Alertas de vencimento - ${format(today, "yyyy-MM-dd")}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: toBase64Url(rawMessage)
    }
  });

  console.log(`Email enviado para ${config.alertRecipients.join(", ")}`);
}

async function createCalendarEvents(alerts: AlertItem[]): Promise<void> {
  const config = getConfig();
  if (!config.createCalendarEvents || !config.googleCalendarId) {
    console.log("Criacao de evento no Calendar desabilitada.");
    return;
  }

  const calendar = getCalendarApi();

  for (const alert of alerts) {
    const start = new Date(alert.dueDate);
    start.setHours(9, 0, 0, 0);
    const end = new Date(alert.dueDate);
    end.setHours(10, 0, 0, 0);

    await calendar.events.insert({
      calendarId: config.googleCalendarId,
      requestBody: {
        summary: `[Alerta] ${alert.title}`,
        description: `Tipo: ${alert.type}\nCategoria: ${alert.category}\nValor estimado: R$ ${alert.amount.toFixed(2)}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        reminders: {
          useDefault: false,
          overrides: [{ method: "popup", minutes: 120 }]
        }
      }
    });
  }

  console.log(`${alerts.length} evento(s) criados no Google Calendar.`);
}

async function main() {
  const today = startOfDay(new Date());
  const [contas, sazonais] = await Promise.all([readContasFixas(), readCalendarioAnual()]);

  const alerts = buildAlerts(contas, sazonais, today);

  console.log(`Alertas encontrados: ${alerts.length}`);
  for (const alert of alerts) {
    console.log(
      `- ${alert.type}: ${alert.title} | ${format(alert.dueDate, "yyyy-MM-dd")} | em ${alert.daysUntil} dia(s)`
    );
  }

  await sendEmail(alerts, today);
  await createCalendarEvents(alerts);
}

main().catch((error) => {
  console.error("Falha no script de alertas:", error instanceof Error ? error.message : error);
  process.exit(1);
});
