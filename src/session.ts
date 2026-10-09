import type { Env } from './env';

const COOKIE = 'am_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

export async function checkPassword(env: Env, password: string): Promise<boolean> {
  if (!env.DASHBOARD_PASSWORD) return false;
  const [given, expected] = await Promise.all([sha256(password), sha256(env.DASHBOARD_PASSWORD)]);
  return crypto.subtle.timingSafeEqual(given, expected);
}

/** Session = `<expires>.<hmac>`; the key derives from the dashboard password, so changing it logs everyone out. */
export async function sessionCookie(env: Env): Promise<string> {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(env), encoder.encode(expires));
  return `${COOKIE}=${expires}.${base64url(signature)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasSession(request: Request, env: Env): Promise<boolean> {
  if (!env.DASHBOARD_PASSWORD) return false;

  const value = cookie(request, COOKIE);
  const [expires, signature] = value?.split('.') ?? [];
  if (!expires || !signature || Number(expires) * 1000 < Date.now()) return false;

  try {
    return await crypto.subtle.verify('HMAC', await sessionKey(env), fromBase64url(signature), encoder.encode(expires));
  } catch {
    return false;
  }
}

function sessionKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(`session:${env.DASHBOARD_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get('cookie')?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

function base64url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
