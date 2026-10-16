// Client state for the open trip: optimistic edits, serialized writes, live refresh.

import { api, joinTripChannel, leaveTripChannel, announceChange } from './api.js';
import { toast, safeColor } from './lib/dom.js';

export const TABLES = ['travelers', 'days', 'activities', 'budget_items', 'bookings', 'bills', 'bill_items'];

export const state = {
  tripId: null,
  code: null,
  status: 'idle', // idle | loading | ready | error
  error: null,
  offline: false,
  pending: 0,
  trip: null,
  travelers: [],
  days: [],
  activities: [],
  budget_items: [],
  bookings: [],
  bills: [],
  bill_items: [],
};

// ---------- local storage (per browser) ----------

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function getName() {
  try { return localStorage.getItem('tp_name') || ''; } catch { return ''; }
}
export function setName(name) {
  try { localStorage.setItem('tp_name', name); } catch { /* ignore */ }
}
export function getRecent() {
  return lsGet('tp_trips', []).sort((a, b) => (b.opened || 0) - (a.opened || 0));
}
export function rememberTrip(entry) {
  const list = lsGet('tp_trips', []).filter((t) => t.id !== entry.id);
  const prev = lsGet('tp_trips', []).find((t) => t.id === entry.id) || {};
  list.push({ ...prev, ...entry, opened: Date.now() });
  lsSet('tp_trips', list.slice(-30));
}
export function forgetTrip(id) {
  lsSet('tp_trips', lsGet('tp_trips', []).filter((t) => t.id !== id));
}
export function savedCode(id) {
  const t = lsGet('tp_trips', []).find((x) => x.id === id);
  return t ? t.code : null;
}

// ---------- subscriptions ----------

const listeners = new Set();
let notifyQueued = false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    listeners.forEach((fn) => fn());
  });
}

// ---------- loading ----------

let pollTimer = null;
let refreshAfter = false;
let refreshDebounce = null;
let queue = Promise.resolve();

let lastJson = null; // last server snapshot, to skip redraws when nothing changed
let writeSeq = 0;    // bumps on every local write, to drop snapshots that raced a write

function applySnapshot(snap) {
  state.trip = snap.trip;
  for (const t of TABLES) state[t] = snap[t] || [];
  // colors end up in CSS, so only plain hex values are accepted from the shared database
  state.travelers = state.travelers.map((t) => ({ ...t, color: safeColor(t.color) }));
  lastJson = JSON.stringify(snap);
}

export async function open(tripId, code) {
  if (state.tripId === tripId && state.code === code && state.status !== 'error') return;
  close();
  state.tripId = tripId;
  state.code = code;
  state.status = 'loading';
  state.error = null;
  notify();
  try {
    const snap = await api.snapshot(tripId, code);
    if (state.tripId !== tripId) return;
    applySnapshot(snap);
    state.status = 'ready';
    state.offline = false;
    rememberTrip({ id: tripId, code, name: snap.trip.name, destination: snap.trip.destination });
    joinTripChannel(tripId, scheduleRefresh);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  } catch (e) {
    if (state.tripId !== tripId) return;
    state.status = 'error';
    state.error = e;
  }
  notify();
}

export function close() {
  leaveTripChannel();
  clearInterval(pollTimer);
  clearTimeout(refreshDebounce);
  pollTimer = null;
  state.tripId = null;
  state.code = null;
  state.status = 'idle';
  state.error = null;
  state.trip = null;
  for (const t of TABLES) state[t] = [];
}

function scheduleRefresh() {
  clearTimeout(refreshDebounce);
  refreshDebounce = setTimeout(refresh, 300);
}

export async function refresh() {
  if (state.status !== 'ready') return;
  if (state.pending > 0) { refreshAfter = true; return; }
  const id = state.tripId;
  const seq = writeSeq;
  const wasOffline = state.offline;
  try {
    const snap = await api.snapshot(id, state.code);
    if (state.tripId !== id) return;
    if (state.pending > 0 || seq !== writeSeq) { refreshAfter = true; return; } // raced a local write
    state.offline = false;
    if (JSON.stringify(snap) === lastJson) {
      if (wasOffline) notify();
      return; // nothing changed on the server: don't redraw
    }
    applySnapshot(snap);
  } catch (e) {
    state.offline = true;
  }
  notify();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});

