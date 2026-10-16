// Trip setup: details, travelers, share link, duplicate, export / import.

import { h, icon, openForm, toast, copyText, downloadText, confirmDialog } from '../lib/dom.js';
import { api } from '../api.js';
import * as store from '../store.js';
import { go, tripPath, shareLink } from '../router.js';
import { rangeISO, addDays, parseISO, toISO } from '../lib/dates.js';

export function render(root) {
  const { trip } = store.state;
  root.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Trip')),
    h('div', { class: 'stack' },
      detailsCard(trip),
      travelersCard(),
      shareCard(),
      backupCard()));
}

// ---------- details ----------

function detailsCard(trip) {
  const f = {
    name: h('input', { type: 'text', id: 'tn', value: trip.name, required: true, maxlength: 120 }),
    destination: h('input', { type: 'text', id: 'td', value: trip.destination || '', maxlength: 120 }),
    start: h('input', { type: 'date', id: 'ts', value: trip.start_date || '' }),
    end: h('input', { type: 'date', id: 'te', value: trip.end_date || '' }),
    currency: h('input', { type: 'text', id: 'tc', value: trip.currency, maxlength: 3, required: true }),
  };
  const hint = h('p', { class: 'muted small' }, 'Changing the dates adds any missing days. Existing days are never removed automatically.');
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');

  const form = h('form', {
    class: 'form',
    onInput: () => { form.dataset.dirty = '1'; }, // the app won't redraw over unsaved edits
    onSubmit: async (e) => {
      e.preventDefault();
      delete form.dataset.dirty;
      const start = f.start.value || null;
      const end = f.end.value || null;
      const currency = f.currency.value.trim().toUpperCase();
      if (start && end && end < start) return toast('End date is before the start date.', 'error');
      if (!/^[A-Z]{3}$/.test(currency)) return toast('Use a 3-letter currency code.', 'error');
      if (start && end && rangeISO(start, end, 62).length > 61) return toast('That range is longer than 61 days.', 'error');
      save.disabled = true;
      store.updateTrip({ name: f.name.value.trim(), destination: f.destination.value.trim() || null, start_date: start, end_date: end, currency });
      // add missing days
      if (start && end) {
        const have = new Set(store.state.days.map((d) => d.date));
        let order = store.state.days.length;
        for (const iso of rangeISO(start, end)) {
          if (!have.has(iso)) store.upsert('days', { date: iso, title: null, sort_order: order++ });
        }
      }
      toast('Saved');
      save.disabled = false;
    },
  },
  h('div', { class: 'field' }, h('label', { for: 'tn' }, 'Trip name *'), f.name),
  h('div', { class: 'field' }, h('label', { for: 'td' }, 'Destination'), f.destination),
  h('div', { class: 'row' },
    h('div', { class: 'field' }, h('label', { for: 'ts' }, 'Start date'), f.start),
    h('div', { class: 'field' }, h('label', { for: 'te' }, 'End date'), f.end),
    h('div', { class: 'field' }, h('label', { for: 'tc' }, 'Currency'), f.currency)),
  hint,
  h('div', { class: 'form-actions' }, save));

  return h('section', { class: 'card stack' }, h('h2', null, 'Details'), form);
}

// ---------- travelers ----------

