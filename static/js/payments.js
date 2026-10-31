/* PART 7 - Payment and discount management. */
const METHODS = [['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['other', 'Other']];

function recordPayment(invoice, done) {
  formModal({
    title: `Record payment - ${invoice.number}`, submit: 'Record payment',
    fields: [{ k: 'method', l: 'Method', t: 'select', o: METHODS }, { k: 'amount', l: `Amount (outstanding ${fmt(invoice.balance)})`, t: 'number', step: '0.01', d: invoice.balance, req: true },
      { k: 'date', l: 'Date received', t: 'date', d: new Date().toISOString().slice(0, 10) }, { k: 'note', l: 'Note (reference, cheque no. ...)' }],
    onSubmit: async (v, m) => { await api(`/invoices/${invoice.id}/payments`, { method: 'POST', body: v }); m.close(); toast('Payment recorded'); done(); },
  });
}

pages.payments = async el => {
  let f = { method: '', date_from: '', date_to: '' }, page = 1;
  el.innerHTML = head('Payments', 'Every payment received, against the invoice it settled.') +
    `<div class="filters"><label>Method${selectHtml('m', [['', 'All'], ...METHODS])}</label><label>From<input type="date" id="df"></label><label>To<input type="date" id="dt"></label>
     <button class="btn" id="go">Filter</button></div><div id="list"></div>`;
  const draw = async () => {
    const res = await api('/payments' + qs({ ...f, page, page_size: 25 }));
    const list = $('#list', el);
    list.innerHTML = table([{ h: 'Date', f: p => p.date }, { h: 'Invoice', f: p => `<a data-inv="${p.invoice_id}">${esc(p.invoice_number)}</a>` }, { h: 'Customer', f: p => esc(p.customer_name) },
      { h: 'Method', f: p => esc(p.method) }, { h: 'Amount', cls: 'r', f: p => fmt(p.amount) }, { h: 'Note', f: p => esc(p.note) }], res.items, 'No payments found') + pager(res);
    onPage(list, p => { page = p; draw(); });
    $$('[data-inv]', list).forEach(a => a.onclick = () => openInvoice(a.dataset.inv, draw));
  };
  $('#go', el).onclick = () => { f = { method: $('#m', el).value, date_from: $('#df', el).value, date_to: $('#dt', el).value }; page = 1; draw(); };
  draw();
};

pages.discounts = async el => {
  const [discounts, products, subs] = await Promise.all([api('/discounts'), api('/products'), api('/subscriptions?page_size=200')]);
  const fields = [
    { k: 'name', l: 'Name', req: true, ph: 'Volume discount' }, { k: 'kind', l: 'Type', t: 'select', o: [['percent', 'Percentage'], ['fixed', 'Fixed amount']] },
    { k: 'value', l: 'Value (% or amount)', t: 'number', step: '0.01', req: true },
    { k: 'applies_to', l: 'Applies to', t: 'select', o: [['subscription', 'Whole subscription'], ['product', 'A specific product']] },
    { k: 'product_id', l: 'Product (when applying to a product)', t: 'select', n: true, o: opts(products, 'id', 'name', '-') },
    { k: 'subscription_id', l: 'Only this subscription (optional)', t: 'select', n: true, o: opts(subs.items, 'id', s => `${s.number} - ${s.customer_name}`, 'Any subscription') },
    { k: 'min_purchase', l: 'Minimum purchase', t: 'number', step: '0.01', d: 0 }, { k: 'min_quantity', l: 'Minimum quantity', t: 'number', d: 0 },
    { k: 'start_date', l: 'Start date', t: 'date' }, { k: 'end_date', l: 'End date', t: 'date' },
    { k: 'usage_limit', l: 'Usage limit (invoices it may apply to)', t: 'number', ph: 'Unlimited' }, { k: 'active', l: 'Active', t: 'checkbox', d: true }];
  const pname = id => (products.find(p => p.id === id) || {}).name;
  el.innerHTML = head('Discounts', 'Applied automatically to the next invoice, and stopped when expired or used up.', isAdmin() ? '<button class="btn primary" id="add">New discount</button>' : '') +
    table([{ h: 'Name', f: d => `<b>${esc(d.name)}</b>` }, { h: 'Value', f: d => d.kind === 'percent' ? d.value + '%' : fmt(d.value) },
      { h: 'Applies to', f: d => d.applies_to === 'product' ? 'Product: ' + esc(pname(d.product_id)) : 'Subscription' + (d.subscription_id ? ' #' + d.subscription_id : '') },
      { h: 'Minimums', f: d => `${d.min_purchase ? 'spend ' + fmt(d.min_purchase) : ''} ${d.min_quantity ? 'qty ' + d.min_quantity : ''}`.trim() || '-' },
      { h: 'Valid', f: d => `${d.start_date || 'now'} &rarr; ${d.end_date || 'no end'}` }, { h: 'Used', f: d => `${d.times_used}${d.usage_limit ? ' / ' + d.usage_limit : ''}` },
      { h: 'State', f: d => badge(d.state) }, { h: '', f: d => isAdmin() ? `<button class="btn sm" data-edit="${d.id}">Edit</button> ${d.active ? `<button class="btn sm danger" data-off="${d.id}">Disable</button>` : ''}` : '' }], discounts);
  if (!isAdmin()) return;
  const save = id => async (v, m) => { await api(id ? '/discounts/' + id : '/discounts', { method: id ? 'PUT' : 'POST', body: v }); m.close(); toast('Saved'); route(); };
  $('#add', el).onclick = () => formModal({ title: 'New discount', fields, onSubmit: save(), wide: true });
  $$('[data-edit]', el).forEach(b => b.onclick = () => formModal({ title: 'Edit discount', fields, initial: discounts.find(d => d.id == b.dataset.edit), onSubmit: save(b.dataset.edit), wide: true }));
  $$('[data-off]', el).forEach(b => b.onclick = async () => { await api('/discounts/' + b.dataset.off, { method: 'DELETE' }); route(); });
};
