// Budget: planned vs actual by category and by day.
//   Planned = budget lines (planned) + itinerary activity costs + booking costs
//   Actual  = budget lines (actual): what has really been spent

import { h, icon, openForm } from '../lib/dom.js';
import * as store from '../store.js';
import { fmt } from '../lib/money.js';
import { fmtDay } from '../lib/dates.js';
import { CATEGORIES, catLabel, safeCat, bookingType } from '../lib/cats.js';

export function render(root) {
  const cur = store.cur();
  const s = store.state;

  // ----- totals per category -----
  const rows = Object.fromEntries(CATEGORIES.map((c) => [c.value, { lines: 0, itinerary: 0, bookings: 0, actual: 0 }]));
  for (const b of s.budget_items) {
    const r = rows[safeCat(b.category)];
    r.lines += b.planned || 0;
    r.actual += b.actual || 0;
  }
  for (const a of s.activities) rows[safeCat(a.category)].itinerary += a.cost || 0;
  for (const b of s.bookings) rows[bookingType(b.type).cat].bookings += b.cost || 0;

  const planned = (r) => r.lines + r.itinerary + r.bookings;
  const totalPlanned = Object.values(rows).reduce((t, r) => t + planned(r), 0);
  const totalActual = Object.values(rows).reduce((t, r) => t + r.actual, 0);
  const people = Math.max(1, store.activeTravelers().length);

  // ----- by day -----
  const days = store.sortedDays();
  const dayRows = days.map((d, i) => {
    const pl = s.activities.filter((a) => a.day_id === d.id).reduce((t, a) => t + (a.cost || 0), 0)
      + s.budget_items.filter((b) => b.day_id === d.id).reduce((t, b) => t + (b.planned || 0), 0);
    const ac = s.budget_items.filter((b) => b.day_id === d.id).reduce((t, b) => t + (b.actual || 0), 0);
    return { d, i, pl, ac };
  }).filter((r) => r.pl || r.ac);

  root.append(
    h('div', { class: 'page-head' },
      h('h1', null, 'Budget'),
      h('button', { class: 'btn primary', onClick: () => lineForm() }, icon('plus'), 'Add budget line')),
    h('div', { class: 'stack' },
      h('div', { class: 'stats' },
        stat('Planned', fmt(totalPlanned, cur)),
        stat('Spent', fmt(totalActual, cur)),
        stat(totalPlanned - totalActual >= 0 ? 'Left' : 'Over', fmt(Math.abs(totalPlanned - totalActual), cur), totalPlanned - totalActual < 0 ? 'neg' : ''),
        stat(`Planned per person (${people})`, fmt(Math.round(totalPlanned / people), cur))),
      h('p', { class: 'muted small' }, 'Planned adds up budget lines, itinerary costs and booking costs. Spent counts only the amounts you log on budget lines.'),

      h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'By category')),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Category'), h('th', { class: 'r' }, 'Planned'), h('th', { class: 'r' }, 'Spent'), h('th', { class: 'r' }, 'Left'))),
          h('tbody', null, CATEGORIES.map((c) => {
            const r = rows[c.value];
            const pl = planned(r);
            if (!pl && !r.actual) return null;
            const left = pl - r.actual;
            const parts = [r.lines && `lines ${fmt(r.lines, cur)}`, r.itinerary && `itinerary ${fmt(r.itinerary, cur)}`, r.bookings && `bookings ${fmt(r.bookings, cur)}`].filter(Boolean);
            return h('tr', null,
              h('td', null, h('div', null, c.label), parts.length ? h('div', { class: 'muted small' }, parts.join(' · ')) : null),
              h('td', { class: 'r num' }, fmt(pl, cur)),
              h('td', { class: 'r num' }, fmt(r.actual, cur)),
              h('td', { class: `r num ${left < 0 ? 'neg' : ''}` }, fmt(left, cur)));
          })),
          h('tfoot', null, h('tr', null,
            h('td', null, 'Total'),
            h('td', { class: 'r num' }, fmt(totalPlanned, cur)),
            h('td', { class: 'r num' }, fmt(totalActual, cur)),
            h('td', { class: `r num ${totalPlanned - totalActual < 0 ? 'neg' : ''}` }, fmt(totalPlanned - totalActual, cur))))))),

      dayRows.length ? h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'By day')),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', { class: 'r' }, 'Planned'), h('th', { class: 'r' }, 'Spent'))),
          h('tbody', null, dayRows.map((r) => h('tr', null,
            h('td', null, `Day ${r.i + 1}`, r.d.date ? h('span', { class: 'muted' }, ` · ${fmtDay(r.d.date, { day: 'numeric', month: 'short' })}`) : null),
            h('td', { class: 'r num' }, fmt(r.pl, cur)),
            h('td', { class: 'r num' }, fmt(r.ac, cur)))))))) : null,

      h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Budget lines')),
        s.budget_items.length
          ? h('div', { class: 'list' }, [...s.budget_items].sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label)).map((b) => lineRow(b, days, cur)))
          : h('div', { class: 'empty' }, 'No budget lines yet. Add lines for things not in the itinerary or bookings, or to log what you actually spent.'))));
}

function stat(k, v, cls = '') {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: `v num ${cls}` }, v));
}

function lineRow(b, days, cur) {
  const di = b.day_id ? days.findIndex((d) => d.id === b.day_id) : -1;
  return h('div', { class: `transfer cat-${safeCat(b.category)}` },
    h('span', { class: 'chip' }, h('span', { class: 'dot' }), catLabel(b.category)),
    h('span', null, b.label || '(no label)'),
    di >= 0 ? h('span', { class: 'muted small' }, `Day ${di + 1}`) : null,
    h('span', { class: 'spacer' }),
    h('span', { class: 'muted small num' }, `plan ${fmt(b.planned || 0, cur)}`),
    h('span', { class: 'num', style: { fontWeight: 600 } }, fmt(b.actual || 0, cur)),
    h('button', { class: 'btn ghost sm icon-only', title: 'Edit', 'aria-label': `Edit ${b.label}`, onClick: () => lineForm(b) }, icon('edit')));
}

function lineForm(b) {
  const cur = store.cur();
  const days = store.sortedDays();
  openForm({
    title: b ? 'Edit budget line' : 'Add budget line',
    fields: [
      { name: 'label', label: 'What', type: 'text', value: b?.label || '', required: true, maxlength: 200 },
      { name: 'category', label: 'Category', type: 'select', value: b?.category || 'other', options: CATEGORIES },
      { name: 'planned', label: `Planned (${cur})`, type: 'money', value: b?.planned || 0, currency: cur, half: true },
      { name: 'actual', label: `Spent (${cur})`, type: 'money', value: b?.actual || 0, currency: cur, half: true },
      { name: 'day_id', label: 'Day (optional)', type: 'select', value: b?.day_id || '',
        options: [{ value: '', label: 'Not tied to a day' }, ...days.map((d, i) => ({ value: d.id, label: `Day ${i + 1}${d.date ? ' · ' + fmtDay(d.date, { day: 'numeric', month: 'short' }) : ''}` }))] },
    ],
    onSubmit: (v) => {
      const row = { label: v.label, category: v.category, planned: v.planned || 0, actual: v.actual || 0, day_id: v.day_id };
      store.upsert('budget_items', b ? { id: b.id, ...row } : row);
    },
    onDelete: b ? () => store.remove('budget_items', b.id) : null,
  });
}
