// App entry: boot, routing, shell (top bar + navigation), and re-rendering on store changes.

import { h, mount, icon, openForm, toast } from './lib/dom.js';
import * as store from './store.js';
import { initApi } from './api.js';
import { currentTheme, toggleTheme } from './theme.js';
import { parseHash, tripPath, PAGE_KEYS } from './router.js';
import * as home from './pages/home.js';
import * as setup from './pages/setup.js';
import * as itinerary from './pages/itinerary.js';
import * as budget from './pages/budget.js';
import * as bookings from './pages/bookings.js';
import * as splitter from './pages/splitter.js';

const appEl = document.getElementById('app');

const PAGES = {
  itinerary: { label: 'Itinerary', icon: 'list', mod: itinerary },
  budget: { label: 'Budget', icon: 'wallet', mod: budget },
  bookings: { label: 'Bookings', icon: 'ticket', mod: bookings },
  splitter: { label: 'Splitter', icon: 'split', mod: splitter },
  setup: { label: 'Trip', icon: 'sliders', mod: setup },
};

let apiStatus = null;
let current = null;      // { kind: 'home' | 'trip' | 'code', tripId, page, message }
let mountedPage = null;  // page module currently rendered
let namePrompted = false;
let drawQueued = false;
let deferred = false;

// ---------- shell ----------

function topbar(tripName) {
  const dark = currentTheme() === 'dark';
  return h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/' }, 'Trip Planner'),
    tripName ? h('span', { class: 'trip-name' }, tripName) : null,
    h('span', { class: 'spacer' }),
    store.state.offline ? h('span', { class: 'chip warn', title: 'Showing the last data we loaded' }, 'Offline') : null,
    store.state.pending > 0 ? h('span', { class: 'muted small' }, 'Saving…') : null,
    tripName ? h('button', {
      class: 'btn ghost sm', title: 'Your display name', onClick: promptName,
    }, icon('user'), store.getName() || 'Set name') : null,
    h('button', {
      class: 'btn ghost icon-only', title: dark ? 'Switch to light mode' : 'Switch to dark mode',
      'aria-label': 'Toggle dark mode', onClick: () => { toggleTheme(); draw(); },
    }, icon(dark ? 'sun' : 'moon')));
}

function nav(tripId, active) {
  return h('nav', { class: 'nav', 'aria-label': 'Trip sections' },
    PAGE_KEYS.map((k) => h('a', {
      href: tripPath(tripId, k),
      'aria-current': k === active ? 'page' : null,
    }, icon(PAGES[k].icon), PAGES[k].label)));
}

function frame(content, tripName) {
  mount(appEl, h('div', { class: 'app' }, topbar(tripName), content));
}

function promptName(force = true) {
  openForm({
    title: 'Your name',
    submitLabel: 'Save',
    fields: [{ name: 'name', label: 'Display name (shown on edits and as the default payer)', type: 'text', value: store.getName(), required: true, maxlength: 40 }],
    onSubmit: ({ name }) => { store.setName(name); draw(); },
  });
}

// ---------- drawing ----------

function unmountPage() {
  if (mountedPage && mountedPage.unmount) mountedPage.unmount();
  mountedPage = null;
}

function draw() {
  if (apiStatus && !apiStatus.ok) {
    unmountPage();
    frame(home.renderNotConfigured(apiStatus.reason));
    return;
  }
  if (!current) return;

  if (current.kind === 'home') {
    unmountPage();
    frame(home.render());
    return;
  }
  if (current.kind === 'code') {
    unmountPage();
    frame(home.renderCodePrompt(current.tripId, current.message));
    return;
  }

  // trip
  const s = store.state;
  if (s.status === 'loading' || s.status === 'idle') {
    unmountPage();
    frame(h('div', { class: 'loading' }, 'Loading trip…'));
    return;
  }
  if (s.status === 'error') {
    unmountPage();
    if (s.error && s.error.invalidCode) {
      current = { kind: 'code', tripId: current.tripId, message: 'That code did not work. Check the share link or enter the code again.' };
      draw();
      return;
    }
    frame(h('div', { class: 'home stack' },
      h('h1', null, 'Couldn’t load this trip'),
      h('p', { class: 'muted' }, s.error?.message || 'Unknown error'),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn primary', onClick: () => { store.close(); route(); } }, 'Try again'),
        h('a', { class: 'btn', href: '#/' }, 'All trips'))), 'Trip');
    return;
  }

  const page = PAGES[current.page];
  const root = h('main', { class: 'page', id: 'page' });
  if (mountedPage && mountedPage !== page.mod && mountedPage.unmount) mountedPage.unmount();
  mountedPage = page.mod;
  frame(h('div', { class: 'shell' }, nav(current.tripId, current.page), root), s.trip?.name || 'Trip');
  try {
    page.mod.render(root);
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'banner danger' }, 'Something went wrong showing this page: ' + e.message));
  }

  if (!namePrompted && !store.getName()) {
    namePrompted = true;
    promptName();
  }
}

// Redraw on store changes, but never while someone is typing in a page field.
let pointerDown = false;

function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const a = document.activeElement;
    const typing = a && a.closest && a.closest('#page') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox';
    // Don't replace the DOM mid-click (a blur-triggered save can land between mousedown and click),
    // and don't wipe a form with unsaved edits.
    const dirty = document.querySelector('#page form[data-dirty]');
    if (typing || pointerDown || dirty) { deferred = true; return; }
    draw();
  });
}

function flushDeferred(delay) {
  if (!deferred) return;
  setTimeout(() => { if (pointerDown) return; deferred = false; scheduleDraw(); }, delay);
}

document.addEventListener('focusout', () => flushDeferred(0));
let pointerTimer = null;
const releasePointer = (delay) => {
  pointerDown = false;
  clearTimeout(pointerTimer);
  flushDeferred(delay);
};
document.addEventListener('pointerdown', () => {
  pointerDown = true;
  clearTimeout(pointerTimer);
  pointerTimer = setTimeout(() => releasePointer(0), 5000); // safety: a pointerup can get lost
}, true);
['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, () => releasePointer(60), true));
window.addEventListener('blur', () => releasePointer(0));

// ---------- routing ----------

async function route() {
  if (!apiStatus) return;
  if (!apiStatus.ok) { draw(); return; }
  const { parts, params } = parseHash();

  if (parts[0] !== 't' || !parts[1]) {
    store.close();
    current = { kind: 'home' };
    draw();
    return;
  }

  const tripId = parts[1];
  const page = PAGES[parts[2]] ? parts[2] : 'itinerary';
  const urlCode = params.get('k');
  if (urlCode) {
    store.rememberTrip({ id: tripId, code: urlCode });
    history.replaceState(null, '', tripPath(tripId, page)); // keep the code out of the address bar and history
  }
  // saved code first; fall back to the one already loaded (covers browsers with blocked storage)
  const code = urlCode || store.savedCode(tripId) || (store.state.tripId === tripId ? store.state.code : null);
  if (!code) {
    store.close();
    current = { kind: 'code', tripId };
    draw();
    return;
  }

  current = { kind: 'trip', tripId, page };
  if (store.state.tripId !== tripId || store.state.code !== code) {
    store.open(tripId, code); // notifies on completion
    draw();
  } else {
    draw();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
store.subscribe(scheduleDraw);

// ---------- boot ----------

(async function boot() {
  mount(appEl, h('div', { class: 'loading' }, 'Loading…'));
  apiStatus = await initApi();
  route();
})();
