function readStringField(error: Record<string, unknown>, key: string): string | null {
  const value = error[key];
  return typeof value === 'string' ? value : null;
}

function readNumberField(error: Record<string, unknown>, key: string): number | null {
  const value = error[key];
  return typeof value === 'number' ? value : null;
}

export function isSupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const record = error as Record<string, unknown>;
  const status = readNumberField(record, 'status') ?? readNumberField(record, 'statusCode');
  if (status === 401) return true;

  const text = [
    readStringField(record, 'code'),
    readStringField(record, 'name'),
    readStringField(record, 'message'),
    readStringField(record, 'details'),
    readStringField(record, 'hint'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    text.includes('pgrst301') ||
    text.includes('jwt expired') ||
    text.includes('invalid jwt') ||
    text.includes('invalid token') ||
    text.includes('auth session missing') ||
    text.includes('not authenticated') ||
    text.includes('unauthorized')
  );
}

export function isTransientSupabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const record = error as Record<string, unknown>;
  const status = readNumberField(record, 'status') ?? readNumberField(record, 'statusCode');
  if (status != null && status >= 500) return true;

  const text = [
    readStringField(record, 'code'),
    readStringField(record, 'name'),
    readStringField(record, 'message'),
    readStringField(record, 'details'),
    readStringField(record, 'hint'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

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
