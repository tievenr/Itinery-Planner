// Itinerary: day tabs, ordered activities, and a map of pinned locations.

import { h, icon, iconButton, openForm, toast, safeUrl } from '../lib/dom.js';
import * as store from '../store.js';
import { fmt } from '../lib/money.js';
import { fmtDay, fmtTime, todayISO, addDays } from '../lib/dates.js';
import { parseLocation, isShortLink } from '../lib/mapLinks.js';
import { createPinMap, createPicker } from '../lib/map.js';
import { CATEGORIES, catLabel, safeCat, catColorVar } from '../lib/cats.js';

let selDay = null;
let view = 'list';
let mapAll = false;
let tabsScroll = 0;
let mapEl = null;
let mapInst = null;
let lastSig = '';

const redraw = () => store.notify();

export function unmount() {
  if (mapInst) mapInst.destroy();
  mapInst = null;
  mapEl = null;
  lastSig = '';
}

function ensureMap() {
  if (!mapEl) {
    mapEl = h('div', { class: 'map-box' });
    mapInst = createPinMap(mapEl, { onPinClick });
  }
  return mapEl;
}

function onPinClick(id) {
  const a = store.state.activities.find((x) => x.id === id);
  if (!a) return;
  if (a.day_id !== selDay) selDay = a.day_id;
  if (!window.matchMedia('(min-width: 1000px)').matches) view = 'list';
  redraw();
  setTimeout(() => {
    const el = document.getElementById('act-' + id);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.animate([{ outline: '2px solid var(--accent)' }, { outline: '2px solid transparent' }], { duration: 1400 });
    }
  }, 60);
}

