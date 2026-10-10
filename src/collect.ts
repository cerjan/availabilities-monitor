import type { Env } from './env';
import { computeStats, type AvailabilityStats } from './stats';

const USER_AGENT = 'availabilities-monitor (+https://reqs-availabilities.jace.cz)';
const AUTH_TIMEOUT_MS = 30_000;
const AVAILABILITY_TIMEOUT_MS = 180_000;

export type Trigger = 'cron' | 'manual';

export interface Run {
  ts: number;
  trigger: Trigger;
  ok: boolean;
  error: string | null;
  authStatus: number | null;
  authMs: number | null;
  availStatus: number | null;
  availMs: number | null;
  bodyBytes: number | null;
  rawKey: string | null;
  stats: AvailabilityStats | null;
}

/** Logs in, downloads the availability snapshot, archives it to R2 and records its statistics in D1. */
export async function collect(env: Env, trigger: Trigger, ts: number): Promise<Run> {
  const run: Run = {
    ts,
    trigger,
    ok: false,
    error: null,
    authStatus: null,
    authMs: null,
    availStatus: null,
    availMs: null,
    bodyBytes: null,
    rawKey: null,
    stats: null,
  };

  try {
    const token = await stage('login', () => login(env, run));
    const { body, contentType, fetchedAt } = await stage('availability', () => fetchAvailability(env, run, token));

    try {
      run.rawKey = await storeRaw(env, run, body, contentType);
    } catch (e) {
      run.error = `r2: ${errorMessage(e)}`;
    }

    const text = new TextDecoder().decode(body);
    if (run.availStatus !== 200) throw new Error(`availability: HTTP ${run.availStatus} ${preview(text)}`);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`availability: invalid JSON ${preview(text)}`);
    }
    if (!Array.isArray(data)) throw new Error(`availability: expected JSON array ${preview(text)}`);

    run.stats = computeStats(data, fetchedAt);
    run.ok = true;
  } catch (e) {
    run.error = errorMessage(e);
  }

  await save(env, run);
  console.log(JSON.stringify({ event: 'run', trigger, ok: run.ok, error: run.error, rows: run.stats?.rowCount }));
  return run;
}

async function login(env: Env, run: Run): Promise<string> {
  const started = Date.now();
  const res = await fetch(env.AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ username: env.AUTH_USERNAME, password: env.AUTH_PASSWORD }),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  const text = await res.text();
  run.authMs = Date.now() - started;
  run.authStatus = res.status;

  if (!res.ok) throw new Error(`HTTP ${res.status} ${preview(text)}`);

  let token: unknown;
  try {
    token = (JSON.parse(text) as { access_token?: unknown }).access_token;
  } catch {
    throw new Error('invalid JSON');
  }
  if (typeof token !== 'string' || !token) throw new Error('response has no access_token');
  return token;
}

async function fetchAvailability(env: Env, run: Run, token: string) {
  const started = Date.now();
  const res = await fetch(env.AVAILABILITY_URL, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
  });
  const body = new Uint8Array(await res.arrayBuffer());
  const fetchedAt = Date.now();
  run.availMs = fetchedAt - started;
  run.availStatus = res.status;
  run.bodyBytes = body.byteLength;

  return { body, contentType: res.headers.get('content-type') ?? 'application/octet-stream', fetchedAt };
}

async function storeRaw(env: Env, run: Run, body: Uint8Array, contentType: string): Promise<string> {
  const key = rawKey(run.ts, run.trigger);
  const gzipped = await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await env.RAW.put(key, gzipped, {
    httpMetadata: { contentType, contentEncoding: 'gzip' },
    customMetadata: { status: String(run.availStatus), trigger: run.trigger },
  });
  return key;
}

/** `raw/2026/10/09/0815.json.gz`, manual runs `raw/2026/10/09/081342-manual.json.gz` (UTC). */
function rawKey(ts: number, trigger: Trigger): string {
  const iso = new Date(ts).toISOString();
  const [y, m, d] = iso.slice(0, 10).split('-');
  const hhmm = iso.slice(11, 13) + iso.slice(14, 16);
  const name = trigger === 'cron' ? hhmm : `${hhmm}${iso.slice(17, 19)}-manual`;
  return `raw/${y}/${m}/${d}/${name}.json.gz`;
}

/** Claims a scheduled cron minute; false if another invocation of the same tick already claimed it. */
export async function claimCronTick(env: Env, ts: number): Promise<boolean> {
  const { meta } = await env.DB.prepare('INSERT INTO cron_ticks (ts) VALUES (?) ON CONFLICT DO NOTHING').bind(ts).run();
  return meta.changes === 1;
}

async function save(env: Env, run: Run): Promise<void> {
  const s = run.stats;
  await env.DB.prepare(
    `INSERT INTO runs (ts, trigger, ok, error, auth_status, auth_ms, avail_status, avail_ms, body_bytes, raw_key,
                       row_count, sku_count, qty_total, qty_current, zero_rows, date_min, date_min_ts, date_max, date_max_ts,
                       distinct_dates, invalid_dates, date_formats)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      run.ts,
      run.trigger,
      run.ok ? 1 : 0,
      run.error,
      run.authStatus,
      run.authMs,
      run.availStatus,
      run.availMs,
      run.bodyBytes,
      run.rawKey,
      s?.rowCount ?? null,
      s?.skuCount ?? null,
      s?.qtyTotal ?? null,
      s?.qtyCurrent ?? null,
      s?.zeroRows ?? null,
      s?.dateMin ?? null,
      s?.dateMinTs ?? null,
      s?.dateMax ?? null,
      s?.dateMaxTs ?? null,
      s?.distinctDates ?? null,
      s?.invalidDates ?? null,
      s ? JSON.stringify(s.dateFormats) : null,
    )
    .run();
}

async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${name}: ${errorMessage(e)}`);
  }
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function errorMessage(e: unknown): string {
  const message = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e);
  return message.slice(0, 1000);
}
