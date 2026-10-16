// Bookings: flights, stays, reservations with confirmation numbers.

import { h, icon, openForm, copyText, safeUrl } from '../lib/dom.js';
import * as store from '../store.js';
import { fmt } from '../lib/money.js';
import { fmtDateTime, toInputDateTime } from '../lib/dates.js';
import { BOOKING_TYPES, bookingType } from '../lib/cats.js';

export function render(root) {
  const cur = store.cur();
  const list = [...store.state.bookings].sort((a, b) => String(a.start_at || '9999').localeCompare(String(b.start_at || '9999')));

  root.append(
    h('div', { class: 'page-head' },
      h('h1', null, 'Bookings'),
      h('button', { class: 'btn primary', onClick: () => bookingForm() }, icon('plus'), 'Add booking')),
    list.length
      ? h('div', { class: 'stack' }, groupByType(list).map(([type, items]) => h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, bookingType(type).label)),
        h('div', { class: 'list' }, items.map((b) => card(b, cur))))))
      : h('div', { class: 'empty' }, 'No bookings yet. Add flights, stays and reservations with their confirmation numbers.'));
}

function groupByType(list) {
  const order = BOOKING_TYPES.map((t) => t.value);
  const map = new Map();
  for (const b of list) {
    const t = order.includes(b.type) ? b.type : 'other';
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(b);
  }
  return order.filter((t) => map.has(t)).map((t) => [t, map.get(t)]);
}

function card(b, cur) {
  const t = bookingType(b.type);
  const url = safeUrl(b.link);
  const when = [b.start_at ? fmtDateTime(b.start_at) : null, b.end_at ? fmtDateTime(b.end_at) : null].filter(Boolean).join(' → ');
  return h('article', { class: `booking cat-${t.cat}` },
    h('div', null,
      h('div', { class: 'title' }, b.title),
      h('div', { class: 'meta' },
        b.provider ? h('span', null, b.provider) : null,
        when ? h('span', null, when) : null,
        b.cost ? h('span', { class: 'num' }, fmt(b.cost, b.currency || cur)) : null,
        url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Link') : null),
      b.confirmation_no ? h('div', { class: 'meta' },
        h('span', null, 'Confirmation'),
        h('button', { class: 'confirm', title: 'Copy', onClick: () => copyText(b.confirmation_no, 'Confirmation number copied') }, b.confirmation_no)) : null,
      b.notes ? h('div', { class: 'notes small', style: { marginTop: '6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, b.notes) : null),
    h('div', null, h('button', { class: 'btn ghost sm icon-only', title: 'Edit', 'aria-label': `Edit ${b.title}`, onClick: () => bookingForm(b) }, icon('edit'))));
}

function bookingForm(b) {
  const cur = store.cur();
  openForm({
    title: b ? 'Edit booking' : 'Add booking',
    fields: [
      { name: 'title', label: 'Title', type: 'text', value: b?.title || '', required: true, placeholder: 'e.g. LIS → OPO, Hotel Avenida', maxlength: 200 },
      { name: 'type', label: 'Type', type: 'select', value: b?.type || 'flight', options: BOOKING_TYPES, half: true },
      { name: 'provider', label: 'Provider', type: 'text', value: b?.provider || '', half: true, maxlength: 200 },
      { name: 'start_at', label: 'Starts', type: 'datetime', value: toInputDateTime(b?.start_at), half: true },
      { name: 'end_at', label: 'Ends', type: 'datetime', value: toInputDateTime(b?.end_at), half: true },
      { name: 'confirmation_no', label: 'Confirmation number', type: 'text', value: b?.confirmation_no || '', maxlength: 100 },
      { name: 'cost', label: `Cost (${cur})`, type: 'money', value: b?.cost || 0, currency: cur },
      { name: 'link', label: 'Link', type: 'url', value: b?.link || '', placeholder: 'https://…' },
      { name: 'notes', label: 'Notes', type: 'textarea', value: b?.notes || '' },
    ],
    onSubmit: (v) => {
      if (v.link && !safeUrl(v.link)) throw new Error('The link must start with http:// or https://');
      if (v.start_at && v.end_at && v.end_at < v.start_at) throw new Error('The end is before the start.');
      const row = {
        title: v.title, type: v.type, provider: v.provider || null,
        start_at: v.start_at, end_at: v.end_at,
        confirmation_no: v.confirmation_no || null, cost: v.cost || 0,
        link: v.link || null, notes: v.notes || null,
      };
      store.upsert('bookings', b ? { id: b.id, ...row } : row);
    },
    onDelete: b ? () => store.remove('bookings', b.id) : null,
  });
}
