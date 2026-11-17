export const prerender = false;

import { getDb, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';

const CONFIG_KEY = 'maps_config';

const ALLOWED_MAP_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
  'maps.google.com',
  'www.google.com',
  'google.com',
  'maps.google.co.id',
  'www.google.co.id'
]);

const SHORTLINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

async function ensureSiteConfigTable(d1) {
  await d1
    .prepare(
      'CREATE TABLE IF NOT EXISTS site_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)'
    )
    .run();
}

function isValidCoordPair(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function formatCoords(lat, lng) {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

function buildEmbedFromCoords(coords, mapType = 'k') {
  const tParam = mapType === 'm' ? 'm' : 'k';
  return `https://maps.google.com/maps?q=${encodeURIComponent(coords)}&t=${tParam}&z=18&hl=id&output=embed`;
}

function buildEmbedFromQuery(query, mapType = 'k') {
  const tParam = mapType === 'm' ? 'm' : 'k';
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=${tParam}&z=17&hl=id&output=embed`;
}

function parseDmsCoords(text) {
  const re =
    /(\d{1,3})\s*°\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]\s*([NS])\s*[,;\s]+\s*(\d{1,3})\s*°\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]\s*([EW])/i;
  const m = String(text || '').match(re);
  if (!m) return null;

  const lat =
    (Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) *
    (m[4].toUpperCase() === 'S' ? -1 : 1);
  const lng =
    (Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600) *
    (m[8].toUpperCase() === 'W' ? -1 : 1);

  if (!isValidCoordPair(lat, lng)) return null;
  return formatCoords(lat, lng);
}

function parseDecimalCoords(text) {
  const m = String(text || '')
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!isValidCoordPair(lat, lng)) return null;
  return formatCoords(lat, lng);
}

function decodeBase64Utf8(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function extractCoordsFromMapsString(str) {
  const text = String(str || '');
  if (!text) return null;

  // 1. Exact pin marker (!3dLAT!4dLNG) inside Google Maps URL
  const pinMatch = text.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (pinMatch) {
    const lat = Number(pinMatch[1]);
    const lng = Number(pinMatch[2]);
    if (isValidCoordPair(lat, lng)) return formatCoords(lat, lng);
  }

  // 2. Base64 DMS inside embed pb (!2z...) — exact pin coordinate label
  const b64Match = text.match(/!2z([A-Za-z0-9+/=_-]+)/);
  if (b64Match) {
    const decoded = decodeBase64Utf8(b64Match[1].replace(/-/g, '+').replace(/_/g, '/'));
    const dms = parseDmsCoords(decoded);
    if (dms) return dms;
  }

  // 3. Embed pb (!2dLNG!3dLAT)
  const pbMatch = text.match(/!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/);
  if (pbMatch) {
    const lng = Number(pbMatch[1]);
    const lat = Number(pbMatch[2]);
    if (isValidCoordPair(lat, lng)) return formatCoords(lat, lng);
  }

  // 4. Query param ?q=lat,lng / ?ll=lat,lng / ?query=lat,lng / center=lat%2Clng
  const qpMatch = text.match(
    /(?:[?&](?:q|ll|query|destination|sll)|center)=(-?\d{1,2}\.\d+)(?:,|%2C|\s)+(-?\d{1,3}\.\d+)/i
  );
  if (qpMatch) {
    const lat = Number(qpMatch[1]);
    const lng = Number(qpMatch[2]);
    if (isValidCoordPair(lat, lng)) return formatCoords(lat, lng);
  }

  // 5. Path /search/lat,lng or /@lat,lng
  const atMatch = text.match(/(?:@|\/search\/)(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (isValidCoordPair(lat, lng)) return formatCoords(lat, lng);
  }

  return null;
}

function extractPlaceQueryFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q && q.trim()) return q.trim();

    const placeMatch = u.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
    if (placeMatch && placeMatch[1]) {
      return decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
    }
  } catch {
    // ignore invalid URL
  }
  return '';
}

function isAllowedGoogleMapsHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (ALLOWED_MAP_HOSTS.has(host)) return true;
  return /^(?:maps|www)\.google\.[a-z.]{2,6}$/.test(host);
}

async function resolveGoogleMapsShortUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Format link tidak valid.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Link harus menggunakan protokol https://.');
  }
  if (!isAllowedGoogleMapsHost(parsed.hostname)) {
    throw new Error('Link harus berasal dari domain Google Maps (maps.app.goo.gl atau google.com/maps).');
  }

  const directCoords = extractCoordsFromMapsString(urlStr);
  if (directCoords && !SHORTLINK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { finalUrl: urlStr, coords: directCoords, placeQuery: extractPlaceQueryFromUrl(urlStr) };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(urlStr, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const finalUrl = res.url || urlStr;
    let coords = extractCoordsFromMapsString(finalUrl);
    let placeQuery = extractPlaceQueryFromUrl(finalUrl);

    if (!coords) {
      const text = (await res.text().catch(() => '')).slice(0, 150000);
      coords = extractCoordsFromMapsString(text);
      if (!coords) {
        const embeddedUrlMatch = text.match(/https:\/\/(?:www\.)?google\.com\/maps\/[^"'\s<>\\]+/);
        if (embeddedUrlMatch) {
          coords = extractCoordsFromMapsString(embeddedUrlMatch[0]);
          if (!placeQuery) placeQuery = extractPlaceQueryFromUrl(embeddedUrlMatch[0]);
        }
      }
    }

    return { finalUrl, coords, placeQuery };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveMapInput(rawInput, mapType = 'k') {
  const input = String(rawInput || '').trim();
  if (!input) {
    return { ok: false, error: 'Masukkan link Google Maps, koordinat, atau kode iframe terlebih dahulu.' };
  }

  // 1. Input berisi tag <iframe>
  const iframeMatch = input.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch && iframeMatch[1]) {
    const src = iframeMatch[1].replace(/&amp;/g, '&').trim();
    return resolveMapInput(src, mapType);
  }

  // 2. Direct embed URL (/maps/embed or output=embed)
  if (/^https:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps(?:\/embed|\?[^ ]*output=embed)/i.test(input)) {
    let embedUrl = input;
    const isPbEmbed = /\/maps\/embed\?pb=/i.test(embedUrl);
    if (!isPbEmbed && /output=embed/i.test(embedUrl)) {
      try {
        const u = new URL(embedUrl);
        u.searchParams.set('t', mapType === 'm' ? 'm' : 'k');
        embedUrl = u.toString();
      } catch {
        // keep as-is
      }
    }
    const coords = extractCoordsFromMapsString(embedUrl);
    const placeQuery = extractPlaceQueryFromUrl(embedUrl);
    return {
      ok: true,
      resolved: {
        mapEmbed: embedUrl,
        mapQuery: coords || placeQuery || embedUrl,
        coords: coords || null,
        sourceType: isPbEmbed ? 'iframe' : 'embed-url'
      }
    };
  }

  // 3. Koordinat desimal langsung (misal: -6.960222, 108.890500)
  const decimalCoords = parseDecimalCoords(input);
  if (decimalCoords) {
    return {
      ok: true,
      resolved: {
        mapEmbed: buildEmbedFromCoords(decimalCoords, mapType),
        mapQuery: decimalCoords,
        coords: decimalCoords,
        sourceType: 'coords'
      }
    };
  }

  // 4. Koordinat DMS langsung (misal: 6°57'36.8"S 108°53'25.8"E)
  const dmsCoords = parseDmsCoords(input);
  if (dmsCoords) {
    return {
      ok: true,
      resolved: {
        mapEmbed: buildEmbedFromCoords(dmsCoords, mapType),
        mapQuery: dmsCoords,
        coords: dmsCoords,
        sourceType: 'dms'
      }
    };
  }

  // 5. Link Google Maps (termasuk teks share dari HP seperti "Masjid...\nhttps://maps.app.goo.gl/...")
  const urlMatch = input.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch && urlMatch[0]) {
    const rawUrl = urlMatch[0].replace(/[),.;]+$/, '');
    let resolvedLink;
    try {
      resolvedLink = await resolveGoogleMapsShortUrl(rawUrl);
    } catch (err) {
      return { ok: false, error: err.message || 'Gagal membaca link Google Maps.' };
    }
    const { finalUrl, coords, placeQuery } = resolvedLink;

    if (coords) {
      return {
        ok: true,
        resolved: {
          mapEmbed: buildEmbedFromCoords(coords, mapType),
          mapQuery: coords,
          coords,
          resolvedUrl: finalUrl,
          sourceType: 'link-coords'
        }
      };
    }

    if (placeQuery) {
      return {
        ok: true,
        resolved: {
          mapEmbed: buildEmbedFromQuery(placeQuery, mapType),
          mapQuery: placeQuery,
          coords: null,
          resolvedUrl: finalUrl,
          sourceType: 'link-query'
        }
      };
    }

    return {
      ok: false,
      error:
        'Link Google Maps tidak memuat titik koordinat yang dapat dibaca. Coba tekan tahan di peta HP hingga muncul pin merah lalu salin koordinat atau Bagikan ulang linknya.'
    };
  }

  // 6. Teks nama tempat / alamat biasa
  if (input.length >= 3) {
    return {
      ok: true,
      resolved: {
        mapEmbed: buildEmbedFromQuery(input, mapType),
        mapQuery: input,
        coords: null,
        sourceType: 'text-query'
      }
    };
  }

  return { ok: false, error: 'Input lokasi terlalu pendek.' };
}

function sanitizeLocationPayload(loc = {}) {
  const place = String(loc.place || '').trim().slice(0, 120);
  const note = loc.note !== undefined ? String(loc.note || '').trim().slice(0, 80) : undefined;
  const address = String(loc.address || '').trim().slice(0, 260);
  const mapQuery = String(loc.mapQuery || '').trim().slice(0, 300);
  const mapEmbed = String(loc.mapEmbed || '').trim().slice(0, 1200);
  const mapType = loc.mapType === 'm' ? 'm' : 'k';
  const rawInput = String(loc.rawInput || '').trim().slice(0, 1200);

  if (mapEmbed) {
    let validEmbed = false;
    try {
      const u = new URL(mapEmbed);
      validEmbed = u.protocol === 'https:' && isAllowedGoogleMapsHost(u.hostname);
    } catch {
      validEmbed = false;
    }
    if (!validEmbed) {
      throw new Error('URL embed peta harus berupa link HTTPS Google Maps yang valid.');
    }
  }

  const out = { place, address, mapQuery, mapEmbed, mapType, rawInput };
  if (note !== undefined) out.note = note;
  return out;
}

export async function OPTIONS() {
  return jsonResponse({ ok: true });
}

export async function GET(context) {
  try {
    const d1 = context.locals?.runtime?.env?.DB;
    if (!d1) {
      return jsonResponse({ error: 'Database D1 tidak ditemukan pada runtime Cloudflare' }, 500);
    }

    await ensureSiteConfigTable(d1);
    const db = getDb(d1);
    const rows = await db
      .select()
      .from(schema.siteConfig)
      .where(eq(schema.siteConfig.key, CONFIG_KEY))
      .limit(1);

    if (!rows.length) {
      return jsonResponse({ success: true, data: null });
    }

    const parsed = JSON.parse(rows[0].value || 'null');
    return jsonResponse({ success: true, data: parsed, updatedAt: rows[0].updatedAt || null });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Gagal memuat konfigurasi maps' }, 500);
  }
}

export async function POST(context) {
  try {
    const body = await context.request.json().catch(() => ({}));

    if (body.action === 'resolve') {
      const result = await resolveMapInput(body.input, body.mapType === 'm' ? 'm' : 'k');
      if (!result.ok) {
        return jsonResponse({ success: false, error: result.error }, 400);
      }
      return jsonResponse({ success: true, resolved: result.resolved });
    }

    const d1 = context.locals?.runtime?.env?.DB;
    if (!d1) {
      return jsonResponse({ error: 'Database D1 tidak ditemukan pada runtime Cloudflare' }, 500);
    }

    const akad = sanitizeLocationPayload(body.akad || {});
    const resepsi = sanitizeLocationPayload(body.resepsi || {});
    if (!akad.place || !resepsi.place) {
      return jsonResponse({ success: false, error: 'Nama tempat Akad dan Resepsi wajib diisi.' }, 400);
    }

    const payload = {
      akad,
      resepsi,
      updatedAt: new Date().toISOString()
    };

    await ensureSiteConfigTable(d1);
    const db = getDb(d1);
    const serialized = JSON.stringify(payload);

    await db
      .insert(schema.siteConfig)
      .values({
        key: CONFIG_KEY,
        value: serialized,
        updatedAt: payload.updatedAt
      })
      .onConflictDoUpdate({
        target: schema.siteConfig.key,
        set: {
          value: serialized,
          updatedAt: payload.updatedAt
        }
      });

    return jsonResponse({ success: true, data: payload });
  } catch (error) {
    return jsonResponse({ success: false, error: error.message || 'Gagal memproses permintaan maps' }, 500);
  }
}

export async function DELETE(context) {
  try {
    const d1 = context.locals?.runtime?.env?.DB;
    if (!d1) {
      return jsonResponse({ error: 'Database D1 tidak ditemukan pada runtime Cloudflare' }, 500);
    }

    await ensureSiteConfigTable(d1);
    const db = getDb(d1);
    await db.delete(schema.siteConfig).where(eq(schema.siteConfig.key, CONFIG_KEY));

    return jsonResponse({ success: true, message: 'Pengaturan maps dikembalikan ke default.' });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Gagal mereset konfigurasi maps' }, 500);
  }
}
