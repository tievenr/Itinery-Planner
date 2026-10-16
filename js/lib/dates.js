// Date helpers. Dates are ISO strings ("2026-11-03"); parsed at local noon to dodge DST edges.

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12);
}

export function toISO(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function rangeISO(startIso, endIso, max = 61) {
  const out = [];
  if (!startIso || !endIso || endIso < startIso) return out;
  let cur = startIso;
  while (cur <= endIso && out.length < max) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function fmtDay(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = parseISO(iso);
  return d ? d.toLocaleDateString(undefined, opts) : '';
}

export function fmtDateTime(isoLocal) {
  if (!isoLocal) return '';
  const d = new Date(isoLocal);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(t) {
  if (!t) return '';
  return String(t).slice(0, 5);
}

// "2026-11-03T14:30:00" -> value for <input type="datetime-local">
export function toInputDateTime(v) {
  return v ? String(v).slice(0, 16) : '';
}
