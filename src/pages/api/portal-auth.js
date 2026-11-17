export const prerender = false;

import {
  jsonResponse,
  createPortalSessionCookie,
  clearPortalSessionCookie,
  verifyPortalSession
} from '../../lib/api-utils.js';

export async function OPTIONS({ request }) {
  return jsonResponse({ ok: true }, 200, request, 'GET, POST, DELETE, OPTIONS');
}

export async function GET({ request, locals }) {
  const env = locals?.runtime?.env;
  const authenticated = await verifyPortalSession(request, env);
  return jsonResponse({ success: true, authenticated }, 200, request, 'GET, POST, DELETE, OPTIONS');
}

export async function POST({ request, locals }) {
  try {
    const env = locals?.runtime?.env;
    const body = await request.json().catch(() => ({}));
    const pass = String(body.password || '').trim();
    const expected = env?.PORTAL_PASSWORD || 'Izza-Nabil2027';

    if (!pass || pass !== expected) {
      return jsonResponse({ success: false, error: 'Kata sandi salah.' }, 401, request, 'GET, POST, DELETE, OPTIONS');
    }

    const isSecure = new URL(request.url).protocol === 'https:';
    const cookie = await createPortalSessionCookie(env, isSecure);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookie,
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message || 'Gagal memproses login' }, 500, request);
  }
}

export async function DELETE({ request }) {
  const isSecure = new URL(request.url).protocol === 'https:';
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearPortalSessionCookie(isSecure),
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}
