/* PART 6 - Invoice generation: billing run, list, confirm / cancel / send / print. */
pages.invoices = async el => {
  let status = '', q = '', page = 1;
  const team = isTeam();
  el.innerHTML = head(team ? 'Invoices' : 'My invoices', team ? 'Created from subscriptions - never typed by hand.' : 'Your invoices and what is still due.',
    team ? '<button class="btn" id="confirmall">Confirm all drafts</button> <button class="btn primary" id="run">Run billing now</button>' : '') +
    `<div class="filters"><label>Show${selectHtml('st', [['', 'All'], ['draft', 'Draft'], ['confirmed', 'Confirmed (unpaid)'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['cancelled', 'Cancelled']])}</label>
     <label>Number<input id="q" placeholder="INV-000001"></label><button class="btn" id="go">Filter</button></div><div id="list"></div>`;
  const draw = async () => {
    const res = await api('/invoices' + qs({ status: status === 'overdue' ? '' : status, overdue: status === 'overdue', q, page, page_size: 25 }));
    const list = $('#list', el);
    list.innerHTML = table([{ h: 'Invoice', f: i => `<a data-inv="${i.id}"><b>${esc(i.number)}</b></a>` }, ...(team ? [{ h: 'Customer', f: i => esc(i.customer_name) }] : []),
      { h: 'Subscription', f: i => esc(i.subscription_number) }, { h: 'Issued', f: i => i.issue_date }, { h: 'Due', f: i => i.due_date },
      { h: 'Status', f: i => badge(i.overdue ? 'overdue' : i.status) }, { h: 'Total', cls: 'r', f: i => fmt(i.total) }, { h: 'Balance', cls: 'r', f: i => fmt(i.balance) }], res.items, 'No invoices found') + pager(res);
    onPage(list, p => { page = p; draw(); });
    $$('[data-inv]', list).forEach(a => a.onclick = () => openInvoice(a.dataset.inv, draw));
  };
  $('#go', el).onclick = () => { status = $('#st', el).value; q = $('#q', el).value; page = 1; draw(); };
  if (team) {
    $('#run', el).onclick = async e => {
      e.target.disabled = true;
      try { const r = await api('/billing/run', { method: 'POST', body: {} }); toast(`${r.invoices_created} invoice(s) created from ${r.subscriptions_processed} subscription(s)`); draw(); }
      catch (ex) { toast(ex.message, true); } finally { e.target.disabled = false; }
    };
    $('#confirmall', el).onclick = async () => { const r = await api('/invoices/confirm-drafts', { method: 'POST' }); toast(r.confirmed + ' draft invoice(s) confirmed'); draw(); };
  }
  draw();
};

async function openInvoice(id, after) {
  const i = await api('/invoices/' + id), team = isTeam();
  const acts = [];
  if (team && i.status === 'draft') acts.push('<button class="btn primary" data-a="confirm">Confirm</button>');
  if (team && i.status === 'confirmed') acts.push('<button class="btn primary" data-a="pay">Record payment</button>');
  if (team && ['draft', 'confirmed'].includes(i.status) && !i.payments.length) acts.push('<button class="btn danger" data-a="cancel">Cancel invoice</button>');
  if (team && i.status !== 'cancelled') acts.push('<button class="btn" data-a="send">Send to customer</button>');
  acts.push('<button class="btn" data-a="print">Print</button>');
  const m = modal('Invoice ' + i.number, `
    <div class="two"><div class="kv"><b>Customer</b><span>${esc(i.customer.name)}</span><b>Subscription</b><span>${esc(i.subscription_number)}</span><b>Period</b><span>${i.period_start} &rarr; ${i.period_end}</span></div>
    <div class="kv"><b>Status</b><span>${badge(i.overdue ? 'overdue' : i.status)}</span><b>Issued / due</b><span>${i.issue_date} / ${i.due_date}</span><b>Sent</b><span>${i.sent_at ? i.sent_at.slice(0, 16).replace('T', ' ') : 'not yet'}</span></div></div>
    ${table([{ h: 'Item', f: l => esc(l.description) }, { h: 'Qty', cls: 'r', f: l => l.quantity }, { h: 'Price', cls: 'r', f: l => fmt(l.unit_price) }, { h: 'Discount', cls: 'r', f: l => fmt(l.discount_amount) },
      { h: 'Tax', cls: 'r', f: l => l.tax_rate + '%' }, { h: 'Total', cls: 'r', f: l => fmt(l.line_total) }], i.lines)}
    <p style="text-align:right;line-height:1.8">Subtotal ${fmt(i.subtotal)}<br>Discount -${fmt(i.discount_total)} ${i.discount_note ? `<span class="sub">(${esc(i.discount_note)})</span>` : ''}<br>Tax ${fmt(i.tax_total)}<br><b>Total ${fmt(i.total)}</b><br>Paid ${fmt(i.amount_paid)}</p>
    <h2>Payments</h2>${table([{ h: 'Date', f: p => p.date }, { h: 'Method', f: p => esc(p.method) }, { h: 'Amount', cls: 'r', f: p => fmt(p.amount) }, { h: 'Note', f: p => esc(p.note) }], i.payments, 'No payments recorded')}
    <div class="actions" style="justify-content:flex-start">${acts.join('')}</div>`, { wide: true });
  const reopen = () => { m.close(); openInvoice(id, after); if (after) after(); };
  const act = async (path, label) => { try { await api(`/invoices/${id}/${path}`, { method: 'POST' }); toast(label); reopen(); } catch (e) { toast(e.message, true); } };
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'confirm') act('confirm', 'Invoice confirmed');
    if (a === 'send') act('send', 'Invoice sent');
    if (a === 'cancel' && confirm('Cancel this invoice?')) act('cancel', 'Invoice cancelled');
    if (a === 'pay') recordPayment(i, reopen);
    if (a === 'print') { const html = await api(`/invoices/${id}/print`); const w = window.open('', '_blank'); w.document.write(html); w.document.close(); }
  });
}
