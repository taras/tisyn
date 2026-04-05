const VERBOSE = process.env.DEBUG_CHAT === "1";

export function logInfo(scope: string, message: string, data?: Record<string, unknown>): void {
  const tag = `[${scope}]`;
  if (data) {
    console.log(`${tag} ${message}`, formatData(data));
  } else {
    console.log(`${tag} ${message}`);
  }
}

export function logError(scope: string, message: string, error?: unknown): void {
  console.error(`[${scope}] ${message}`, error instanceof Error ? error.message : (error ?? ""));
}

export function logDebug(scope: string, message: string, data?: Record<string, unknown>): void {
  if (VERBOSE) {
    logInfo(scope, message, data);
  }
}

function formatData(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}