// ---------- writes (optimistic, serialized) ----------

function enqueue(job) {
  state.pending++;
  writeSeq++;
  const run = queue.then(job).catch((err) => {
    toast(err.message || 'Save failed', 'error');
    lastJson = null; // force the resync to redraw, so the failed optimistic edit is rolled back
    refreshAfter = true;
  }).finally(() => {
    state.pending--;
    writeSeq++;
    if (state.pending === 0 && refreshAfter) {
      refreshAfter = false;
      refresh();
    }
  });
  queue = run;
  return run;
}

export function upsert(table, row) {
  const id = row.id || crypto.randomUUID();
  const patch = { ...row, id };
  const list = state[table];
  const i = list.findIndex((r) => r.id === id);
  const local = i >= 0
    ? { ...list[i], ...patch }
    : { ...patch, trip_id: state.tripId };
  if (table === 'activities') { local.updated_by = getName() || 'Guest'; }
  if (i >= 0) list[i] = local; else list.push(local);
  notify();

  const { tripId, code } = state;
  enqueue(async () => {
    const saved = await api.upsert(tripId, code, table, patch, getName() || 'Guest');
    if (state.tripId === tripId && saved) {
      const j = state[table].findIndex((r) => r.id === id);
      if (j >= 0 && saved.updated_at) {
        state[table][j] = { ...state[table][j], updated_at: saved.updated_at, updated_by: saved.updated_by };
      }
    }
    announceChange();
  });
  return local;
}

export function updateTrip(patch) {
  state.trip = { ...state.trip, ...patch };
  notify();
  const { tripId, code } = state;
  return enqueue(async () => {
    await api.updateTrip(tripId, code, patch);
    announceChange();
  });
}

export function remove(table, id) {
  state[table] = state[table].filter((r) => r.id !== id);
  // mirror the database cascades locally
  if (table === 'days') {
    const gone = new Set(state.activities.filter((a) => a.day_id === id).map((a) => a.id));
    state.activities = state.activities.filter((a) => a.day_id !== id);
    state.budget_items.forEach((b) => {
      if (b.day_id === id) b.day_id = null;
      if (gone.has(b.activity_id)) b.activity_id = null;
    });
  }
  if (table === 'activities') state.budget_items.forEach((b) => { if (b.activity_id === id) b.activity_id = null; });
  if (table === 'bills') state.bill_items = state.bill_items.filter((x) => x.bill_id !== id);
  if (table === 'travelers') state.bills.forEach((b) => { if (b.paid_by === id) b.paid_by = null; });
  notify();
  const { tripId, code } = state;
  return enqueue(async () => {
    await api.remove(tripId, code, table, id);
    announceChange();
  });
}

export function reorder(table, ids) {
  ids.forEach((id, i) => {
    const r = state[table].find((x) => x.id === id);
    if (r) r.sort_order = i;
  });
  notify();
  const { tripId, code } = state;
  return enqueue(async () => {
    await api.reorder(tripId, code, table, ids);
    announceChange();
  });
}

// ---------- selectors ----------

export const cur = () => state.trip?.currency || 'USD';
export const activeTravelers = () => state.travelers.filter((t) => !t.archived).sort(bySort);
export const allTravelers = () => [...state.travelers].sort(bySort);
export const traveler = (id) => state.travelers.find((t) => t.id === id);

function bySort(a, b) {
  return (a.sort_order - b.sort_order) || String(a.name).localeCompare(String(b.name));
}

export function sortedDays() {
  return [...state.days].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.sort_order - b.sort_order);
  });
}

export function activitiesForDay(dayId) {
  return state.activities
    .filter((a) => a.day_id === dayId)
    .sort((a, b) => (a.sort_order - b.sort_order) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
}

export function itemsByBill() {
  const map = {};
  for (const it of state.bill_items) (map[it.bill_id] ||= []).push(it);
  return map;
}

export async function exportSnapshot() {
  return api.snapshot(state.tripId, state.code);
}

export function travelerColor(id) {
  return traveler(id)?.color || '#7b8190';
}

export const PALETTE = ['#4f83e0', '#d9822f', '#2f9e6e', '#cf4f86', '#8b6cd9', '#c9a227', '#2aa5b3', '#7b8190'];