export function render(root) {
  const days = store.sortedDays();
  const cur = store.cur();

  if (!days.length) {
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Itinerary')),
      h('div', { class: 'empty' },
        h('p', null, 'No days yet. Set trip dates on the Trip page, or add days by hand.'),
        h('p', null, h('button', { class: 'btn primary', onClick: () => addDay(days) }, icon('plus'), 'Add a day'))));
    return;
  }

  if (!selDay || !days.some((d) => d.id === selDay)) {
    selDay = (days.find((d) => d.date === todayISO()) || days[0]).id;
  }
  const dayIdx = days.findIndex((d) => d.id === selDay);
  const day = days[dayIdx];
  const acts = store.activitiesForDay(day.id);
  const dayCost = acts.reduce((s, a) => s + (a.cost || 0), 0);

  // pin numbering follows list order, only for activities that have a location
  const pinNo = {};
  let n = 0;
  acts.forEach((a) => { if (a.lat != null && a.lng != null) pinNo[a.id] = ++n; });

  // ----- tabs -----
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Days' },
    days.map((d, i) => h('button', {
      class: 'tab', role: 'tab', 'aria-selected': d.id === selDay ? 'true' : 'false',
      onClick: () => { selDay = d.id; redraw(); },
    }, `Day ${i + 1}`, d.date ? h('span', { class: 'sub' }, fmtDay(d.date, { day: 'numeric', month: 'short' })) : null)),
    h('button', { class: 'tab', title: 'Add day', 'aria-label': 'Add day', onClick: () => addDay(days) }, icon('plus')));
  tabs.addEventListener('scroll', () => { tabsScroll = tabs.scrollLeft; }, { passive: true });

  // ----- list column -----
  const header = h('div', { class: 'day-head' },
    h('div', { class: 'titles' },
      h('h2', null, day.title || `Day ${dayIdx + 1}`),
      h('div', { class: 'muted small' }, [day.date ? fmtDay(day.date, { weekday: 'long', day: 'numeric', month: 'long' }) : null,
        dayCost ? `Planned ${fmt(dayCost, cur)}` : null].filter(Boolean).join(' · '))),
    iconButton('edit', 'Edit day', () => dayForm(day, days)));

  const list = acts.length
    ? h('div', { class: 'list' }, acts.map((a, i) => actCard(a, i, acts, pinNo[a.id], cur)))
    : h('div', { class: 'empty' }, 'Nothing planned for this day yet.');

  const addRow = h('div', { class: 'add-row' },
    h('button', { class: 'btn primary', onClick: () => activityForm(null, day, days) }, icon('plus'), 'Add activity'),
    acts.length > 1 ? h('button', { class: 'btn', onClick: () => sortByTime(acts) }, icon('sort'), 'Sort by time') : null);

  const listCol = h('section', { class: 'itin-list' }, header, list, addRow);

  // ----- map column -----
  const mapActs = mapAll ? store.state.activities : acts;
  const pins = mapActs
    .filter((a) => a.lat != null && a.lng != null)
    .map((a) => ({ id: a.id, lat: a.lat, lng: a.lng, label: mapAll ? '' : String(pinNo[a.id] || ''), color: catColorVar(a.category), title: a.title }));
  const sig = `${mapAll ? 'all' : selDay}|${pins.map((p) => `${p.id}:${p.lat},${p.lng}`).join(';')}`;
  const fit = sig !== lastSig;
  lastSig = sig;
  const box = ensureMap();
  mapInst.setPins(pins, fit);
  mapInst.invalidate();

  const mapHead = h('div', { class: 'day-head', style: { marginBottom: 0 } },
    h('label', { class: 'small', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      h('input', { type: 'checkbox', checked: mapAll, onChange: (e) => { mapAll = e.target.checked; redraw(); } }),
      'Show all days'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted small' }, pins.length ? `${pins.length} pinned` : 'No pins yet'));
  const mapCol = h('section', { class: 'itin-map-wrap' }, mapHead, box,
    pins.length ? null : h('p', { class: 'muted small' }, 'Edit an activity and tap the map (or paste coordinates or a map link) to pin it.'));

  const toggle = h('div', { class: 'seg itin-toggle', role: 'group', 'aria-label': 'View' },
    h('button', { 'aria-pressed': view === 'list' ? 'true' : 'false', onClick: () => { view = 'list'; redraw(); } }, 'List'),
    h('button', { 'aria-pressed': view === 'map' ? 'true' : 'false', onClick: () => { view = 'map'; redraw(); } }, 'Map'));

  root.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Itinerary')),
    h('div', { class: 'itin', dataset: { view } }, tabs, toggle, h('div', { class: 'itin-grid' }, listCol, mapCol)));
  tabs.scrollLeft = tabsScroll;
}

// ---------- cards ----------

function actCard(a, i, acts, pinNum, cur) {
  const cat = safeCat(a.category);
  const time = a.start_time ? fmtTime(a.start_time) + (a.end_time ? `–${fmtTime(a.end_time)}` : '') : '—';
  const url = safeUrl(a.link);
  const move = (delta) => {
    const ids = acts.map((x) => x.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    store.reorder('activities', ids);
  };
  return h('article', { class: `act cat-${cat}`, id: 'act-' + a.id },
    h('div', { class: 'time' }, time),
    h('div', null,
      h('div', { class: 'title' }, a.title),
      h('div', { class: 'meta' },
        h('span', { class: 'chip' }, h('span', { class: 'dot' }), catLabel(cat)),
        a.cost ? h('span', { class: 'num' }, fmt(a.cost, a.currency || cur)) : null,
        pinNum ? h('button', {
          class: 'pinno', title: 'Show on map', 'aria-label': `Show pin ${pinNum} on map`,
          onClick: () => { if (!window.matchMedia('(min-width: 1000px)').matches) { view = 'map'; redraw(); } setTimeout(() => mapInst && mapInst.focus(a.lat, a.lng), 120); },
        }, pinNum) : null,
        url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Link') : null,
        a.updated_by ? h('span', null, `edited by ${a.updated_by}`) : null),
      a.notes ? h('div', { class: 'notes' }, a.notes) : null),
    h('div', { class: 'actions' },
      iconButton('up', 'Move up', () => move(-1), i === 0 ? 'hidden-btn' : ''),
      iconButton('down', 'Move down', () => move(1)),
      iconButton('edit', 'Edit', () => activityForm(a, null, store.sortedDays()))));
}

function sortByTime(acts) {
  const ids = [...acts]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const tx = x.a.start_time || '99:99';
      const ty = y.a.start_time || '99:99';
      return tx < ty ? -1 : tx > ty ? 1 : x.i - y.i;
    })
    .map((x) => x.a.id);
  store.reorder('activities', ids);
}

// ---------- forms ----------

function addDay(days) {
  const last = days[days.length - 1];
  const date = last?.date ? addDays(last.date, 1) : (store.state.trip.start_date || todayISO());
  const row = store.upsert('days', { date, title: null, sort_order: days.length });
  selDay = row.id;
  redraw();
}

function dayForm(day, days) {
  openForm({
    title: 'Edit day',
    fields: [
      { name: 'title', label: 'Title (optional)', type: 'text', value: day.title || '', placeholder: 'e.g. Old town and sunset' },
      { name: 'date', label: 'Date', type: 'date', value: day.date || '' },
    ],
    onSubmit: ({ title, date }) => { store.upsert('days', { id: day.id, title: title || null, date }); },
    onDelete: () => { store.remove('days', day.id); selDay = null; },
    deleteLabel: 'Delete day',
  });
}

