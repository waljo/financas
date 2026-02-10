const OUTBOX_STORAGE_KEY = "financas.lancamentos.outbox.v1";
const OUTBOX_EVENT_NAME = "financas:lancamentos-outbox-changed";

export type LancamentosOutboxMethod = "POST" | "PUT" | "DELETE";

export interface LancamentosOutboxOperation {
  opId: string;
  method: LancamentosOutboxMethod;
  url: string;
  body: unknown | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface LancamentosOutboxFlushResult {
  applied: number;
  dropped: number;
  remaining: number;
  stoppedByOffline: boolean;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function generateOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emitOutboxChanged(count: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT_NAME, { detail: { count } }));
}

function readOutboxRaw(): LancamentosOutboxOperation[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LancamentosOutboxOperation[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object");
  } catch {
    return [];
  }
}

function writeOutboxRaw(items: LancamentosOutboxOperation[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  emitOutboxChanged(items.length);
}

export function getLancamentosOutboxCount(): number {
  return readOutboxRaw().length;
}

export function subscribeLancamentosOutboxChange(listener: (count: number) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ count?: number }>;
    listener(custom.detail?.count ?? getLancamentosOutboxCount());
  };
  window.addEventListener(OUTBOX_EVENT_NAME, handler as EventListener);
  return () => {
    window.removeEventListener(OUTBOX_EVENT_NAME, handler as EventListener);
  };
}

export function enqueueLancamentosOutboxOperation(input: {
  method: LancamentosOutboxMethod;
  url: string;
  body?: unknown;
}): LancamentosOutboxOperation {
  const next: LancamentosOutboxOperation = {
    opId: generateOpId(),
    method: input.method,
    url: input.url,
    body: input.body ?? null,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null
  };

  const current = readOutboxRaw();
  current.push(next);
  writeOutboxRaw(current);
  return next;
}

function shouldRetryHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function withAttemptError(item: LancamentosOutboxOperation, error: string): LancamentosOutboxOperation {
  return {
    ...item,
    attempts: item.attempts + 1,
    lastError: error.slice(0, 500)
  };
}

export async function flushLancamentosOutbox(): Promise<LancamentosOutboxFlushResult> {
  const queue = readOutboxRaw();
  if (queue.length === 0) {
    return {
      applied: 0,
      dropped: 0,
      remaining: 0,
      stoppedByOffline: false
    };
  }

  const remaining: LancamentosOutboxOperation[] = [];
  let applied = 0;
  let dropped = 0;
  let stoppedByOffline = false;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: item.body === null ? undefined : { "Content-Type": "application/json" },
        body: item.body === null ? undefined : JSON.stringify(item.body)
      });

      if (response.ok) {
        applied += 1;
        continue;
      }

      if (shouldRetryHttpStatus(response.status)) {
        remaining.push(withAttemptError(item, `HTTP_${response.status}`));
      } else {
        dropped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "NETWORK_ERROR";
      remaining.push(withAttemptError(item, message));
      remaining.push(...queue.slice(index + 1));
      stoppedByOffline = true;
      break;
    }
  }

  writeOutboxRaw(remaining);

  return {
    applied,
    dropped,
    remaining: remaining.length,
    stoppedByOffline
  };
}
