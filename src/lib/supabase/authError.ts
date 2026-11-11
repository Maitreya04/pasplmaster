function readStringField(error: Record<string, unknown>, key: string): string | null {
  const value = error[key];
  return typeof value === 'string' ? value : null;
}

function readNumberField(error: Record<string, unknown>, key: string): number | null {
  const value = error[key];
  return typeof value === 'number' ? value : null;
}

function errorText(error: Record<string, unknown>): string {
  return ['code', 'name', 'message', 'details', 'hint']
    .map((key) => readStringField(error, key))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function isSupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const status = readNumberField(record, 'status') ?? readNumberField(record, 'statusCode');
  if (status === 401 || status === 403) return true;

  const text = errorText(record);
  return (
    text.includes('pgrst301') ||
    text.includes('jwt expired') ||
    text.includes('invalid jwt') ||
    text.includes('invalid token') ||
    text.includes('auth session missing') ||
    text.includes('not authenticated') ||
    text.includes('unauthorized') ||
    text.includes('permission denied') ||
    text.includes('row-level security') ||
    text.includes('42501')
  );
}

export function shouldRecoverSessionFromError(error: unknown): boolean {
  return isSupabaseAuthError(error);
}

export function isTransientSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const status = readNumberField(record, 'status') ?? readNumberField(record, 'statusCode');
  if (status != null && status >= 500) return true;
  const text = errorText(record);
  return (
    text.includes('authretryablefetcherror') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed') ||
    text.includes('timeout') ||
    text.includes('temporarily unavailable') ||
    text.includes('connection') ||
    text.includes('econnreset') ||
    text.includes('enotfound')
  );
}

const DEFAULT_RECOVERY = 'Your previous login expired. Enter your PIN to continue.';
let recoveryHandler: ((message: string) => void) | null = null;
let recoveryBusyUntil = 0;
/** When false (auth still booting), 401s from pre-session races must not sign the user out. */
let recoveryArmed = false;

export function registerSessionRecoveryHandler(handler: ((message: string) => void) | null): void {
  recoveryHandler = handler;
}

/** Arm only after AuthProvider has finished the initial session restore attempt. */
export function setSessionRecoveryArmed(armed: boolean): void {
  recoveryArmed = armed;
}

export function requestSessionRecovery(message: string = DEFAULT_RECOVERY): void {
  if (!recoveryHandler || !recoveryArmed || Date.now() < recoveryBusyUntil) return;
  recoveryBusyUntil = Date.now() + 2000;

  const handler = recoveryHandler;
  void (async () => {
    // Lazy-import so auth error classification stays usable without a live client.
    const { getRestoredSession, isSessionLocallyValid } = await import('./sessionGate');
    // A valid stored session means this 401 likely raced session restore (or was
    // an anon request). Do not sign the user out — gated warmers will retry.
    const session = await getRestoredSession();
    if (isSessionLocallyValid(session)) return;
    handler(message);
  })();
}
