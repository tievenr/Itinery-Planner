// Home: your trips on this device, create / open / import. Also the "not configured" and "enter code" screens.

import { h, icon, openForm, toast, pickFile, confirmDialog } from '../lib/dom.js';
import { api } from '../api.js';
import * as store from '../store.js';
import { go, tripPath, parseShareLink } from '../router.js';
import { fmtDay } from '../lib/dates.js';

export function render() {
  const recent = store.getRecent();
  return h('div', { class: 'home stack' },
    h('div', null,
      h('h1', null, 'Your trips'),
      h('p', { class: 'muted' }, 'Plan days, track the budget, keep bookings, and split bills. Trips are shared with a link.')),
    h('div', { class: 'form-actions', style: { flexWrap: 'wrap' } },
      h('button', { class: 'btn primary', onClick: newTripForm }, icon('plus'), 'New trip'),
      h('button', { class: 'btn', onClick: openTripForm }, icon('link'), 'Open with link'),
      h('button', { class: 'btn', onClick: importTrip }, icon('upload'), 'Import file')),
    recent.length
      ? h('div', { class: 'list' }, recent.map(tripRow))
      : h('div', { class: 'empty' }, 'No trips on this device yet. Create one, or open a link someone sent you.'));
}

function tripRow(t) {
  return h('div', { class: 'trip-link' },
    h('a', { class: 'meta', href: tripPath(t.id, 'itinerary'), style: { color: 'inherit', textDecoration: 'none' } },
      h('div', null, t.name || 'Untitled trip'),
      h('div', { class: 'muted small' }, [t.destination, t.opened ? 'opened ' + fmtDay(new Date(t.opened).toISOString().slice(0, 10)) : ''].filter(Boolean).join(' · '))),
    h('button', {
      class: 'btn ghost icon-only sm', title: 'Remove from this device', 'aria-label': 'Remove from this device',
      onClick: async () => {
        if (await confirmDialog('Remove this trip from this device? The trip itself is not deleted; you can reopen it with its link.', { okLabel: 'Remove' })) {
          store.forgetTrip(t.id);
          go('#/');
        }
      },
    }, icon('close')));
}

function newTripForm() {
  openForm({
    title: 'New trip',
    submitLabel: 'Create trip',
    fields: [
      { name: 'name', label: 'Trip name', type: 'text', required: true, placeholder: 'e.g. Lisbon long weekend' },
      { name: 'destination', label: 'Destination', type: 'text' },
      { name: 'start', label: 'Start date', type: 'date', half: true },
      { name: 'end', label: 'End date', type: 'date', half: true },
      { name: 'currency', label: 'Currency (3-letter code)', type: 'text', value: 'USD', required: true, maxlength: 3 },
    ],
    onSubmit: async (v) => {
      if (v.start && v.end && v.end < v.start) throw new Error('End date is before the start date.');
      if (v.start && v.end && (new Date(v.end) - new Date(v.start)) / 864e5 > 60) throw new Error('Trips longer than 61 days: leave the dates blank and add days manually.');
      if (!/^[A-Za-z]{3}$/.test(v.currency)) throw new Error('Use a 3-letter currency code such as USD, EUR or JPY.');
      const res = await api.createTrip({ ...v, currency: v.currency.toUpperCase() });
      store.rememberTrip({ id: res.trip_id, code: res.code, name: v.name, destination: v.destination });
      store.open(res.trip_id, res.code); // keep the new code in memory even if browser storage is blocked
      go(tripPath(res.trip_id, 'setup'));
    },
  });
}

function openTripForm() {
  openForm({
    title: 'Open a trip',
    submitLabel: 'Open',
    fields: [{ name: 'link', label: 'Paste the share link', type: 'text', required: true, placeholder: 'https://…/#/t/…?k=…' }],
    onSubmit: ({ link }) => {
      const p = parseShareLink(link);
      if (!p) throw new Error('That doesn’t look like a trip share link.');
      store.rememberTrip({ id: p.tripId, code: p.code });
      go(tripPath(p.tripId, 'itinerary'));
    },
  });
}

async function importTrip() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const snapshot = JSON.parse(await file.text());
    const res = await api.importTrip(snapshot);
    store.rememberTrip({ id: res.trip_id, code: res.code, name: snapshot.trip?.name, destination: snapshot.trip?.destination });
    store.open(res.trip_id, res.code);
    toast('Imported as a new trip');
    go(tripPath(res.trip_id, 'setup'));
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file isn’t valid JSON.' : e.message, 'error');
  }
}

export function renderCodePrompt(tripId, message) {
  const input = h('input', { type: 'text', id: 'code', autocomplete: 'off', required: true, placeholder: 'Edit code' });
  const err = h('div', { class: 'err', hidden: !message }, message || '');
  return h('div', { class: 'home stack' },
    h('h1', null, 'Enter the trip code'),
    h('p', { class: 'muted' }, 'This trip needs its edit code. It’s the part after “?k=” in the share link.'),
    h('form', {
      class: 'form',
      onSubmit: (e) => {
        e.preventDefault();
        const code = input.value.trim();
        if (!code) return;
        store.rememberTrip({ id: tripId, code });
        store.close();
        store.open(tripId, code); // hold the code in memory too, in case browser storage is blocked
        go(tripPath(tripId, 'itinerary'));
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'code' }, 'Code'), input),
    err,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Open trip'),
      h('a', { class: 'btn', href: '#/' }, 'All trips'))));
}

export function renderNotConfigured(reason) {
  const msg = {
    missing: 'config.js was not found. Copy config.example.js to config.js and add your Supabase URL and anon key.',
    placeholder: 'config.js still has placeholder values. Add your Supabase project URL and anon key.',
    library: 'The Supabase library could not be loaded. Check your connection and reload.',
  }[reason] || 'The app could not start.';
  return h('div', { class: 'home stack' },
    h('h1', null, 'Setup needed'),
    h('div', { class: 'banner' }, msg),
    h('p', { class: 'muted' }, 'See README.md for the five-minute setup: create a Supabase project, run supabase/schema.sql and supabase/functions.sql, then fill in config.js.'));
}
