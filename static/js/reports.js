/* PART 8 - Reports: subscriptions, invoices, payments and overdue, with filters and CSV export. */
pages.reports = async (el, args) => {
  if (!isTeam()) { location.hash = '#/subscriptions'; return; }
  const tab = args[0] || 'subscriptions';
  const tabs = [['subscriptions', 'Active subscriptions'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['overdue', 'Overdue']];
  el.innerHTML = head('Reports', 'Filter, review and export.') + `<div class="tabs">${tabs.map(([k, l]) => `<a href="#/reports/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="body"></div>`;
  const body = $('#body', el);
  let rows = [], cols = [];
  const exportCsv = () => {
    const out = [cols.map(c => c.h).join(',')].concat(rows.map(r => cols.map(c => '"' + String(c.v(r) ?? '').replace(/"/g, '""') + '"').join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv' })); a.download = `brightloop-${tab}.csv`; a.click();
  };
  const show = (res, columns, note) => {
    rows = res.items || res; cols = columns;
    $('#tbl', body).innerHTML = table(columns.map(c => ({ h: c.h, cls: c.cls, f: c.f || (r => esc(c.v(r))) })), rows, 'No rows for these filters') + (res.total ? `<div class="sub" style="margin-top:6px">Showing ${rows.length} of ${res.total}${note || ''}</div>` : '');
  };
  const shell = filters => { body.innerHTML = `<div class="filters">${filters}<button class="btn primary" id="go">Apply</button><button class="btn" id="csv">Export CSV</button></div><div id="tbl"></div>`; $('#csv', body).onclick = exportCsv; };

  if (tab === 'subscriptions') {
    shell(`<label>Status${selectHtml('st', [['active', 'Active'], ['paused', 'Paused'], ['closed', 'Closed'], ['', 'All']])}</label>`);
    const run = async () => show(await api('/subscriptions' + qs({ status: $('#st', body).value, page_size: 200 })), [
      { h: 'Number', v: r => r.number }, { h: 'Customer', v: r => r.customer_name }, { h: 'Plan', v: r => r.plan_name }, { h: 'Status', v: r => r.status },
      { h: 'Start', v: r => r.start_date }, { h: 'Expiry', v: r => r.expiry_date }, { h: 'Per period', cls: 'r', v: r => r.total_per_period, f: r => fmt(r.total_per_period) }]);
    $('#go', body).onclick = run; run();
  } else if (tab === 'invoices') {
    shell(`<label>Status${selectHtml('st', [['', 'All'], ['draft', 'Draft'], ['confirmed', 'Outstanding'], ['paid', 'Paid'], ['cancelled', 'Cancelled']])}</label>`);
    const run = async () => show(await api('/invoices' + qs({ status: $('#st', body).value, page_size: 200 })), [
      { h: 'Invoice', v: r => r.number }, { h: 'Customer', v: r => r.customer_name }, { h: 'Issued', v: r => r.issue_date }, { h: 'Due', v: r => r.due_date }, { h: 'Status', v: r => r.overdue ? 'overdue' : r.status },
      { h: 'Total', cls: 'r', v: r => r.total, f: r => fmt(r.total) }, { h: 'Balance', cls: 'r', v: r => r.balance, f: r => fmt(r.balance) }]);
    $('#go', body).onclick = run; run();
  } else if (tab === 'payments') {
    shell(`<label>Method${selectHtml('m', [['', 'All'], ...METHODS])}</label><label>From<input type="date" id="df"></label><label>To<input type="date" id="dt"></label>`);
    const run = async () => show(await api('/payments' + qs({ method: $('#m', body).value, date_from: $('#df', body).value, date_to: $('#dt', body).value, page_size: 200 })), [
      { h: 'Date', v: r => r.date }, { h: 'Invoice', v: r => r.invoice_number }, { h: 'Customer', v: r => r.customer_name }, { h: 'Method', v: r => r.method },
      { h: 'Amount', cls: 'r', v: r => r.amount, f: r => fmt(r.amount) }, { h: 'Note', v: r => r.note }]);
    $('#go', body).onclick = run; run();
  } else {
    shell('<span class="sub">Oldest first - the list to chase.</span>');
    show(await api('/reports/overdue?limit=500'), [{ h: 'Invoice', v: r => r.number }, { h: 'Customer', v: r => r.customer }, { h: 'Due', v: r => r.due_date },
      { h: 'Days overdue', cls: 'r', v: r => r.days_overdue }, { h: 'Balance', cls: 'r', v: r => r.balance, f: r => fmt(r.balance) }]);
    $('#go', body).style.display = 'none';
  }
};