function locationField(a) {
  let pt = a && a.lat != null ? { lat: a.lat, lng: a.lng } : null;
  let picker = null;
  const input = h('input', { type: 'text', placeholder: 'Paste a map link or “lat, lng”…', 'aria-label': 'Paste a map link or coordinates' });
  const status = h('div', { class: 'muted small', role: 'status' });
  const mapBox = h('div', { class: 'map-box small' });
  const show = () => {
    status.textContent = pt ? `Pinned at ${pt.lat}, ${pt.lng}` : 'No location set. Paste a link or coordinates, or tap the map.';
  };
  const apply = () => {
    const v = input.value.trim();
    if (!v) return;
    const p = parseLocation(v);
    if (p) { pt = p; if (picker) picker.set(p.lat, p.lng); input.value = ''; show(); }
    else if (isShortLink(v)) status.textContent = 'Short links can’t be read. Open the link, then copy the full address from the browser bar.';
    else status.textContent = 'Couldn’t find coordinates in that text.';
  };
  input.addEventListener('change', apply);
  input.addEventListener('paste', () => setTimeout(apply, 0));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  show();

  const anyPinned = store.state.activities.find((x) => x.lat != null && x.lng != null);
  const node = h('div', { class: 'stack-sm' },
    input, mapBox,
    h('div', { class: 'form-actions' }, status, h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn sm', onClick: () => { pt = null; if (picker) picker.set(null, null); show(); } }, 'Clear pin')));
  return {
    node,
    get: () => pt,
    destroy: () => { if (picker) picker.destroy(); picker = null; },
    onMount: () => {
      picker = createPicker(mapBox, {
        lat: pt?.lat, lng: pt?.lng,
        fallback: anyPinned ? { lat: anyPinned.lat, lng: anyPinned.lng } : null,
        onPick: (p) => { pt = p; show(); },
      });
    },
  };
}

function activityForm(a, day, days) {
  const cur = store.cur();
  const loc = locationField(a);
  const dayId = a ? a.day_id : day.id;
  openForm({
    title: a ? 'Edit activity' : 'Add activity',
    fields: [
      { name: 'title', label: 'What', type: 'text', value: a?.title || '', required: true, maxlength: 200 },
      { name: 'category', label: 'Category', type: 'select', value: a?.category || 'activity', options: CATEGORIES, half: true },
      { name: 'day_id', label: 'Day', type: 'select', value: dayId, half: true,
        options: days.map((d, i) => ({ value: d.id, label: `Day ${i + 1}${d.date ? ' · ' + fmtDay(d.date, { day: 'numeric', month: 'short' }) : ''}` })) },
      { name: 'start_time', label: 'Start', type: 'time', value: a?.start_time ? fmtTime(a.start_time) : '', half: true },
      { name: 'end_time', label: 'End', type: 'time', value: a?.end_time ? fmtTime(a.end_time) : '', half: true },
      { name: 'cost', label: `Cost (${cur})`, type: 'money', value: a?.cost || 0, currency: cur },
      { name: 'notes', label: 'Notes', type: 'textarea', value: a?.notes || '' },
      { name: 'link', label: 'Link', type: 'url', value: a?.link || '', placeholder: 'https://…' },
      { name: 'loc', label: 'Location', type: 'custom', node: loc.node, get: loc.get, onMount: loc.onMount },
    ],
    onSubmit: (v) => {
      if (v.link && !safeUrl(v.link)) throw new Error('The link must start with http:// or https://');
      const row = {
        title: v.title, category: v.category, day_id: v.day_id,
        start_time: v.start_time, end_time: v.end_time, cost: v.cost || 0,
        notes: v.notes || null, link: v.link || null,
        lat: v.loc ? v.loc.lat : null, lng: v.loc ? v.loc.lng : null,
      };
      if (a) {
        if (v.day_id !== a.day_id) row.sort_order = nextOrder(v.day_id);
        store.upsert('activities', { id: a.id, ...row });
      } else {
        store.upsert('activities', { ...row, sort_order: nextOrder(v.day_id) });
      }
      if (v.day_id !== selDay) selDay = v.day_id;
    },
    onDelete: a ? () => store.remove('activities', a.id) : null,
    onClose: loc.destroy,
  });
}

function nextOrder(dayId) {
  const list = store.state.activities.filter((x) => x.day_id === dayId);
  return list.length ? Math.max(...list.map((x) => x.sort_order || 0)) + 1 : 0;
}