function travelersCard() {
  const all = store.allTravelers();
  const active = all.filter((t) => !t.archived);
  const archived = all.filter((t) => t.archived);
  return h('section', { class: 'card stack' },
    h('div', { class: 'section-head', style: { margin: 0 } },
      h('h2', null, 'Travelers'),
      h('button', { class: 'btn sm', onClick: () => travelerForm() }, icon('plus'), 'Add')),
    active.length
      ? h('div', { class: 'list' }, active.map((t) => h('div', { class: 'transfer' },
        h('span', { class: 'dot-sw', style: { '--swatch': t.color || '#7b8190' } }),
        h('span', null, t.name),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost sm icon-only', title: 'Edit', 'aria-label': `Edit ${t.name}`, onClick: () => travelerForm(t) }, icon('edit')))))
      : h('div', { class: 'empty' }, 'Add the people on this trip. The bill splitter and budget use this list.'),
    archived.length ? h('p', { class: 'muted small' }, `Removed (kept for past bills): ${archived.map((t) => t.name).join(', ')}`) : null);
}

function travelerForm(t) {
  const used = new Set(store.state.travelers.map((x) => x.color));
  const color = t?.color || store.PALETTE.find((c) => !used.has(c)) || store.PALETTE[0];
  openForm({
    title: t ? 'Edit traveler' : 'Add traveler',
    fields: [
      { name: 'name', label: 'Name', type: 'text', value: t?.name || '', required: true, maxlength: 40 },
      { name: 'color', label: 'Color', type: 'color', value: color },
    ],
    onSubmit: ({ name, color: c }) => {
      store.upsert('travelers', t
        ? { id: t.id, name, color: c }
        : { name, color: c, sort_order: store.state.travelers.length, archived: false });
    },
    onDelete: t ? () => removeTraveler(t) : null,
    deleteLabel: 'Remove',
  });
}

function removeTraveler(t) {
  const inBills = store.state.bills.some((b) => b.paid_by === t.id)
    || store.state.bill_items.some((i) => (i.shared_by || []).includes(t.id));
  if (inBills) {
    store.upsert('travelers', { id: t.id, archived: true });
    toast(`${t.name} was removed from the list but kept for past bills.`);
  } else {
    store.remove('travelers', t.id);
  }
}

// ---------- sharing ----------

function shareCard() {
  const link = shareLink(store.state.tripId, store.state.code);
  return h('section', { class: 'card stack' },
    h('h2', null, 'Share'),
    h('p', { class: 'muted small' }, 'Anyone with this link can view and edit the trip. Send it only to people you trust.'),
    h('div', { class: 'field' },
      h('label', { for: 'sl' }, 'Share link'),
      h('input', { id: 'sl', type: 'text', value: link, readonly: true, onFocus: (e) => e.target.select() })),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn primary', onClick: () => copyText(link, 'Link copied') }, icon('copy'), 'Copy link'),
      h('button', { class: 'btn', onClick: duplicateForm }, 'Duplicate as template')));
}

function duplicateForm() {
  const { trip } = store.state;
  openForm({
    title: 'Duplicate as template',
    submitLabel: 'Create copy',
    fields: [
      { name: 'name', label: 'New trip name', type: 'text', value: `${trip.name} (copy)`, required: true },
      { name: 'start', label: 'New start date (days shift to match)', type: 'date', value: trip.start_date || '' },
      { name: 'keep', label: 'Keep planned costs?', type: 'select', value: 'yes', options: [{ value: 'yes', label: 'Yes, keep costs' }, { value: 'no', label: 'No, clear costs' }] },
    ],
    onSubmit: async (v) => {
      const res = await api.duplicate(store.state.tripId, store.state.code, v.name, v.start, v.keep === 'yes');
      store.rememberTrip({ id: res.trip_id, code: res.code, name: v.name, destination: trip.destination });
      store.open(res.trip_id, res.code);
      toast('Copy created. Bookings and bills are not copied.');
      go(tripPath(res.trip_id, 'setup'));
    },
  });
}

// ---------- backup ----------

function backupCard() {
  return h('section', { class: 'card stack' },
    h('h2', null, 'Backup'),
    h('p', { class: 'muted small' }, 'Export the whole trip to a file you keep. Importing a file always creates a new trip; it never overwrites this one.'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', onClick: exportTrip }, icon('download'), 'Export trip (JSON)')));
}

async function exportTrip() {
  try {
    const snap = await store.exportSnapshot();
    const safe = (snap.trip.name || 'trip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'trip';
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`${safe}-${stamp}.json`, JSON.stringify({ ...snap, exported_at: new Date().toISOString() }, null, 2));
  } catch (e) {
    toast(e.message || 'Export failed', 'error');
  }
}
