export const ALLOWED_EVENT_TYPES = new Set([
  'iframe_not_created',
  'iframe_loaded_without_fields',
  'loader_script_failed',
  'javascript_compatibility_error',
]);

const FIELD_LIMITS = {
  type: 64,
  browserFamily: 40,
  browserMajor: 8,
  osFamily: 40,
  pageVersion: 40,
};

export function sanitizeEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const type = clean(value.type, FIELD_LIMITS.type);
  if (!ALLOWED_EVENT_TYPES.has(type)) return null;

  return {
    type,
    browserFamily: clean(value.browserFamily, FIELD_LIMITS.browserFamily) || 'unknown',
    browserMajor: clean(value.browserMajor, FIELD_LIMITS.browserMajor) || 'unknown',
    osFamily: clean(value.osFamily, FIELD_LIMITS.osFamily) || 'unknown',
    pageVersion: clean(value.pageVersion, FIELD_LIMITS.pageVersion) || 'unknown',
  };
}

export function clean(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function minuteBucket(date) {
  return date.toISOString().slice(0, 16) + ':00.000Z';
}

export function hourBucket(date) {
  return date.toISOString().slice(0, 13) + ':00:00.000Z';
}

export function minutesAgo(date, minutes) {
  return new Date(date.getTime() - minutes * 60_000).toISOString();
}

export function integerSetting(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function corsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
