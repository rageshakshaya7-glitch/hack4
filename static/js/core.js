/* Shared UI helpers: api(), modal, forms, tables, router. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const state = { token: localStorage.getItem('bl_token'), me: null, shell: false };
const pages = {};
const isTeam = () => state.me && state.me.role !== 'customer';
const isAdmin = () => state.me && state.me.role === 'admin';

function errText(d) {
  if (Array.isArray(d)) return d.map(e => ((e.loc || []).slice(1).join('.') + ': ' + e.msg)).join('; ');
  return d || 'Something went wrong';
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET', headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (r.headers.get('content-type') || '').includes('json');
  const data = json ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && state.token && !path.startsWith('/auth/')) logout();
    throw new Error(json ? errText(data.detail) : data);
  }
  return data;
}
const qs = o => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}

function modal(title, body, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}"><div class="mhead"><h3>${esc(title)}</h3><button class="icon" data-close>&times;</button></div><div class="mbody"></div></div>`;
  const mb = $('.mbody', wrap);
  if (typeof body === 'string') mb.innerHTML = body; else mb.appendChild(body);
  const close = () => wrap.remove();
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.body.appendChild(wrap);
  return { el: mb, close };
}

/* ---------- forms: fields = [{k,l,t,o,req,n,d,ph,step}] ---------- */
function fieldHtml(f, v) {
  const id = 'f_' + f.k; v = v ?? f.d ?? '';
  if (f.t === 'checkbox') return `<label class="chk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${esc(f.l)}</label>`;
  let input;
  if (f.t === 'select') input = `<select id="${id}">${f.o.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  else if (f.t === 'textarea') input = `<textarea id="${id}" rows="3">${esc(v)}</textarea>`;
  else input = `<input id="${id}" type="${f.t || 'text'}" value="${esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.req ? 'required' : ''} ${f.t === 'password' ? 'autocomplete="new-password"' : ''}>`;
  return `<label class="fld"><span>${esc(f.l)}${f.req ? ' *' : ''}</span>${input}${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ''}</label>`;
}
function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = $('#f_' + f.k, root);
    if (f.t === 'checkbox') { out[f.k] = el.checked; continue; }
    let v = el.value;
    if (v === '') v = (f.t === 'number' || f.t === 'date' || f.n) ? null : '';
    else if (f.t === 'number' || f.n) v = Number(v);
    out[f.k] = v;
  }
  return out;
}
function formModal({ title, fields, initial = {}, submit = 'Save', onSubmit, wide }) {
  const m = modal(title, `<form>${fields.map(f => fieldHtml(f, initial[f.k])).join('')}<div class="err" hidden></div>
    <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">${esc(submit)}</button></div></form>`, { wide });
  const form = $('form', m.el);
  form.addEventListener('submit', async e => {
    e.preventDefault(); const err = $('.err', form); err.hidden = true;
    try { await onSubmit(readForm(form, fields), m); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  return m;
}

/* ---------- tables ---------- */
function table(cols, rows, empty = 'Nothing here yet') {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tw"><table><thead><tr>${cols.map(c => `<th class="${c.cls || ''}">${esc(c.h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td class="${c.cls || ''}">${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const badge = (s, extra = '') => `<span class="badge ${esc(s)} ${extra}">${esc(s)}</span>`;
function pager(res) {
  const pages_ = Math.max(1, Math.ceil(res.total / res.page_size));
  return `<div class="pager"><span>${res.total} total</span><button class="btn sm" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>Prev</button>
    <span>Page ${res.page} / ${pages_}</span><button class="btn sm" data-page="${res.page + 1}" ${res.page >= pages_ ? 'disabled' : ''}>Next</button></div>`;
}
function onPage(root, fn) { $$('[data-page]', root).forEach(b => b.addEventListener('click', () => fn(Number(b.dataset.page)))); }
function head(title, subtitle, actions = '') {
  return `<div class="top"><div><h1>${esc(title)}</h1><div class="sub">${esc(subtitle || '')}</div></div><div>${actions}</div></div>`;
}
const opts = (items, valueKey, labelKey, blank) => (blank ? [['', blank]] : []).concat(items.map(i => [i[valueKey], typeof labelKey === 'function' ? labelKey(i) : i[labelKey]]));
const selectHtml = (id, o, v = '') => `<select id="${id}">${o.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;

/* ---------- router / shell ---------- */
const PUBLIC = ['login', 'signup', 'forgot', 'reset'];
function navItems() {
  const c = state.me.role === 'customer';
  const all = [
    ['dashboard', 'Dashboard', 'admin staff'], ['customers', 'Customers', 'admin staff'],
    ['subscriptions', c ? 'My subscriptions' : 'Subscriptions', 'admin staff customer'],
    ['invoices', c ? 'My invoices' : 'Invoices', 'admin staff customer'], ['payments', 'Payments', 'admin staff'],
    ['products', 'Products', 'admin staff'], ['plans', 'Plans', 'admin staff'], ['templates', 'Quotation templates', 'admin staff'],
    ['taxes', 'Taxes', 'admin staff'], ['discounts', 'Discounts', 'admin staff'], ['reports', 'Reports', 'admin staff'], ['staff', 'Staff', 'admin'],
  ];
  return all.filter(n => n[2].split(' ').includes(state.me.role));
}
function renderShell() {
  $('#app').innerHTML = `<div class="shell"><nav class="side"><div class="logo">&#9711; Brightloop</div><div id="nav"></div>
    <div class="who">${esc(state.me.name || state.me.email)}<br>${esc(state.me.role)}<br><a data-logout>Log out</a></div></nav><main id="view"></main></div>`;
  $('#nav').innerHTML = navItems().map(([id, label]) => `<a href="#/${id}" data-nav="${id}">${esc(label)}</a>`).join('');
  $('[data-logout]').addEventListener('click', logout);
  state.shell = true;
}
async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query] = raw.split('?');
  const [name = '', ...args] = pathPart.split('/').filter(Boolean).length ? pathPart.split('/').filter(Boolean) : [''];
  const params = new URLSearchParams(query || '');
  if (!state.token) {
    state.shell = false;
    return (pages[PUBLIC.includes(name) ? name : 'login'])($('#app'), args, params);
  }
  if (!state.me) { try { state.me = await api('/me'); } catch { return logout(); } }
  if (!state.shell) renderShell();
  const home = isTeam() ? 'dashboard' : 'subscriptions';
  const page = pages[name] && !PUBLIC.includes(name) ? name : home;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === page));
  const view = $('#view');
  view.innerHTML = '<div class="sub">Loading…</div>';
  try { await pages[page](view, args, params); } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function setSession(res) {
  state.token = res.token; state.me = null; state.shell = false;
  localStorage.setItem('bl_token', res.token);
  location.hash = '#/'; route();
}
function logout() {
  state.token = null; state.me = null; state.shell = false;
  localStorage.removeItem('bl_token'); location.hash = '#/login'; route();
}
function boot() { window.addEventListener('hashchange', route); route(); }
