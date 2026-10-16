// Bill splitter. Items are assigned to the people who shared them; tax, tip and fees are
// split in proportion to each person's item subtotal. Balances roll up across all bills.

import { h, icon, iconButton, openForm, toast, confirmDialog } from '../lib/dom.js';
import * as store from '../store.js';
import { fmt, parse as parseMoney, toInput } from '../lib/money.js';
import { fmtDay, todayISO } from '../lib/dates.js';
import { computeBill, balances, settle } from '../lib/split.js';
import { go, tripPath } from '../router.js';

let editing = null;
let pendingFocus = null;

export function unmount() {
  editing = null;
  pendingFocus = null;
}

export function render(root) {
  if (editing && !store.state.bills.some((b) => b.id === editing)) editing = null;
  root.append(editing ? editorView(editing) : listView());
  if (pendingFocus) {
    const el = root.querySelector(`[data-item="${pendingFocus}"]`);
    pendingFocus = null;
    if (el) el.focus();
  }
}

const nameOf = (id) => store.traveler(id)?.name || 'Former traveler';
const swatchOf = (id) => store.traveler(id)?.color || '#7b8190';
const orderIds = () => store.allTravelers().map((t) => t.id);

// ---------- list ----------

function listView() {
  const cur = store.cur();
  const bills = [...store.state.bills].sort((a, b) => String(a.bill_date || '').localeCompare(String(b.bill_date || '')) || a.title.localeCompare(b.title));
  const itemsMap = store.itemsByBill();
  const order = orderIds();
  const { net, owed, paid, noPayer } = balances(bills, itemsMap, order);
  const transfers = settle(net);
  const people = store.allTravelers().filter((t) => !t.archived || owed[t.id] || paid[t.id]);

  return h('div', null,
    h('div', { class: 'page-head' },
      h('h1', null, 'Splitter'),
      h('button', { class: 'btn primary', onClick: newBill }, icon('plus'), 'New bill')),
    h('div', { class: 'stack' },
      store.activeTravelers().length < 2
        ? h('div', { class: 'banner' }, 'Add at least two travelers on the ', h('a', { href: tripPath(store.state.tripId, 'setup') }, 'Trip page'), ' to split bills.')
        : null,
      noPayer.length ? h('div', { class: 'banner' }, `${noPayer.length} bill${noPayer.length > 1 ? 's have' : ' has'} no payer and ${noPayer.length > 1 ? 'are' : 'is'} left out of the balances: ${noPayer.map((b) => b.title).join(', ')}.`) : null,

      h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Balances')),
        people.length && bills.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 't' },
            h('thead', null, h('tr', null, h('th', null, 'Person'), h('th', { class: 'r' }, 'Their share'), h('th', { class: 'r' }, 'Paid'), h('th', { class: 'r' }, 'Balance'))),
            h('tbody', null, people.map((t) => h('tr', null,
              h('td', null, h('span', { class: 'dot-sw', style: { '--swatch': t.color || '#7b8190' } }), t.name),
              h('td', { class: 'r num' }, fmt(owed[t.id], cur)),
              h('td', { class: 'r num' }, fmt(paid[t.id], cur)),
              h('td', { class: `r num ${net[t.id] > 0 ? 'pos' : net[t.id] < 0 ? 'neg' : ''}` }, (net[t.id] > 0 ? '+' : '') + fmt(net[t.id], cur)))))))
          : h('div', { class: 'empty' }, 'Balances appear once you add a bill.')),

      bills.length ? h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Settle up')),
        transfers.length
          ? h('div', { class: 'list' }, transfers.map((t) => h('div', { class: 'transfer' },
            h('span', null, h('span', { class: 'dot-sw', style: { '--swatch': swatchOf(t.from) } }), h('strong', null, nameOf(t.from))),
            h('span', { class: 'muted' }, 'pays'),
            h('span', null, h('span', { class: 'dot-sw', style: { '--swatch': swatchOf(t.to) } }), h('strong', null, nameOf(t.to))),
            h('span', { class: 'amt num' }, fmt(t.amount, cur)))))
          : h('div', { class: 'empty' }, 'Everyone is settled up.')) : null,

      h('div', null,
        h('div', { class: 'section-head' }, h('h2', null, 'Bills')),
        bills.length
          ? h('div', { class: 'list' }, bills.map((b) => billRow(b, itemsMap[b.id] || [], order, cur)))
          : h('div', { class: 'empty' }, 'No bills yet. Add one for a meal, a taxi or anything bought together.'))));
}

