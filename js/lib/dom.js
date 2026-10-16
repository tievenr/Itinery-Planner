// Tiny DOM helpers: element builder, icons, toasts, sheets, forms. No innerHTML with user data anywhere.

import { parse as parseMoney, toInput as moneyToInput } from './money.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let deferredValue;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); // custom properties need setProperty
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') deferredValue = v; // set after children (needed for <select>)
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendAll(el, children);
  if (deferredValue !== undefined) el.value = deferredValue;
  return el;
}

function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(el, ...children) {
  clear(el);
  appendAll(el, children);
  return el;
}

// ---------- icons (stroke paths) ----------
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  copy: 'M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1zM5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14h.01',
  ticket: 'M4 8a2 2 0 002-2h12a2 2 0 002 2v8a2 2 0 00-2 2H6a2 2 0 00-2-2z',
  split: 'M12 6v.01M5 12h14M12 18v.01',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  check: 'M5 12l5 5L20 7',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 3a4 4 0 100 8 4 4 0 000-8z',
  sort: 'M3 6h13M3 12h9M3 18h5M17 8v12M13 16l4 4 4-4',
};

export function icon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || '');
  svg.append(p);
  return svg;
}

export function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: `btn ghost icon-only sm ${cls}`, title: label, 'aria-label': label, onClick }, icon(name));
}

// ---------- toast ----------
export function toast(message, kind = 'info', ms = 3200) {
  const root = document.getElementById('toast-root');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  root.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? ms + 2000 : ms);
}

// ---------- sheet / modal ----------
export function openSheet({ title, body, onClose }) {
  const root = document.getElementById('overlay-root');
  const prevFocus = document.activeElement;
  const overlay = h('div', { class: 'overlay' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    onClose?.();
  };
  // Escape closes only the top-most sheet
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === overlay) close(); };
  sheet.append(
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Close', onClick: close }, icon('close'))),
    body,
  );
  overlay.append(sheet);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  root.append(overlay);
  const first = sheet.querySelector('input:not([type=hidden]), select, textarea');
  if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  return { close, sheet };
}

export function confirmDialog(message, { okLabel = 'Delete', title = 'Are you sure?', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const body = h('div', { class: 'stack' },
      h('p', null, message),
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => { finish(true); s.close(); } }, okLabel),
        h('button', { type: 'button', class: 'btn', onClick: () => { finish(false); s.close(); } }, 'Cancel')));
    const s = openSheet({ title, body, onClose: () => finish(false) });
  });
}

// ---------- forms ----------
// fields: [{ name, label, type, value, options, required, placeholder, currency, min, max, step, full, node, get, onMount }]
// types: text, textarea, money, number, date, time, datetime, select, color, url, custom
export function openForm({ title, fields, submitLabel = 'Save', onSubmit, onDelete, deleteLabel = 'Delete', onClose }) {
  const getters = {};
  const mounts = [];
  const errBox = h('div', { class: 'err', role: 'alert', hidden: true });
  const form = h('form', { class: 'form' });

  const buildField = (f) => {
    const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
    let input;
    switch (f.type) {
      case 'textarea':
        input = h('textarea', { id, value: f.value ?? '', placeholder: f.placeholder, required: f.required });
        getters[f.name] = () => input.value.trim();
        break;
      case 'money':
        input = h('input', { id, type: 'text', inputmode: 'decimal', value: moneyToInput(f.value || 0, f.currency), placeholder: f.placeholder || '0.00' });
        getters[f.name] = () => parseMoney(input.value, f.currency);
        break;
      case 'number':
        input = h('input', { id, type: 'number', value: f.value ?? '', min: f.min, max: f.max, step: f.step, required: f.required });
        getters[f.name] = () => (input.value === '' ? null : Number(input.value));
        break;
      case 'date':
      case 'time':
      case 'url':
      case 'color':
        input = h('input', { id, type: f.type, value: f.value ?? '', required: f.required, placeholder: f.placeholder });
        getters[f.name] = () => (input.value === '' ? null : input.value);
        break;
      case 'datetime':
        input = h('input', { id, type: 'datetime-local', value: f.value ?? '', required: f.required });
        getters[f.name] = () => (input.value === '' ? null : input.value);
        break;
      case 'select':
        input = h('select', { id, value: f.value ?? '', required: f.required },
          (f.options || []).map((o) => h('option', { value: o.value }, o.label)));
        getters[f.name] = () => (input.value === '' ? null : input.value);
        break;
      case 'custom':
        getters[f.name] = f.get;
        if (f.onMount) mounts.push(f.onMount);
        return h('div', { class: 'field' }, f.label ? h('div', { class: 'label' }, f.label) : null, f.node);
      default:
        input = h('input', { id, type: 'text', value: f.value ?? '', required: f.required, placeholder: f.placeholder, autocomplete: 'off', maxlength: f.maxlength });
        getters[f.name] = () => input.value.trim();
    }
    return h('div', { class: 'field' }, h('label', { for: id }, f.label + (f.required ? ' *' : '')), input);
  };

  // Pair consecutive non-"full" fields into rows.
  let rowBuf = [];
  const flush = () => {
    if (rowBuf.length) { form.append(h('div', { class: 'row' }, rowBuf)); rowBuf = []; }
  };
  for (const f of fields) {
    const node = buildField(f);
    if (f.half) { rowBuf.push(node); if (rowBuf.length === 2) flush(); }
    else { flush(); form.append(node); }
  }
  flush();

  const submitBtn = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
  const actions = h('div', { class: 'form-actions' }, submitBtn);
  let sheetRef;
  actions.append(h('button', { type: 'button', class: 'btn', onClick: () => sheetRef.close() }, 'Cancel'));
  if (onDelete) {
    actions.append(h('span', { class: 'spacer' }));
    actions.append(h('button', {
      type: 'button', class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('This can’t be undone.'))) return;
        try { await onDelete(); sheetRef.close(); } catch (e) { toast(e.message || 'Failed', 'error'); }
      },
    }, deleteLabel));
  }
  form.append(errBox, actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    const values = {};
    for (const [k, g] of Object.entries(getters)) values[k] = g();
    submitBtn.disabled = true;
    try {
      const res = await onSubmit(values);
      if (res !== false) sheetRef.close();
    } catch (err) {
      errBox.textContent = err.message || 'Something went wrong';
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  sheetRef = openSheet({ title, body: form, onClose });
  mounts.forEach((m) => m());
  return sheetRef;
}

export function copyText(text, okMsg = 'Copied') {
  const done = () => toast(okMsg);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('Copy failed', 'error'); }
  ta.remove();
}

export function downloadText(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = 'application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// Colors come from the shared database; only accept plain hex before putting them in CSS.
export function safeColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#7b8190';
}

// Only allow http(s) links in href attributes.
export function safeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u, location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}
