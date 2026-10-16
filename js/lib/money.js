// Money helpers. All amounts are integer minor units (cents).

export function digits(cur) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

export function fmt(minor, cur) {
  const d = digits(cur);
  const v = (Number(minor) || 0) / 10 ** d;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(v);
  } catch {
    return `${v.toFixed(d)} ${cur || ''}`.trim();
  }
}

// Decide which character (if any) is the decimal separator.
function decimalIndex(s, d) {
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot < 0 && lastComma < 0) return -1;
  if (lastDot >= 0 && lastComma >= 0) return Math.max(lastDot, lastComma); // "1,234.50" or "1.234,50"
  const idx = Math.max(lastDot, lastComma);
  const ch = s[idx];
  const count = s.split(ch).length - 1;
  if (count > 1) return -1; // "1,234,567" -> thousands separators
  const after = s.length - idx - 1;
  const before = s.slice(0, idx);
  if (after === 3 && d !== 3 && before !== '' && before !== '0') return -1; // "1,234" -> thousands ("0.125" stays a decimal)
  return idx;
}

// "12.5" -> 1250. Also accepts "1,234.50" and "12,50". Rounds half up. Returns 0 for junk.
export function parse(str, cur) {
  if (str == null) return 0;
  let s = String(str).trim().replace(/[^\d.,-]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (!s) return 0;
  const d = digits(cur);
  const idx = decimalIndex(s, d);
  const intPart = (idx < 0 ? s : s.slice(0, idx)).replace(/[.,]/g, '');
  const frac = idx < 0 ? '' : s.slice(idx + 1).replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return 0;

  let units = BigInt(intPart || '0') * 10n ** BigInt(d);
  const padded = (frac + '0'.repeat(d + 1)).slice(0, d + 1);
  if (d > 0) {
    units += BigInt(padded.slice(0, d));
  }
  if (Number(padded[d]) >= 5) units += 1n; // round half up on the next digit
  const n = Number(units);
  return neg ? -n : n;
}

// For input fields: 1250 -> "12.50"; 0 -> "".
export function toInput(minor, cur) {
  if (!minor) return '';
  const d = digits(cur);
  return (minor / 10 ** d).toFixed(d);
}
