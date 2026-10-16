// Bill splitting. Pure functions, integer minor units only.
//
// Rules:
//  1. Each item is split equally among the people who shared it (remainder cents go
//     to the earliest people in traveler order, so shares sum exactly to the price).
//  2. Tax + tip + fees are split proportionally to each person's item subtotal.
//  3. Items nobody is assigned to are excluded until assigned.
//  4. The payer is credited with everything the others owe on that bill.

// Distribute `total` across `weights` proportionally, using the largest-remainder method.
// Result always sums to `total` when the sum of weights is > 0; otherwise all zeros.
export function allocate(total, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const W = weights.reduce((a, b) => a + b, 0);
  if (W <= 0 || total === 0) return weights.map(() => 0);

  const T = BigInt(total);
  const BW = BigInt(W);
  const base = weights.map((w) => (T * BigInt(w)) / BW);
  const rem = weights.map((w, i) => T * BigInt(w) - base[i] * BW);
  const left = Number(T - base.reduce((a, b) => a + b, 0n));
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a - b));
  const out = base.map(Number);
  for (let k = 0; k < left; k++) out[order[k]] += 1;
  return out;
}

export function splitEven(total, n) {
  return allocate(total, Array(n).fill(1));
}

// bill: {tax, tip, fees}; items: [{price, shared_by:[ids]}]; order: all traveler ids (stable order)
export function computeBill(bill, items, order) {
  const sub = new Map(order.map((id) => [id, 0]));
  const unassigned = [];
  let itemsTotal = 0;
  let assignedTotal = 0;

  for (const it of items) {
    const price = it.price || 0;
    itemsTotal += price;
    const picked = new Set((it.shared_by || []).filter((id) => sub.has(id)));
    const people = order.filter((id) => picked.has(id));
    if (people.length === 0) {
      if (price !== 0) unassigned.push(it);
      continue;
    }
    const shares = splitEven(price, people.length);
    people.forEach((id, i) => sub.set(id, sub.get(id) + shares[i]));
    assignedTotal += price;
  }

  const extras = (bill.tax || 0) + (bill.tip || 0) + (bill.fees || 0);
  const payers = order.filter((id) => sub.get(id) > 0);
  const extraShare = new Map(order.map((id) => [id, 0]));
  if (extras > 0 && payers.length > 0) {
    const al = allocate(extras, payers.map((id) => sub.get(id)));
    payers.forEach((id, i) => extraShare.set(id, al[i]));
  }

  const per = {};
  let owedTotal = 0;
  for (const id of order) {
    const subtotal = sub.get(id);
    const ex = extraShare.get(id);
    per[id] = { subtotal, extras: ex, total: subtotal + ex };
    owedTotal += subtotal + ex;
  }

  const extrasAllocated = payers.length > 0 ? extras : 0;
  return {
    per,
    itemsTotal,
    assignedTotal,
    extras,
    extrasAllocated,
    grandTotal: itemsTotal + extras,
    owedTotal,
    unassigned,
    complete: unassigned.length === 0 && (extras === 0 || payers.length > 0),
  };
}

// bills: [{id, paid_by, tax, tip, fees}]; itemsByBill: {billId: [items]}; order: traveler ids
// Returns net (positive = is owed money, negative = owes), owed (what each person's share adds up to),
// paid (what each person fronted, counting only assigned amounts) and `noPayer` (bills skipped).
export function balances(bills, itemsByBill, order) {
  const net = Object.fromEntries(order.map((id) => [id, 0]));
  const owed = Object.fromEntries(order.map((id) => [id, 0]));
  const paid = Object.fromEntries(order.map((id) => [id, 0]));
  const noPayer = [];

  for (const b of bills) {
    const c = computeBill(b, itemsByBill[b.id] || [], order);
    if (c.owedTotal === 0) continue;
    if (!b.paid_by || !(b.paid_by in net)) {
      noPayer.push(b);
      continue;
    }
    for (const id of order) {
      owed[id] += c.per[id].total;
      net[id] -= c.per[id].total;
    }
    net[b.paid_by] += c.owedTotal;
    paid[b.paid_by] += c.owedTotal;
  }
  return { net, owed, paid, noPayer };
}

// Greedy settle-up: at most (people - 1) transfers.
export function settle(net) {
  const cr = [];
  const de = [];
  for (const [id, v] of Object.entries(net)) {
    if (v > 0) cr.push({ id, v });
    else if (v < 0) de.push({ id, v: -v });
  }
  const byAmount = (a, b) => b.v - a.v || a.id.localeCompare(b.id);
  cr.sort(byAmount);
  de.sort(byAmount);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < cr.length && j < de.length) {
    const t = Math.min(cr[i].v, de[j].v);
    out.push({ from: de[j].id, to: cr[i].id, amount: t });
    cr[i].v -= t;
    de[j].v -= t;
    if (cr[i].v === 0) i++;
    if (de[j].v === 0) j++;
  }
  return out;
}
