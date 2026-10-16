// Pull coordinates out of pasted text: "38.7139, -9.1394", a Google/Apple/OSM map URL, etc.
// Short links (maps.app.goo.gl, goo.gl/maps) contain no coordinates and can't be read.

const N = '-?\\d{1,3}(?:\\.\\d+)?';

function valid(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function result(a, b) {
  const lat = parseFloat(a);
  const lng = parseFloat(b);
  if (!valid(lat, lng)) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

export function isShortLink(input) {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|apple\.co)/i.test(input || '');
}

export function parseLocation(input) {
  if (!input) return null;
  let s = String(input).trim();
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  s = s.replace(/[°]/g, '');

  const patterns = [
    new RegExp(`!3d(${N})!4d(${N})`),                                   // Google place data
    new RegExp(`@(${N}),\\s*(${N})`),                                    // Google @lat,lng,zoom
    new RegExp(`[?&](?:q|ll|sll|query|center|coordinate|destination|daddr|saddr)=(${N})\\s*,\\s*(${N})`), // q=lat,lng
    new RegExp(`[?&]mlat=(${N})&(?:amp;)?mlon=(${N})`),                  // OSM marker
    new RegExp(`#map=\\d+/(${N})/(${N})`),                               // OSM view
    new RegExp(`^\\s*\\(?(${N})\\s*[,; ]\\s*(${N})\\)?\\s*$`),           // plain "lat, lng"
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) {
      const r = result(m[1], m[2]);
      if (r) return r;
    }
  }
  return null;
}