function billRow(b, items, order, cur) {
  const c = computeBill(b, items, order);
  return h('button', {
    class: 'trip-link', style: { width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit' },
    onClick: () => { editing = b.id; store.notify(); },
  },
  h('div', { class: 'meta' },
    h('div', null, b.title),
    h('div', { class: 'muted small' }, [b.bill_date ? fmtDay(b.bill_date, { day: 'numeric', month: 'short' }) : null, b.paid_by ? `paid by ${nameOf(b.paid_by)}` : 'no payer', `${items.length} item${items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
  c.complete ? null : h('span', { class: 'chip warn' }, 'Incomplete'),
  h('strong', { class: 'num' }, fmt(c.grandTotal, cur)));
}

function newBill() {
  const people = store.activeTravelers();
  if (!people.length) {
    toast('Add travelers first.', 'error');
    go(tripPath(store.state.tripId, 'setup'));
    return;
  }
  openForm({
    title: 'New bill',
    submitLabel: 'Create and add items',
    fields: [
      { name: 'title', label: 'What was it?', type: 'text', required: true, placeholder: 'e.g. Dinner at Taberna', maxlength: 200 },
      { name: 'bill_date', label: 'Date', type: 'date', value: todayISO(), half: true },
      { name: 'paid_by', label: 'Paid by', type: 'select', value: people[0].id, half: true, options: people.map((t) => ({ value: t.id, label: t.name })) },
    ],
    onSubmit: (v) => {
      const row = store.upsert('bills', { title: v.title, bill_date: v.bill_date, paid_by: v.paid_by, tax: 0, tip: 0, fees: 0 });
      editing = row.id;
    },
  });
}

// ---------- editor ----------

function moneyInput(minor, cur, label, onCommit, extra = {}) {
  const input = h('input', {
    type: 'text', inputmode: 'decimal', value: toInput(minor || 0, cur), placeholder: '0.00', 'aria-label': label, ...extra,
  });
  input.addEventListener('change', () => onCommit(Math.max(0, parseMoney(input.value, cur))));
  return input;
}

function editorView(billId) {
  const cur = store.cur();
  const bill = store.state.bills.find((b) => b.id === billId);
  const items = store.state.bill_items.filter((i) => i.bill_id === billId);
  const people = store.activeTravelers();
  const order = orderIds();
  const c = computeBill(bill, items, order);
  const save =(patch) => store.upsert('bills', { id: bill.id, ...patch });

  const titleInput = h('input', { type: 'text', value: bill.title, 'aria-label': 'Bill title', maxlength: 200 });
  titleInput.addEventListener('change', () => { if (titleInput.value.trim()) save({ title: titleInput.value.trim() }); });
  const dateInput = h('input', { type: 'date', value: bill.bill_date || '', 'aria-label': 'Date' });
  dateInput.addEventListener('change', () => save({ bill_date: dateInput.value || null }));
  const payerOptions = store.allTravelers().filter((t) => !t.archived || t.id === bill.paid_by);
  const payer = h('select', { 'aria-label': 'Paid by', value: bill.paid_by || '' },
    h('option', { value: '' }, 'Choose who paid'),
    payerOptions.map((t) => h('option', { value: t.id }, t.name)));
  payer.addEventListener('change', () => save({ paid_by: payer.value || null }));

  // read the items at click time: a price typed a moment ago may not have been redrawn yet
  const tipPct = (pct) => h('button', {
    type: 'button', class: 'btn sm',
    onClick: () => {
      const total = store.state.bill_items.filter((i) => i.bill_id === bill.id).reduce((s, i) => s + (i.price || 0), 0);
      save({ tip: Math.round((total * pct) / 100) });
    },
  }, `${pct}%`);

  return h('div', null,
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost', onClick: () => { editing = null; store.notify(); } }, icon('back'), 'Bills'),
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'btn danger',
        onClick: async () => {
          if (await confirmDialog(`Delete “${bill.title}” and its items?`)) { editing = null; store.remove('bills', bill.id); }
        },
      }, icon('trash'), 'Delete bill')),
    h('div', { class: 'stack' },
      h('section', { class: 'card stack' },
        h('div', { class: 'field' }, h('label', null, 'Bill'), titleInput),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', null, 'Date'), dateInput),
          h('div', { class: 'field' }, h('label', null, 'Paid by'), payer))),

      h('div', null,
        h('div', { class: 'section-head' },
          h('h2', null, 'Items'),
          h('button', { class: 'btn sm', onClick: () => addItem(bill, items) }, icon('plus'), 'Add item')),
        items.length
          ? h('div', { class: 'list' }, items.map((it) => itemRow(it, people, cur)))
          : h('div', { class: 'empty' }, 'Add each item and tap who shared it. Tap “Everyone” for things split by all.')),

      h('section', { class: 'card stack' },
        h('h2', null, 'Tax, tip and fees'),
        h('p', { class: 'muted small' }, 'Split in proportion to each person’s items.'),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', null, 'Tax'), moneyInput(bill.tax, cur, 'Tax', (v) => save({ tax: v }))),
          h('div', { class: 'field' }, h('label', null, 'Tip'), moneyInput(bill.tip, cur, 'Tip', (v) => save({ tip: v }))),
          h('div', { class: 'field' }, h('label', null, 'Fees / service'), moneyInput(bill.fees, cur, 'Fees', (v) => save({ fees: v })))),
        h('div', { class: 'form-actions' }, h('span', { class: 'muted small' }, 'Tip from items:'), tipPct(10), tipPct(15), tipPct(20))),

      resultCard(bill, c, cur)));
}

function itemRow(it, people, cur) {
  const sel = new Set(it.shared_by || []);
  const nameInput = h('input', { type: 'text', value: it.name || '', placeholder: 'Item', 'aria-label': 'Item name', 'data-item': it.id, maxlength: 200 });
  nameInput.addEventListener('change', () => store.upsert('bill_items', { id: it.id, name: nameInput.value.trim() }));
  const unassigned = !people.some((p) => sel.has(p.id)) && !(it.shared_by || []).some((id) => store.traveler(id));
  const toggle = (id) => {
    const next = sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id];
    store.upsert('bill_items', { id: it.id, shared_by: next });
  };
  const everyone = () => {
    const all = people.every((p) => sel.has(p.id));
    const keep = [...sel].filter((id) => !people.some((p) => p.id === id)); // former travelers stay as-is
    store.upsert('bill_items', { id: it.id, shared_by: all ? keep : [...keep, ...people.map((p) => p.id)] });
  };
  return h('div', { class: `bill-item ${unassigned && it.price ? 'unassigned' : ''}` },
    h('div', { class: 'top' },
      nameInput,
      moneyInput(it.price, cur, 'Price', (v) => store.upsert('bill_items', { id: it.id, price: v })),
      iconButton('trash', 'Remove item', () => store.remove('bill_items', it.id))),
    h('div', { class: 'person-chips', role: 'group', 'aria-label': 'Shared by' },
      people.map((t) => h('button', {
        type: 'button', class: 'pchip', 'aria-pressed': sel.has(t.id) ? 'true' : 'false', style: { '--swatch': t.color || '#7b8190' },
        onClick: () => toggle(t.id),
      }, h('span', { class: 'sw' }), t.name)),
      h('button', { type: 'button', class: 'btn ghost sm', onClick: everyone }, people.every((p) => sel.has(p.id)) ? 'Clear' : 'Everyone')),
    unassigned && it.price ? h('div', { class: 'muted small' }, 'Nobody is assigned yet, so this item is left out of the split.') : null);
}

function addItem(bill, items) {
  const row = store.upsert('bill_items', { bill_id: bill.id, name: '', price: 0, shared_by: [] });
  pendingFocus = row.id;
}

function resultCard(bill, c, cur) {
  const rows = store.allTravelers().filter((t) => !t.archived || c.per[t.id].total > 0);
  const unassignedTotal = c.unassigned.reduce((s, i) => s + (i.price || 0), 0);
  return h('section', { class: 'stack' },
    h('div', { class: 'section-head', style: { marginBottom: 0 } }, h('h2', null, 'Who owes what')),
    h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Person'), h('th', { class: 'r' }, 'Items'), h('th', { class: 'r' }, 'Tax, tip, fees'), h('th', { class: 'r' }, 'Total'))),
      h('tbody', null, rows.map((t) => h('tr', null,
        h('td', null, h('span', { class: 'dot-sw', style: { '--swatch': t.color || '#7b8190' } }), t.name),
        h('td', { class: 'r num' }, fmt(c.per[t.id].subtotal, cur)),
        h('td', { class: 'r num' }, fmt(c.per[t.id].extras, cur)),
        h('td', { class: 'r num', style: { fontWeight: 600 } }, fmt(c.per[t.id].total, cur))))),
      h('tfoot', null, h('tr', null,
        h('td', null, 'Split total'),
        h('td', { class: 'r num' }, fmt(c.assignedTotal, cur)),
        h('td', { class: 'r num' }, fmt(c.extrasAllocated, cur)),
        h('td', { class: 'r num' }, fmt(c.owedTotal, cur)))))),
    c.unassigned.length
      ? h('div', { class: 'banner' }, `${c.unassigned.length} item${c.unassigned.length > 1 ? 's' : ''} (${fmt(unassignedTotal, cur)}) not assigned to anyone yet. Bill total ${fmt(c.grandTotal, cur)}; split so far ${fmt(c.owedTotal, cur)}.`)
      : null,
    !c.unassigned.length && c.extras > 0 && c.extrasAllocated === 0
      ? h('div', { class: 'banner' }, 'Tax, tip and fees can’t be split until at least one item is assigned.')
      : null,
    !bill.paid_by ? h('div', { class: 'banner' }, 'Choose who paid so this bill counts toward the balances.') : null);
}
