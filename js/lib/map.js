// Leaflet wrappers (loaded lazily from a CDN). No place search: pins come from clicks or pasted coordinates.

import { h } from './dom.js';

const LEAFLET_VERSION = '1.9.4';
let leafletPromise = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
      document.head.append(css);
      const js = document.createElement('script');
      js.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
      js.onload = () => resolve(window.L);
      js.onerror = () => { leafletPromise = null; reject(new Error('Map library failed to load')); };
      document.head.append(js);
    });
  }
  return leafletPromise;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function baseMap(L, el, center, zoom) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB }).addTo(map);
  return map;
}

function pinIcon(L, label, color) {
  return L.divIcon({
    className: '',
    html: `<div class="map-pin" style="--cat:${color}"><span>${label ?? ''}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

// A map showing many pins: [{id, lat, lng, label, color, title}]
export function createPinMap(el, { onPinClick } = {}) {
  let map = null;
  let layer = null;
  let ready = false;
  let queued = null;
  let alive = true;
  let lastPts = [];
  let needsFit = false;

  el.replaceChildren(h('div', { class: 'map-msg' }, 'Loading map…'));

  loadLeaflet().then((L) => {
    if (!alive) return;
    el.replaceChildren();
    map = baseMap(L, el, [20, 0], 2);
    layer = L.layerGroup().addTo(map);
    ready = true;
    if (queued) draw(queued.pins, queued.fit);
    setTimeout(() => {
      if (!map) return;
      map.invalidateSize();
      if (needsFit) fitToPins();
    }, 50);
  }).catch(() => {
    if (alive) el.replaceChildren(h('div', { class: 'map-msg' }, 'The map could not be loaded. Check your connection.'));
  });

  function draw(pins, fit) {
    const L = window.L;
    layer.clearLayers();
    const pts = [];
    for (const p of pins) {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(L, p.label, p.color), title: p.title || '' });
      if (p.title) {
        // Pass a DOM node: Leaflet treats string content as HTML.
        const tip = document.createElement('span');
        tip.textContent = p.title;
        m.bindTooltip(tip, { direction: 'top', offset: [0, -22] });
      }
      if (onPinClick) m.on('click', () => onPinClick(p.id));
      m.addTo(layer);
      pts.push([p.lat, p.lng]);
    }
    lastPts = pts;
    if (fit) fitToPins();
  }

  // Fitting while the container is hidden (size 0) gives a nonsense zoom, so wait until it is visible.
  function fitToPins() {
    if (!lastPts.length) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) { needsFit = true; return; }
    needsFit = false;
    if (lastPts.length === 1) map.setView(lastPts[0], Math.max(map.getZoom(), 14));
    else map.fitBounds(lastPts, { padding: [36, 36], maxZoom: 16 });
  }

  return {
    setPins(pins, fit = true) {
      if (!ready) { queued = { pins, fit: fit || !!(queued && queued.fit) }; return; }
      draw(pins, fit);
    },
    focus(lat, lng) { if (ready && map) map.setView([lat, lng], Math.max(map.getZoom(), 15)); },
    invalidate() {
      if (!ready) return;
      setTimeout(() => {
        if (!map) return; // destroyed in the meantime
        map.invalidateSize();
        if (needsFit) fitToPins();
      }, 30);
    },
    destroy() { alive = false; if (map) map.remove(); map = null; },
  };
}

// A small map where a click sets a single point.
export function createPicker(el, { lat, lng, fallback, onPick }) {
  let map = null;
  let marker = null;
  let alive = true;

  loadLeaflet().then((L) => {
    if (!alive) return;
    const has = lat != null && lng != null;
    const center = has ? [lat, lng] : (fallback ? [fallback.lat, fallback.lng] : [20, 0]);
    map = baseMap(L, el, center, has ? 14 : fallback ? 12 : 2);
    if (has) marker = L.marker(center, { icon: pinIcon(L, '', 'var(--accent)') }).addTo(map);
    map.on('click', (e) => {
      const p = { lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 };
      set(p.lat, p.lng, false);
      onPick(p);
    });
    setTimeout(() => map && map.invalidateSize(), 80);
  }).catch(() => {
    if (alive) el.replaceChildren(h('div', { class: 'map-msg' }, 'The map could not be loaded. You can still paste coordinates.'));
  });

  function set(la, ln, recenter = true) {
    if (!map) return;
    const L = window.L;
    if (la == null || ln == null) {
      if (marker) { marker.remove(); marker = null; }
      return;
    }
    if (marker) marker.setLatLng([la, ln]);
    else marker = L.marker([la, ln], { icon: pinIcon(L, '', 'var(--accent)') }).addTo(map);
    if (recenter) map.setView([la, ln], Math.max(map.getZoom(), 14));
  }

  return { set, destroy() { alive = false; if (map) map.remove(); map = null; } };
}
