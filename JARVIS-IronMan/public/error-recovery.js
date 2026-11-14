// Error classification and bounded retry with backoff. No timers are used unless delay > 0.
export function classifyError(error) {
  const status = Number(error?.status);
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? '');
  if (name === 'AbortError' || /aborted|cancel/i.test(message)) return { kind: 'cancelled', retryable: false };
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate-limit', retryable: true };
  if (status >= 500 || status === 408) return { kind: 'server', retryable: true };
  if (status >= 400) return { kind: 'client', retryable: false };
  if (name === 'TypeError' && /fetch|network/i.test(message)) return { kind: 'network', retryable: true };
  if (/timeout|timed out/i.test(message)) return { kind: 'timeout', retryable: true };
  return { kind: 'unknown', retryable: false };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRecovery(operation, {
  maxAttempts = 3,
  baseDelayMs = 400,
  maxDelayMs = 4_000,
  wait = sleep,
  onRetry = () => {},
  fallback,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, value: await operation(attempt), attempts: attempt };
    } catch (error) {
      lastError = error;
      const info = classifyError(error);
      if (!info.retryable || attempt === maxAttempts) {
        if (typeof fallback === 'function' && info.kind !== 'cancelled' && info.kind !== 'auth') {
          try {
            return { ok: true, value: await fallback(error), attempts: attempt, usedFallback: true };
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
        return { ok: false, error: lastError, kind: classifyError(lastError).kind, attempts: attempt };
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      onRetry({ attempt, delay, kind: info.kind });
      if (delay > 0) await wait(delay);
    }
  }
  return { ok: false, error: lastError, kind: classifyError(lastError).kind, attempts: maxAttempts };
}
