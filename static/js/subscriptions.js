/* PART 5 - Subscription creation and lifecycle: Draft -> Quotation -> Confirmed -> Active -> Closed. */
const FLOW = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

pages.subscriptions = async (el, args) => {
  if (args[0]) return subscriptionDetail(el, args[0]);
  let status = '', q = '', page = 1;
  el.innerHTML = head(isTeam() ? 'Subscriptions' : 'My subscriptions', isTeam() ? 'Every subscription and where it stands.' : 'Your subscriptions with Brightloop.',
    isTeam() ? '<button class="btn primary" id="add">New subscription</button>' : '') +
    `<div class="filters"><label>Status${selectHtml('st', [['', 'All'], ...['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'].map(s => [s, s])])}</label>
     <label>Number<input id="q" placeholder="SUB-000001"></label><button class="btn" id="go">Filter</button></div><div id="list"></div>`;
  const draw = async () => {
    const res = await api('/subscriptions' + qs({ status, q, page, page_size: 25 }));
    const list = $('#list', el);
    list.innerHTML = table([{ h: 'Number', f: s => `<a href="#/subscriptions/${s.id}"><b>${esc(s.number)}</b></a>` },
      ...(isTeam() ? [{ h: 'Customer', f: s => esc(s.customer_name) }] : []), { h: 'Plan', f: s => esc(s.plan_name) }, { h: 'Status', f: s => badge(s.status) },
      { h: 'Start', f: s => s.start_date }, { h: 'Expiry', f: s => s.expiry_date || '-' }, { h: 'Per period', cls: 'r', f: s => fmt(s.total_per_period) },
      { h: 'Next invoice', f: s => s.next_invoice_date || '-' }], res.items, 'No subscriptions found') + pager(res);
    onPage(list, p => { page = p; draw(); });
  };
  $('#go', el).onclick = () => { status = $('#st', el).value; q = $('#q', el).value; page = 1; draw(); };
  if (isTeam()) $('#add', el).onclick = () => openSubscriptionForm();
  draw();
};

async function subscriptionDetail(el, id) {
  const [s, invs] = await Promise.all([api('/subscriptions/' + id), api('/invoices' + qs({ subscription_id: id, page_size: 100 }))]);
  const p = s.plan, team = isTeam();
  const acts = [];
  const move = (to, label, cls = '') => acts.push(`<button class="btn ${cls}" data-to="${to}">${label}</button>`);
  if (team) {
    if (s.status === 'draft') move('quotation', 'Send as quotation', 'primary');
    if (s.status === 'quotation') { move('confirmed', 'Confirm', 'primary'); move('draft', 'Back to draft'); }
    if (s.status === 'confirmed') move('active', 'Activate', 'primary');
  }
  if (s.status === 'active' && p.allow_pause) move('paused', 'Pause');
  if (s.status === 'paused') move('active', 'Resume', 'primary');
  if (['active', 'paused'].includes(s.status) && p.allow_early_close) move('closed', 'Close', 'danger');
  if (team && p.allow_renew && ['active', 'paused', 'closed'].includes(s.status)) acts.push('<button class="btn" id="renew">Renew (+1 period)</button>');
  const idx = FLOW.indexOf(s.status === 'paused' ? 'active' : s.status);
  el.innerHTML = head(s.number, `${s.customer_name} - ${s.plan_name} (${s.billing_period})`, `<a href="#/subscriptions" class="btn">&larr; Back</a>`) + `
    <div class="steps">${FLOW.map((f, i) => `<span class="step ${i < idx ? 'done' : i === idx ? 'now' : ''}">${f}</span>`).join('')}${s.status === 'paused' ? '<span class="step now">paused</span>' : ''}</div>
    <div class="card"><div class="kv"><b>Status</b><span>${badge(s.status)}</span><b>Start date</b><span>${s.start_date}</span><b>Expiry date</b><span>${s.expiry_date || 'open-ended'}</span>
      <b>Payment terms</b><span>${s.payment_terms_days} days</span><b>Next invoice</b><span>${s.next_invoice_date || '-'}</span>
      ${s.quotation_valid_until ? `<b>Quotation valid until</b><span>${s.quotation_valid_until}</span>` : ''}${s.notes ? `<b>Notes</b><span>${esc(s.notes)}</span>` : ''}</div>
      <div class="actions" style="justify-content:flex-start">${acts.join('') || '<span class="sub">No actions available</span>'}</div></div>
    <h2>Lines</h2>${table([{ h: 'Product', f: l => esc(l.product_name) + (l.variant_name ? `<div class="sub">${esc(l.variant_name)}</div>` : '') }, { h: 'Qty', cls: 'r', f: l => l.quantity },
      { h: 'Unit price', cls: 'r', f: l => fmt(l.unit_price) }, { h: 'Tax', f: l => esc(l.tax_name || '-') }, { h: 'Amount', cls: 'r', f: l => fmt(l.amount) }], s.lines)}
    <p class="r" style="text-align:right"><b>Per period: ${fmt(s.total_per_period)}</b>${p.price > 0 ? ` <span class="sub">(includes plan fee ${fmt(p.price)})</span>` : ''}</p>
    <h2>Invoices</h2>${table([{ h: 'Invoice', f: i => `<a data-inv="${i.id}">${esc(i.number)}</a>` }, { h: 'Period', f: i => `${i.period_start} &rarr; ${i.period_end}` }, { h: 'Status', f: i => badge(i.overdue ? 'overdue' : i.status) },
      { h: 'Total', cls: 'r', f: i => fmt(i.total) }], invs.items, 'Not invoiced yet')}`;
  $$('[data-to]', el).forEach(b => b.onclick = async () => {
    try { await api(`/subscriptions/${id}/transition`, { method: 'POST', body: { to: b.dataset.to } }); route(); } catch (e) { toast(e.message, true); }
  });
  const rn = $('#renew', el); if (rn) rn.onclick = async () => { try { await api(`/subscriptions/${id}/renew`, { method: 'POST' }); route(); } catch (e) { toast(e.message, true); } };
  $$('[data-inv]', el).forEach(a => a.onclick = () => openInvoice(a.dataset.inv, route));
}

