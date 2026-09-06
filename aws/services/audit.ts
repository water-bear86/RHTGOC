export interface AuditFields {
  event: string;
  requestId?: string;
  wallet?: string;
  resourceId?: string;
  outcome: "accepted" | "rejected" | "failed" | "succeeded" | "skipped";
  code?: string;
  [key: string]: unknown;
}

const redactedKeys = new Set(["signature", "authorization", "token", "secret", "privateKey", "state"]);

export function audit(fields: AuditFields): void {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !redactedKeys.has(key)));
  console.info(JSON.stringify({ level: "AUDIT", at: new Date().toISOString(), ...safe }));
}

export function operationalError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const code = error instanceof Error ? error.name : "UnknownError";
  console.error(JSON.stringify({ level: "ERROR", at: new Date().toISOString(), event, code, ...fields }));
}
