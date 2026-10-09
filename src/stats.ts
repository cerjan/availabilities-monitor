export interface DateFormatInfo {
  count: number;
  example: string;
}

export interface AvailabilityStats {
  rowCount: number;
  skuCount: number;
  qtyTotal: number;
  qtyCurrent: number;
  zeroRows: number;
  dateMin: string | null;
  dateMinTs: number | null;
  dateMax: string | null;
  dateMaxTs: number | null;
  distinctDates: number;
  invalidDates: number;
  dateFormats: Record<string, DateFormatInfo>;
}

interface AvailabilityRow {
  productSizeCode?: unknown;
  quantity?: unknown;
  date?: unknown;
}

interface ParsedDate {
  ts: number;
  format: string;
}

const MAX_FORMATS = 20;
const OTHER_FORMAT = '(další)';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:([T ])\d{2}:\d{2}(:\d{2})?(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Describes the shape of a date value, e.g. `YYYY-MM-DDThh:mm:ss` or `YYYY-MM-DDThh:mm:ss.fffffff+hh:mm`.
 * Values that are not ISO 8601 get digits masked as `9` and letters as `a`.
 */
export function dateFormat(value: unknown): string {
  if (typeof value !== 'string') return value === null ? 'null' : typeof value;

  const m = ISO_DATE.exec(value);
  if (!m) return value.slice(0, 40).replace(/\d/g, '9').replace(/[a-z]/gi, 'a');

  const [, separator, seconds, fraction, offset] = m;
  let format = 'YYYY-MM-DD';
  if (separator) {
    format += `${separator}hh:mm`;
    if (seconds) format += ':ss';
    if (fraction) format += `.${'f'.repeat(fraction.length)}`;
  }
  if (offset) format += offset === 'Z' ? 'Z' : offset.includes(':') ? '±hh:mm' : '±hhmm';
  return format;
}

/** Parses a date value; ISO date-times without an offset are taken as UTC so the result does not depend on the runtime timezone. */
export function parseDate(value: string): number {
  const m = ISO_DATE.exec(value);
  if (m && m[1] && !m[4]) return Date.parse(`${value.replace(' ', 'T')}Z`);
  return Date.parse(value);
}

/** Aggregates one availability snapshot. `now` splits current stock (dated at or before it) from future deliveries. */
export function computeStats(rows: unknown[], now: number): AvailabilityStats {
  const skus = new Set<string>();
  const dates = new Map<string, ParsedDate>();
  const formats: Record<string, DateFormatInfo> = {};
  let formatCount = 0;

  let qtyTotal = 0;
  let qtyCurrent = 0;
  let zeroRows = 0;
  let invalidDates = 0;
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  let dateMinTs = Infinity;
  let dateMaxTs = -Infinity;

  for (const item of rows) {
    const row = item as AvailabilityRow | null;

    if (typeof row?.productSizeCode === 'string') skus.add(row.productSizeCode);

    const qty = typeof row?.quantity === 'number' ? row.quantity : 0;
    qtyTotal += qty;
    if (qty === 0) zeroRows++;

    const raw = row?.date;
    let parsed: ParsedDate;
    if (typeof raw === 'string') {
      let cached = dates.get(raw);
      if (!cached) {
        cached = { ts: parseDate(raw), format: dateFormat(raw) };
        dates.set(raw, cached);
      }
      parsed = cached;
    } else {
      parsed = { ts: NaN, format: dateFormat(raw) };
    }

    let format = parsed.format;
    if (!(format in formats)) {
      if (formatCount >= MAX_FORMATS) format = OTHER_FORMAT;
      else formatCount++;
    }
    const info = (formats[format] ??= { count: 0, example: String(raw).slice(0, 60) });
    info.count++;

    if (Number.isNaN(parsed.ts)) {
      invalidDates++;
      continue;
    }
    if (parsed.ts <= now) qtyCurrent += qty;
    if (parsed.ts < dateMinTs) {
      dateMinTs = parsed.ts;
      dateMin = raw as string;
    }
    if (parsed.ts > dateMaxTs) {
      dateMaxTs = parsed.ts;
      dateMax = raw as string;
    }
  }

  return {
    rowCount: rows.length,
    skuCount: skus.size,
    qtyTotal,
    qtyCurrent,
    zeroRows,
    dateMin,
    dateMinTs: dateMin === null ? null : dateMinTs,
    dateMax,
    dateMaxTs: dateMax === null ? null : dateMaxTs,
    distinctDates: dates.size,
    invalidDates,
    dateFormats: formats,
  };
}
