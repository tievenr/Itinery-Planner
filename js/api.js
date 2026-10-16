// Supabase access. Every call goes through RPC functions that check the trip code.
// Live sync uses Broadcast: after a write we announce "changed" and other clients refetch.

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let client = null;
let channel = null;
let channelReady = false;

export async function initApi() {
  let cfg;
  try {
    cfg = await import('../config.js');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  const url = cfg.SUPABASE_URL;
  const key = cfg.SUPABASE_ANON_KEY;
  if (!url || !key || /YOUR-/i.test(url) || /YOUR-/i.test(key)) return { ok: false, reason: 'placeholder' };
  try {
    const { createClient } = await import(SUPABASE_JS);
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  } catch {
    return { ok: false, reason: 'library' };
  }
  return { ok: true };
}

function friendly(error) {
  const m = String(error.message || error);
  if (/invalid_code/.test(m) || error.code === '28000') return 'That trip code is not valid.';
  if (/row_limit/.test(m)) return 'This trip has reached its size limit for that item type.';
  if (/too_large/.test(m)) return 'That data is too large.';
  if (/bad_ref/.test(m)) return 'That item refers to something that no longer exists. Refreshing.';
  if (/not_found/.test(m)) return 'That item no longer exists. Refreshing.';
  if (/bad_snapshot/.test(m)) return 'That file is not a valid trip export.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Can’t reach the server. Check your connection (a free Supabase project may be paused).';
  return m;
}

async function rpc(name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const e = new Error(friendly(error));
    e.code = error.code;
    e.invalidCode = /invalid_code/.test(error.message || '') || error.code === '28000';
    throw e;
  }
  return data;
}

export const api = {
  createTrip: (a) => rpc('create_trip', { p_name: a.name, p_destination: a.destination || null, p_start: a.start || null, p_end: a.end || null, p_currency: a.currency || 'USD' }),
  snapshot: (trip, code) => rpc('get_trip_snapshot', { p_trip: trip, p_code: code }),
  updateTrip: (trip, code, row) => rpc('update_trip', { p_trip: trip, p_code: code, p_row: row }),
  upsert: (trip, code, table, row, by) => rpc('upsert_row', { p_trip: trip, p_code: code, p_table: table, p_row: row, p_by: by || null }),
  remove: (trip, code, table, id) => rpc('delete_row', { p_trip: trip, p_code: code, p_table: table, p_id: id }),
  reorder: (trip, code, table, ids) => rpc('reorder', { p_trip: trip, p_code: code, p_table: table, p_ids: ids }),
  duplicate: (trip, code, name, start, keepCosts) => rpc('duplicate_trip', { p_trip: trip, p_code: code, p_name: name, p_start: start || null, p_keep_costs: keepCosts }),
  importTrip: (snapshot) => rpc('import_trip', { p_snapshot: snapshot }),
  ping: () => rpc('ping', {}),
};

export function joinTripChannel(tripId, onChanged) {
  leaveTripChannel();
  channelReady = false;
  channel = client.channel(`trip:${tripId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, () => onChanged());
  channel.subscribe((status) => { channelReady = status === 'SUBSCRIBED'; });
}

export function leaveTripChannel() {
  if (channel) {
    try { client.removeChannel(channel); } catch { /* ignore */ }
    channel = null;
    channelReady = false;
  }
}

export function announceChange() {
  if (channel && channelReady) channel.send({ type: 'broadcast', event: 'changed', payload: {} });
}
