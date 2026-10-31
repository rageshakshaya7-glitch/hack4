/* PART 4 - Customer management. */
pages.customers = async (el, _a, params) => {
  if (!isTeam()) { location.hash = '#/subscriptions'; return; }
  let q = params.get('q') || '', page = 1;
  const fields = [{ k: 'name', l: 'Name', req: true }, { k: 'company', l: 'Company' }, { k: 'email', l: 'Email', t: 'email' }, { k: 'phone', l: 'Phone' }, { k: 'address', l: 'Billing address', t: 'textarea' }];
  el.innerHTML = head('Customers', 'Everyone who buys a subscription.', '<button class="btn primary" id="add">New customer</button>') +
    `<div class="filters"><label>Search<input id="q" placeholder="Name, email or company" value="${esc(q)}"></label><button class="btn" id="go">Search</button></div><div id="list"></div>`;
  const draw = async () => {
    const res = await api('/customers' + qs({ q, page, page_size: 25 }));
    const list = $('#list', el);
    list.innerHTML = table([{ h: 'Name', f: c => `<a data-open="${c.id}"><b>${esc(c.name)}</b></a>` }, { h: 'Company', f: c => esc(c.company) },
      { h: 'Email', f: c => esc(c.email) }, { h: 'Phone', f: c => esc(c.phone) },
      { h: '', f: c => `<button class="btn sm" data-edit="${c.id}">Edit</button> <button class="btn sm" data-sub="${c.id}">New subscription</button>` }], res.items, 'No customers match') + pager(res);
    onPage(list, p => { page = p; draw(); });
    $$('[data-edit]', list).forEach(b => b.onclick = () => formModal({ title: 'Edit customer', fields, initial: res.items.find(c => c.id == b.dataset.edit),
      onSubmit: async (v, m) => { await api('/customers/' + b.dataset.edit, { method: 'PUT', body: v }); m.close(); draw(); } }));
    $$('[data-sub]', list).forEach(b => b.onclick = () => openSubscriptionForm(Number(b.dataset.sub)));
    $$('[data-open]', list).forEach(a => a.onclick = () => customerDetail(a.dataset.open));
  };
  $('#go', el).onclick = () => { q = $('#q', el).value; page = 1; draw(); };
  $('#q', el).onkeydown = e => { if (e.key === 'Enter') $('#go', el).click(); };
  $('#add', el).onclick = () => formModal({ title: 'New customer', fields, onSubmit: async (v, m) => { await api('/customers', { method: 'POST', body: v }); m.close(); toast('Customer added'); draw(); } });
  draw();
};

async function customerDetail(id) {
  const c = await api('/customers/' + id);
  const m = modal(c.name, `<div class="kv"><b>Company</b><span>${esc(c.company) || '-'}</span><b>Email</b><span>${esc(c.email) || '-'}</span><b>Phone</b><span>${esc(c.phone) || '-'}</span><b>Address</b><span>${esc(c.address) || '-'}</span></div>
    <h2>Subscriptions</h2>${table([{ h: 'Number', f: s => `<a href="#/subscriptions/${s.id}" data-close>${esc(s.number)}</a>` }, { h: 'Status', f: s => badge(s.status) }, { h: 'Start', f: s => s.start_date }, { h: 'Expiry', f: s => s.expiry_date || '-' }], c.subscriptions, 'No subscriptions yet')}
    <h2>Invoices</h2>${table([{ h: 'Number', f: i => `<a data-inv="${i.id}">${esc(i.number)}</a>` }, { h: 'Status', f: i => badge(i.status) }, { h: 'Due', f: i => i.due_date }, { h: 'Total', cls: 'r', f: i => fmt(i.total) }], c.invoices, 'No invoices yet')}`, { wide: true });
  $$('[data-inv]', m.el).forEach(a => a.onclick = () => { m.close(); openInvoice(a.dataset.inv); });
}
