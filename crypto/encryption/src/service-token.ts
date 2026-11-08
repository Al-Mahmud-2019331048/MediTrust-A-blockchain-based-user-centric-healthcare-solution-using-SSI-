import crypto from 'crypto';

// Shared-secret check between the DWN and the SSS service (2026-11-08).
// Both read SSS_SERVICE_TOKEN from the same .env; it is sent in the
// x-service-token header. Returns 'unset' when the secret isn't configured so
// callers can fail closed with a clear 503 instead of silently allowing.
export const SERVICE_TOKEN_HEADER = 'x-service-token';

export function checkServiceToken(provided: string | undefined): 'ok' | 'invalid' | 'unset' {
  const configured = process.env.SSS_SERVICE_TOKEN;
  if (!configured) return 'unset';
  const a = Buffer.from(provided ?? '', 'utf8');
  const b = Buffer.from(configured, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'invalid';
}

export function serviceTokenHeader(): Record<string, string> {
  const token = process.env.SSS_SERVICE_TOKEN;
  return token ? { [SERVICE_TOKEN_HEADER]: token } : {};
}
