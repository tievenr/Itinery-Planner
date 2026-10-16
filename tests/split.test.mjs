// Run with: node tests/split.test.mjs
import assert from 'node:assert/strict';
import { allocate, splitEven, computeBill, balances, settle } from '../js/lib/split.js';
import { parse, fmt, toInput } from '../js/lib/money.js';
import { parseLocation } from '../js/lib/mapLinks.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + e.stack); process.exitCode = 1; }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('splitEven 100 / 3 sums to 100', () => {
  const s = splitEven(100, 3);
  assert.deepEqual(s, [34, 33, 33]);
  assert.equal(sum(s), 100);
});
test('splitEven 1 / 3', () => assert.deepEqual(splitEven(1, 3), [1, 0, 0]));
test('allocate proportional sums exactly', () => {
  for (let t = 0; t < 500; t++) {
    const total = Math.floor(Math.random() * 100000);
    const w = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, () => Math.floor(Math.random() * 5000));
    const out = allocate(total, w);
    if (sum(w) > 0) assert.equal(sum(out), total);
    else assert.equal(sum(out), 0);
  }
});
test('allocate zero weight gets zero', () => {
  assert.deepEqual(allocate(100, [0, 50, 50]), [0, 50, 50]);
});
test('allocate handles large values (BigInt)', () => {
  const out = allocate(9_000_000_000_000, [1_000_000_000_001, 2_000_000_000_003]);
  assert.equal(sum(out), 9_000_000_000_000);
});

const A = 'a', B = 'b', C = 'c';
const order = [A, B, C];

test('bill: shared item + individual items + proportional tax/tip', () => {
  const items = [
    { price: 3000, shared_by: [A, B, C] },   // shared starter 30.00 -> 10 each
    { price: 2000, shared_by: [A] },         // A's main
    { price: 1000, shared_by: [B] },         // B's main
  ];
  const bill = { tax: 600, tip: 900, fees: 0 };
  const r = computeBill(bill, items, order);
  assert.equal(r.per[A].subtotal, 1000 + 2000);
  assert.equal(r.per[B].subtotal, 1000 + 1000);
  assert.equal(r.per[C].subtotal, 1000);
  // extras 1500 split 3000:2000:1000 -> 750, 500, 250
  assert.equal(r.per[A].extras, 750);
  assert.equal(r.per[B].extras, 500);
  assert.equal(r.per[C].extras, 250);
  assert.equal(r.owedTotal, r.grandTotal);
  assert.equal(r.complete, true);
});

test('bill: owed total always equals grand total when complete', () => {
  for (let t = 0; t < 300; t++) {
    const items = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, () => ({
      price: Math.floor(Math.random() * 5000),
      shared_by: order.filter(() => Math.random() < 0.5).concat(Math.random() < 0.5 ? [A] : []),
    }));
    const bill = { tax: Math.floor(Math.random() * 900), tip: Math.floor(Math.random() * 900), fees: Math.floor(Math.random() * 300) };
    const r = computeBill(bill, items, order);
    if (r.complete) assert.equal(r.owedTotal, r.grandTotal);
    else assert.equal(r.owedTotal, r.assignedTotal + r.extrasAllocated);
  }
});

test('bill: unassigned items are flagged and excluded', () => {
  const r = computeBill({ tax: 0, tip: 0, fees: 0 }, [{ price: 500, shared_by: [] }, { price: 700, shared_by: [A] }], order);
  assert.equal(r.unassigned.length, 1);
  assert.equal(r.owedTotal, 700);
  assert.equal(r.complete, false);
});

test('bill: extras with nothing assigned are not allocated', () => {
  const r = computeBill({ tax: 100, tip: 0, fees: 0 }, [{ price: 500, shared_by: [] }], order);
  assert.equal(r.owedTotal, 0);
  assert.equal(r.complete, false);
});

test('bill: ids not in traveler order are ignored', () => {
  const r = computeBill({}, [{ price: 900, shared_by: ['ghost', A] }], order);
  assert.equal(r.per[A].total, 900);
});

