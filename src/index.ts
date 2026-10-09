import { collect, type Run } from './collect';
import type { Env } from './env';
import { checkPassword, clearedSessionCookie, hasSession, sessionCookie } from './session';
import dashboardHtml from './pages/dashboard.html';
import loginHtml from './pages/login.html';

const RAW_RETENTION_DAYS = 14;
const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '14d': 14, '30d': 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; " +
    "connect-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === '/login') {
      return method === 'POST' ? login(request, env) : loginPage();
    }
    if (pathname === '/logout' && method === 'POST') {
      return redirect('/login', clearedSessionCookie());
    }

    if (!(await hasSession(request, env))) {
      return pathname.startsWith('/api/') ? json({ error: 'unauthorized' }, 401) : redirect('/login');
    }

    if (pathname === '/' && method === 'GET') return html(dashboardHtml);
    if (pathname === '/api/runs' && method === 'GET') return listRuns(env, url);
    if (pathname === '/api/run' && method === 'POST') return json(toApi(await collect(env, 'manual', Date.now())));

    const raw = /^\/api\/runs\/(\d+)\/raw$/.exec(pathname);
    if (raw && method === 'GET') return downloadRaw(env, Number(raw[1]));

    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env) {
    await collect(env, 'cron', controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;

async function login(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const password = form.get('password');
  if (typeof password === 'string' && (await checkPassword(env, password))) {
    return redirect('/', await sessionCookie(env));
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return loginPage('Nesprávné heslo.', 401);
}

function loginPage(error = '', status = 200): Response {
  const message = error ? `<p class="error" role="alert">${error}</p>` : '';
  return html(loginHtml.replace('<!--error-->', message), status);
}

async function listRuns(env: Env, url: URL): Promise<Response> {
  const range = url.searchParams.get('range') ?? '24h';
  const days = RANGES[range] ?? RANGES['24h'];
  const to = Date.now();
  const from = to - days * DAY_MS;

  const { results } = await env.DB.prepare(
    `SELECT id, ts, trigger, ok, error, auth_status, auth_ms, avail_status, avail_ms, body_bytes, raw_key IS NOT NULL AS has_raw,
            row_count, sku_count, qty_total, qty_current, zero_rows, date_min, date_min_ts, date_max, date_max_ts,
            distinct_dates, invalid_dates, date_formats
     FROM runs WHERE ts >= ? ORDER BY ts`,
  )
    .bind(from)
    .all<Record<string, unknown>>();

  const runs = results.map((r) => ({ ...r, date_formats: r.date_formats ? JSON.parse(r.date_formats as string) : null }));
  return json({ from, to, rawRetentionDays: RAW_RETENTION_DAYS, runs });
}

async function downloadRaw(env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare('SELECT raw_key FROM runs WHERE id = ?').bind(id).first<{ raw_key: string | null }>();
  const object = row?.raw_key ? await env.RAW.get(row.raw_key) : null;
  if (!object) return new Response('Raw response not available (retention is 14 days).', { status: 404 });

  const filename = row!.raw_key!.replace(/^raw\//, '').replace(/\//g, '-').replace(/\.gz$/, '');
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/json',
      'content-encoding': 'gzip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, max-age=86400',
    },
    encodeBody: 'manual',
  });
}

function toApi(run: Run) {
  return { ts: run.ts, ok: run.ok, error: run.error, rows: run.stats?.rowCount ?? null, qtyTotal: run.stats?.qtyTotal ?? null };
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location });
  if (setCookie) headers.set('set-cookie', setCookie);
  return new Response(null, { status: 303, headers });
}
