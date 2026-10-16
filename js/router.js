// Hash routing:  #/                       home
//                #/t/<tripId>/<page>      a trip page (setup | itinerary | budget | bookings | splitter)
//                #/t/<tripId>/<page>?k=<code>   share link (code is stored, then stripped from the URL)

export const PAGE_KEYS = ['itinerary', 'budget', 'bookings', 'splitter', 'setup'];

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}

export function tripPath(tripId, page) {
  return `#/t/${tripId}/${page}`;
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function shareLink(tripId, code) {
  const base = location.href.split('#')[0];
  return `${base}#/t/${tripId}/itinerary?k=${encodeURIComponent(code)}`;
}

// Accepts a full share link or "tripId code" pasted by a person.
export function parseShareLink(text) {
  const m = String(text).match(/#\/t\/([0-9a-f-]{36})(?:\/[a-z]+)?\?k=([A-Za-z0-9]+)/i);
  return m ? { tripId: m[1], code: m[2] } : null;
}
