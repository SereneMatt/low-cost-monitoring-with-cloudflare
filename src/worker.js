import {
  corsHeaders,
  hourBucket,
  integerSetting,
  jsonResponse,
  minuteBucket,
  minutesAgo,
  sanitizeEvent,
} from './core.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      if (origin !== env.ALLOWED_ORIGIN) {
        return new Response(null, { status: 403, headers: cors });
      }
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true }, 200);
    }

    if (url.pathname !== '/form-error' || request.method !== 'POST') {
      return jsonResponse({ error: 'not_found' }, 404, cors);
    }

    if (origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, cors);
    }

    const contentLength = Number(request.headers.get('Content-Length') || '0');
    if (contentLength > 4096) {
      return jsonResponse({ error: 'payload_too_large' }, 413, cors);
    }

    let raw;
    try {
      raw = JSON.parse(await request.text());
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, cors);
    }

    const event = sanitizeEvent(raw);
    if (!event) {
      return jsonResponse({ error: 'invalid_event' }, 400, cors);
    }

    const now = new Date();
    const allowed = await consumeRateLimit(request, env, now);
    if (!allowed) {
      return jsonResponse({ accepted: true }, 202, cors);
    }

    await recordEvent(env.DB, event, now);
    ctx.waitUntil(maybeOpenAlert(env, event.type, now));

    return jsonResponse({ accepted: true }, 202, cors);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(checkRecoveries(env, new Date()));
  },
};

async function consumeRateLimit(request, env, now) {
  const max = integerSetting(env.MAX_EVENTS_PER_CLIENT_PER_HOUR, 30, 1, 500);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const salt = env.RATE_LIMIT_SALT || 'configure-rate-limit-salt';
  const encoded = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const clientHash = [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  await env.DB.prepare(
    `INSERT INTO rate_limits (hour_bucket, client_hash, event_count)
     VALUES (?, ?, 1)
     ON CONFLICT (hour_bucket, client_hash)
     DO UPDATE SET event_count = event_count + 1`
  )
    .bind(hourBucket(now), clientHash)
    .run();

  const row = await env.DB.prepare('SELECT event_count FROM rate_limits WHERE hour_bucket = ? AND client_hash = ?')
    .bind(hourBucket(now), clientHash)
    .first();

  return Number(row?.event_count || 0) <= max;
}

async function recordEvent(db, event, now) {
  await db
    .prepare(
      `INSERT INTO event_buckets (
         minute_bucket, event_type, browser_family, browser_major,
         os_family, page_version, event_count
       ) VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (
         minute_bucket, event_type, browser_family, browser_major,
         os_family, page_version
       ) DO UPDATE SET event_count = event_count + 1`
    )
    .bind(minuteBucket(now), event.type, event.browserFamily, event.browserMajor, event.osFamily, event.pageVersion)
    .run();
}

async function maybeOpenAlert(env, eventType, now) {
  const threshold = integerSetting(env.ALERT_THRESHOLD, 3, 1, 1000);
  const windowMinutes = integerSetting(env.ALERT_WINDOW_MINUTES, 10, 1, 1440);
  const cooldownMinutes = integerSetting(env.ALERT_COOLDOWN_MINUTES, 60, 5, 10080);
  const count = await recentCount(env.DB, eventType, now, windowMinutes);
  if (count < threshold) return;

  const state = await env.DB.prepare('SELECT is_open, last_alerted_at FROM alert_state WHERE event_type = ?')
    .bind(eventType)
    .first();

  const cooldownCutoff = Date.now() - cooldownMinutes * 60_000;
  const lastAlerted = state?.last_alerted_at ? Date.parse(state.last_alerted_at) : 0;
  if (state?.is_open && lastAlerted > cooldownCutoff) return;

  const breakdown = await recentBreakdown(env.DB, eventType, now, windowMinutes);
  await sendSlackAlert(
    env,
    `:rotating_light: *Giving form alert: ${eventType}*`,
    buildAlertText(eventType, count, windowMinutes, breakdown, now)
  );

  await env.DB.prepare(
    `INSERT INTO alert_state (event_type, is_open, opened_at, last_alerted_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT (event_type) DO UPDATE SET
       is_open = 1,
       opened_at = CASE WHEN alert_state.is_open = 0
         THEN excluded.opened_at ELSE alert_state.opened_at END,
       last_alerted_at = excluded.last_alerted_at`
  )
    .bind(eventType, now.toISOString(), now.toISOString())
    .run();
}

async function checkRecoveries(env, now) {
  const recoveryMinutes = integerSetting(env.RECOVERY_WINDOW_MINUTES, 15, 5, 1440);
  const openAlerts = await env.DB.prepare('SELECT event_type, opened_at FROM alert_state WHERE is_open = 1').all();

  for (const alert of openAlerts.results || []) {
    const count = await recentCount(env.DB, alert.event_type, now, recoveryMinutes);
    if (count !== 0) continue;

    await sendSlackAlert(
      env,
      `:white_check_mark: *Giving form recovered: ${alert.event_type}*`,
      [
        `No ${alert.event_type} reports were received in the last ${recoveryMinutes} minutes.`,
        `Incident opened: ${alert.opened_at || 'unknown'}`,
        `Recovered: ${now.toISOString()}`,
      ].join('\n')
    );

    await env.DB.prepare(
      `UPDATE alert_state
       SET is_open = 0, last_recovered_at = ?
       WHERE event_type = ?`
    )
      .bind(now.toISOString(), alert.event_type)
      .run();
  }

  const retentionCutoff = minutesAgo(now, 60 * 24 * 30);
  const rateLimitCutoff = minutesAgo(now, 60 * 48);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM event_buckets WHERE minute_bucket < ?').bind(retentionCutoff),
    env.DB.prepare('DELETE FROM rate_limits WHERE hour_bucket < ?').bind(rateLimitCutoff),
  ]);
}

async function recentCount(db, eventType, now, minutes) {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(event_count), 0) AS total
       FROM event_buckets
       WHERE event_type = ? AND minute_bucket >= ?`
    )
    .bind(eventType, minutesAgo(now, minutes))
    .first();
  return Number(row?.total || 0);
}

async function recentBreakdown(db, eventType, now, minutes) {
  const result = await db
    .prepare(
      `SELECT browser_family, browser_major, os_family,
              SUM(event_count) AS total
       FROM event_buckets
       WHERE event_type = ? AND minute_bucket >= ?
       GROUP BY browser_family, browser_major, os_family
       ORDER BY total DESC
       LIMIT 10`
    )
    .bind(eventType, minutesAgo(now, minutes))
    .all();
  return result.results || [];
}

function buildAlertText(eventType, count, windowMinutes, breakdown, now) {
  const lines = [
    `Donation form failure: ${eventType}`,
    `${count} reports in the last ${windowMinutes} minutes.`,
    `Checked: ${now.toISOString()}`,
    '',
    'Browser breakdown:',
  ];
  for (const row of breakdown) {
    lines.push(`- ${row.browser_family} ${row.browser_major} / ${row.os_family}: ${row.total}`);
  }
  return lines.join('\n');
}

async function sendSlackAlert(env, heading, text) {
  if (!env.SLACK_WEBHOOK_URL) {
    throw new Error('SLACK_WEBHOOK_URL is not configured');
  }

  const response = await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: `${heading}\n${text}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack returned HTTP ${response.status}`);
  }
}
