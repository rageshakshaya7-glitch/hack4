/* PART 2 - Admin dashboard: active subscriptions, revenue, outstanding, overdue - with filters. */
pages.dashboard = async (el, _a, params) => {
  if (!isTeam()) { location.hash = '#/subscriptions'; return; }
  const f = { date_from: params.get('date_from') || '', date_to: params.get('date_to') || '', plan_id: params.get('plan_id') || '', customer_id: params.get('customer_id') || '' };
  const [plans, custs] = await Promise.all([api('/plans'), api('/customers?page_size=500')]);
  const [s, overdue] = await Promise.all([api('/reports/summary' + qs(f)), api('/reports/overdue?limit=10')]);
  const max = Math.max(1, ...s.revenue_by_month.map(m => m.amount));
  const statuses = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];
  el.innerHTML = head('Dashboard', `Showing ${s.range.from} to ${s.range.to}`) + `
    <div class="filters card">
      <label>From<input type="date" id="df" value="${f.date_from}"></label>
      <label>To<input type="date" id="dt" value="${f.date_to}"></label>
      <label>Plan${selectHtml('dp', opts(plans, 'id', 'name', 'All plans'), f.plan_id)}</label>
      <label>Customer${selectHtml('dc', opts(custs.items, 'id', 'name', 'All customers'), f.customer_id)}</label>
      <button class="btn primary" id="apply">Apply</button><button class="btn" id="clear">Clear</button>
    </div>
    <div class="grid">
      <div class="card stat"><div class="l">Active subscriptions</div><div class="n">${s.active_subscriptions}</div></div>
      <div class="card stat"><div class="l">Monthly recurring revenue</div><div class="n">${fmt(s.mrr)}</div></div>
      <div class="card stat"><div class="l">Revenue collected</div><div class="n">${fmt(s.revenue_collected)}</div></div>
      <div class="card stat"><div class="l">Invoiced</div><div class="n">${fmt(s.invoiced)}</div></div>
      <div class="card stat"><div class="l">Outstanding (${s.outstanding.count})</div><div class="n">${fmt(s.outstanding.amount)}</div></div>
      <div class="card stat bad"><div class="l">Overdue (${s.overdue.count})</div><div class="n">${fmt(s.overdue.amount)}</div></div>
    </div>
    <div class="two">
      <div class="card"><h3>Subscriptions by status</h3><div style="margin-top:8px">${statuses.map(x => `<div class="bar"><span>${x}</span><b>${s.subscriptions_by_status[x] || 0}</b></div>`).join('')}</div></div>
      <div class="card"><h3>Revenue collected by month</h3><div style="margin-top:8px">${s.revenue_by_month.length ? s.revenue_by_month.map(m => `<div class="bar"><span>${m.month}</span><i style="width:${Math.round(m.amount / max * 70)}%"></i><b>${fmt(m.amount)}</b></div>`).join('') : '<div class="sub">No payments in this range</div>'}</div></div>
    </div>
    <h2>Overdue invoices - chase list</h2>
    ${table([{ h: 'Invoice', f: o => `<a data-inv="${o.id}">${esc(o.number)}</a>` }, { h: 'Customer', f: o => esc(o.customer) }, { h: 'Due', f: o => o.due_date },
      { h: 'Days late', cls: 'r', f: o => `<span class="badge overdue">${o.days_overdue}</span>` }, { h: 'Balance', cls: 'r', f: o => fmt(o.balance) }], overdue, 'No overdue invoices')}`;
  const go = () => { location.hash = '#/dashboard' + qs({ date_from: $('#df').value, date_to: $('#dt').value, plan_id: $('#dp').value, customer_id: $('#dc').value }); };
  $('#apply', el).onclick = go;
  $('#clear', el).onclick = () => { location.hash = '#/dashboard'; };
  $$('[data-inv]', el).forEach(a => a.onclick = () => openInvoice(a.dataset.inv, route));
};