test('balances + settle: nets to zero, transfers <= n-1', () => {
  const bills = [
    { id: 'b1', paid_by: A, tax: 0, tip: 0, fees: 0 },
    { id: 'b2', paid_by: B, tax: 200, tip: 300, fees: 0 },
  ];
  const itemsByBill = {
    b1: [{ price: 6000, shared_by: [A, B, C] }],
    b2: [{ price: 1000, shared_by: [A] }, { price: 3000, shared_by: [B, C] }],
  };
  const r = balances(bills, itemsByBill, order);
  assert.equal(sum(Object.values(r.net)), 0);
  const tx = settle(r.net);
  assert.ok(tx.length <= order.length - 1);
  // applying transfers zeroes everyone
  const left = { ...r.net };
  for (const t of tx) { left[t.from] += t.amount; left[t.to] -= t.amount; }
  assert.deepEqual(Object.values(left).map((v) => v === 0), [true, true, true]);
});

test('balances: bill without payer is reported and skipped', () => {
  const r = balances([{ id: 'x', paid_by: null }], { x: [{ price: 100, shared_by: [A] }] }, order);
  assert.equal(r.noPayer.length, 1);
  assert.equal(sum(Object.values(r.net)), 0);
});

test('money.parse', () => {
  assert.equal(parse('12.5', 'USD'), 1250);
  assert.equal(parse('1,234.50', 'USD'), 123450);
  assert.equal(parse('12,50', 'EUR'), 1250);
  assert.equal(parse('1.234,50', 'EUR'), 123450);
  assert.equal(parse('1,234', 'USD'), 123400);
  assert.equal(parse('1.005', 'USD'), 100500); // 3 digits after a single separator = thousands
  assert.equal(parse('1.0049', 'USD'), 100);   // extra decimals are rounded
  assert.equal(parse('1.0050', 'USD'), 101);
  assert.equal(parse('0.125', 'USD'), 13);     // leading zero: a decimal, not thousands
  assert.equal(parse('.5', 'USD'), 50);
  assert.equal(parse('abc', 'USD'), 0);
  assert.equal(parse('', 'USD'), 0);
  assert.equal(parse('1500', 'JPY'), 1500);
  assert.equal(parse('$ 7', 'USD'), 700);
  assert.equal(toInput(1250, 'USD'), '12.50');
  assert.equal(toInput(0, 'USD'), '');
});

test('money.fmt', () => {
  assert.match(fmt(1250, 'USD'), /12\.50/);
  assert.match(fmt(1500, 'JPY'), /1,?500/);
});

test('mapLinks.parseLocation', () => {
  assert.deepEqual(parseLocation('38.7139, -9.1394'), { lat: 38.7139, lng: -9.1394 });
  assert.deepEqual(parseLocation('https://www.google.com/maps/place/Belem/@38.6916,-9.2160,17z/data=!3m1'), { lat: 38.6916, lng: -9.216 });
  assert.deepEqual(parseLocation('https://www.google.com/maps/place/X/@38.0,-9.0,17z/data=!3d38.6979!4d-9.2062'), { lat: 38.6979, lng: -9.2062 });
  assert.deepEqual(parseLocation('https://maps.google.com/?q=48.8584,2.2945'), { lat: 48.8584, lng: 2.2945 });
  assert.deepEqual(parseLocation('https://maps.apple.com/?ll=35.6586,139.7454&q=Tokyo'), { lat: 35.6586, lng: 139.7454 });
  assert.deepEqual(parseLocation('https://www.openstreetmap.org/?mlat=51.5007&mlon=-0.1246#map=17/51.5007/-0.1246'), { lat: 51.5007, lng: -0.1246 });
  assert.deepEqual(parseLocation('https://www.openstreetmap.org/#map=15/40.7484/-73.9857'), { lat: 40.7484, lng: -73.9857 });
  assert.equal(parseLocation('Eiffel Tower'), null);
  assert.equal(parseLocation('999, 999'), null);
  assert.equal(parseLocation(''), null);
});

console.log(`\n${passed} passed`);
