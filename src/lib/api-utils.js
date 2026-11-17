const ALLOWED_ORIGINS = new Set([
  'https://nabil-izza.develzy.my.id',
  'https://izza-nabil.develzy.my.id'
]);

function getAllowedOrigin(request) {
  if (!request) return 'https://nabil-izza.develzy.my.id';
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return origin;
  }
  return 'https://nabil-izza.develzy.my.id';
}

export function jsonResponse(data, status = 200, request = null, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': getAllowedOrigin(request),
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

const SESSION_COOKIE = 'azluna_portal_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 hari

function getSigningSecret(env) {
  return env?.PORTAL_SESSION_SECRET || env?.PORTAL_PASSWORD || 'Izza-Nabil2027-portal-key';
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signValue(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(sig);
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return '';
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

export async function createPortalSessionCookie(env, isSecure = true) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `portal.${exp}`;
  const sig = await signValue(payload, getSigningSecret(env));
  const value = encodeURIComponent(`${payload}.${sig}`);
  const secureFlag = isSecure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SEC}; HttpOnly; SameSite=Lax${secureFlag}`;
}

export function clearPortalSessionCookie(isSecure = true) {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`;
}

export async function verifyPortalSession(request, env) {
  try {
    const raw = parseCookie(request.headers.get('Cookie') || '', SESSION_COOKIE);
    if (!raw) return false;
    const parts = raw.split('.');
    if (parts.length !== 3 || parts[0] !== 'portal') return false;
    const exp = Number(parts[1]);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expectedSig = await signValue(`portal.${parts[1]}`, getSigningSecret(env));
    return constantTimeEqual(parts[2], expectedSig);
  } catch {
    return false;
  }
}