async function openSubscriptionForm(customerId) {
  const [custs, plans, products, templates] = await Promise.all([api('/customers?page_size=500'), api('/plans'), api('/products'), api('/templates')]);
  const openPlans = plans.filter(p => p.status === 'open');
  const today = new Date().toISOString().slice(0, 10);
  const m = modal('New subscription', `<form>
    <label class="fld"><span>Start from a quotation template (optional)</span>${selectHtml('tpl', opts(templates, 'id', 'name', 'Blank - build from scratch'))}</label>
    <div class="two"><label class="fld"><span>Customer *</span>${selectHtml('cu', opts(custs.items, 'id', c => c.name + (c.company ? ' - ' + c.company : '')), customerId || '')}</label>
    <label class="fld"><span>Plan *</span>${selectHtml('pl', opts(openPlans, 'id', p => `${p.name} (${p.billing_period}, min qty ${p.min_quantity})`))}</label></div>
    <div class="two"><label class="fld"><span>Start date *</span><input id="sd" type="date" value="${today}" required></label>
    <label class="fld"><span>Expiry date</span><input id="ed" type="date"></label></div>
    <div class="two"><label class="fld"><span>Payment terms (days)</span><input id="pt" type="number" min="0" value="15"></label>
    <label class="fld"><span>Notes</span><input id="nt"></label></div>
    <b>Product lines</b><div id="lines" style="margin:6px 0"></div><button type="button" class="btn sm" id="addline">+ Add line</button>
    <div class="err" hidden></div><div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create draft</button></div></form>`, { wide: true });
  const editor = linesEditor($('#lines', m.el), products);
  editor.add(); $('#addline', m.el).onclick = () => editor.add();
  $('#tpl', m.el).onchange = e => {
    const t = templates.find(x => x.id == e.target.value);
    if (!t) return;
    $('#pl', m.el).value = t.plan_id; editor.set(t.lines);
  };
  $('form', m.el).onsubmit = async e => {
    e.preventDefault(); const err = $('.err', m.el); err.hidden = true;
    try {
      const sub = await api('/subscriptions', { method: 'POST', body: {
        customer_id: Number($('#cu', m.el).value), plan_id: Number($('#pl', m.el).value), template_id: $('#tpl', m.el).value ? Number($('#tpl', m.el).value) : null,
        start_date: $('#sd', m.el).value, expiry_date: $('#ed', m.el).value || null, payment_terms_days: Number($('#pt', m.el).value) || 0, notes: $('#nt', m.el).value, lines: editor.read() } });
      m.close(); toast('Subscription ' + sub.number + ' created'); location.hash = '#/subscriptions/' + sub.id; route();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  };
}
