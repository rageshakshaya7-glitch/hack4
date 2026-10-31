/* PART 3 - Product and plan creation: products + variants, plans, taxes, quotation templates. */
const PERIODS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

/* ---------------- products ---------------- */
pages.products = async el => {
  const [products, taxes] = await Promise.all([api('/products'), api('/taxes')]);
  const fields = [
    { k: 'name', l: 'Name', req: true }, { k: 'type', l: 'Type', t: 'select', o: [['service', 'Service'], ['software', 'Software'], ['addon', 'Add-on'], ['physical', 'Physical']] },
    { k: 'sales_price', l: 'Sales price', t: 'number', step: '0.01', req: true }, { k: 'cost_price', l: 'Cost price', t: 'number', step: '0.01' },
    { k: 'tax_id', l: 'Tax', t: 'select', n: true, o: opts(taxes, 'id', t => `${t.name} (${t.rate_percent}%)`, 'No tax') },
    { k: 'notes', l: 'Notes', t: 'textarea' }, { k: 'active', l: 'Active', t: 'checkbox', d: true }];
  el.innerHTML = head('Products', 'What Brightloop sells, with optional variants (e.g. by brand).', isAdmin() ? '<button class="btn primary" id="add">New product</button>' : '') +
    table([{ h: 'Product', f: p => `<b>${esc(p.name)}</b><div class="sub">${esc(p.notes)}</div>` }, { h: 'Type', f: p => esc(p.type) },
      { h: 'Sales', cls: 'r', f: p => fmt(p.sales_price) }, { h: 'Cost', cls: 'r', f: p => fmt(p.cost_price) }, { h: 'Tax', f: p => esc(p.tax_name || '-') },
      { h: 'Variants', f: p => p.variants.length ? p.variants.map(v => `${esc(v.attribute)}: ${esc(v.value)} (+${fmt(v.extra_price)})`).join('<br>') : '-' },
      { h: '', f: p => isAdmin() ? `<button class="btn sm" data-edit="${p.id}">Edit</button> <button class="btn sm" data-var="${p.id}">Add variant</button>` : '' }], products);
  const save = (id) => async (v, m) => { await api(id ? '/products/' + id : '/products', { method: id ? 'PUT' : 'POST', body: v }); m.close(); toast('Saved'); route(); };
  if (isAdmin()) {
    $('#add', el).onclick = () => formModal({ title: 'New product', fields, onSubmit: save() });
    $$('[data-edit]', el).forEach(b => b.onclick = () => formModal({ title: 'Edit product', fields, initial: products.find(p => p.id == b.dataset.edit), onSubmit: save(b.dataset.edit) }));
    $$('[data-var]', el).forEach(b => b.onclick = () => formModal({
      title: 'Add variant', submit: 'Add',
      fields: [{ k: 'attribute', l: 'Attribute', d: 'Brand', req: true }, { k: 'value', l: 'Value', ph: 'e.g. Odoo', req: true }, { k: 'extra_price', l: 'Extra price', t: 'number', step: '0.01', d: 0 }],
      onSubmit: async (v, m) => { await api(`/products/${b.dataset.var}/variants`, { method: 'POST', body: v }); m.close(); route(); },
    }));
  }
};

/* ---------------- plans ---------------- */
pages.plans = async el => {
  const plans = await api('/plans');
  const fields = [
    { k: 'name', l: 'Plan name', req: true }, { k: 'price', l: 'Recurring plan fee (optional)', t: 'number', step: '0.01', d: 0 },
    { k: 'billing_period', l: 'Billing period', t: 'select', o: PERIODS, d: 'monthly' }, { k: 'min_quantity', l: 'Minimum quantity', t: 'number', d: 1 },
    { k: 'start_date', l: 'Available from', t: 'date' }, { k: 'end_date', l: 'Available until', t: 'date' },
    { k: 'auto_close', l: 'Close automatically when it ends', t: 'checkbox' }, { k: 'allow_early_close', l: 'Can be closed early', t: 'checkbox', d: true },
    { k: 'allow_pause', l: 'Can be paused', t: 'checkbox', d: true }, { k: 'allow_renew', l: 'Can be renewed', t: 'checkbox', d: true }];
  const rules = p => [p.auto_close && 'auto-closes', p.allow_early_close && 'early close', p.allow_pause && 'pause', p.allow_renew && 'renew'].filter(Boolean).join(', ') || '-';
  el.innerHTML = head('Plans', 'Price, billing period, minimum quantity, availability dates and what customers may do.', isAdmin() ? '<button class="btn primary" id="add">New plan</button>' : '') +
    table([{ h: 'Plan', f: p => `<b>${esc(p.name)}</b>` }, { h: 'Fee', cls: 'r', f: p => fmt(p.price) }, { h: 'Billing', f: p => esc(p.billing_period) }, { h: 'Min qty', cls: 'r', f: p => p.min_quantity },
      { h: 'Available', f: p => `${p.start_date || 'any'} &rarr; ${p.end_date || 'open'}` }, { h: 'Rules', f: p => esc(rules(p)) }, { h: 'Status', f: p => badge(p.status) },
      { h: '', f: p => isAdmin() ? `<button class="btn sm" data-edit="${p.id}">Edit</button> ${p.status === 'open' ? `<button class="btn sm" data-st="${p.id}:paused">Pause</button> <button class="btn sm danger" data-st="${p.id}:closed">Close</button>` : `<button class="btn sm" data-st="${p.id}:open">Reopen</button>`}` : '' }], plans);
  if (!isAdmin()) return;
  const save = id => async (v, m) => { await api(id ? '/plans/' + id : '/plans', { method: id ? 'PUT' : 'POST', body: v }); m.close(); toast('Saved'); route(); };
  $('#add', el).onclick = () => formModal({ title: 'New plan', fields, onSubmit: save() });
  $$('[data-edit]', el).forEach(b => b.onclick = () => formModal({ title: 'Edit plan', fields, initial: plans.find(p => p.id == b.dataset.edit), onSubmit: save(b.dataset.edit) }));
  $$('[data-st]', el).forEach(b => b.onclick = async () => {
    const [id, status] = b.dataset.st.split(':');
    try { await api(`/plans/${id}/status`, { method: 'POST', body: { status } }); route(); } catch (e) { toast(e.message, true); }
  });
};

/* ---------------- taxes ---------------- */
pages.taxes = async el => {
  const taxes = await api('/taxes');
  const fields = [{ k: 'name', l: 'Tax name', req: true, ph: 'GST 18%' }, { k: 'rate_percent', l: 'Rate %', t: 'number', step: '0.01', req: true }];
  el.innerHTML = head('Taxes', 'Applied automatically to invoice lines from the product or subscription line.', isAdmin() ? '<button class="btn primary" id="add">New tax</button>' : '') +
    table([{ h: 'Name', f: t => esc(t.name) }, { h: 'Rate', cls: 'r', f: t => t.rate_percent + '%' }, { h: '', f: t => isAdmin() ? `<button class="btn sm" data-edit="${t.id}">Edit</button>` : '' }], taxes);
  if (!isAdmin()) return;
  const save = id => async (v, m) => { await api(id ? '/taxes/' + id : '/taxes', { method: id ? 'PUT' : 'POST', body: v }); m.close(); route(); };
  $('#add', el).onclick = () => formModal({ title: 'New tax', fields, onSubmit: save() });
  $$('[data-edit]', el).forEach(b => b.onclick = () => formModal({ title: 'Edit tax', fields, initial: taxes.find(t => t.id == b.dataset.edit), onSubmit: save(b.dataset.edit) }));
};

/* ---------------- quotation templates ---------------- */
pages.templates = async el => {
  const [templates, plans, products] = await Promise.all([api('/templates'), api('/plans'), api('/products')]);
  const pname = id => (plans.find(p => p.id === id) || {}).name, prod = id => products.find(p => p.id === id) || {};
  el.innerHTML = head('Quotation templates', 'Pre-built plan and product lines, valid for a set number of days.', isAdmin() ? '<button class="btn primary" id="add">New template</button>' : '') +
    table([{ h: 'Template', f: t => `<b>${esc(t.name)}</b>` }, { h: 'Plan', f: t => esc(pname(t.plan_id)) }, { h: 'Valid for', f: t => t.validity_days + ' days' },
      { h: 'Lines', f: t => t.lines.map(l => `${l.quantity} &times; ${esc(prod(l.product_id).name)}`).join('<br>') },
      { h: '', f: t => isAdmin() ? `<button class="btn sm danger" data-del="${t.id}">Delete</button>` : '' }], templates);
  if (!isAdmin()) return;
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (confirm('Delete this template?')) { await api('/templates/' + b.dataset.del, { method: 'DELETE' }); route(); } });
  $('#add', el).onclick = () => {
    const m = modal('New quotation template', `<form>
      <label class="fld"><span>Name *</span><input id="tn" required></label>
      <div class="two"><label class="fld"><span>Plan</span>${selectHtml('tp', opts(plans, 'id', 'name'))}</label>
      <label class="fld"><span>Valid for (days)</span><input id="tv" type="number" value="30" min="1"></label></div>
      <b>Product lines</b><div id="lines" style="margin-top:6px"></div><button type="button" class="btn sm" id="addline">+ Add line</button>
      <div class="err" hidden></div><div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Create</button></div></form>`, { wide: true });
    const editor = linesEditor($('#lines', m.el), products);
    editor.add(); $('#addline', m.el).onclick = () => editor.add();
    $('form', m.el).onsubmit = async e => {
      e.preventDefault(); const err = $('.err', m.el); err.hidden = true;
      try {
        await api('/templates', { method: 'POST', body: { name: $('#tn', m.el).value, plan_id: Number($('#tp', m.el).value), validity_days: Number($('#tv', m.el).value), lines: editor.read() } });
        m.close(); toast('Template created'); route();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    };
  };
};

/* ---------------- reusable product-lines editor (templates and subscriptions) ---------------- */
function linesEditor(root, products) {
  const optionsFor = pid => {
    const p = products.find(x => x.id == pid);
    return '<option value="">No variant</option>' + (p ? p.variants.map(v => `<option value="${v.id}">${esc(v.attribute)}: ${esc(v.value)} (+${fmt(v.extra_price)})</option>`).join('') : '');
  };
  const api_ = {
    add(line = {}) {
      const row = document.createElement('div'); row.className = 'lrow';
      row.innerHTML = `<select class="lp">${products.filter(p => p.active !== false).map(p => `<option value="${p.id}">${esc(p.name)} - ${fmt(p.sales_price)}</option>`).join('')}</select>
        <select class="lv"></select><input class="lq" type="number" min="1" value="${line.quantity || 1}"><button type="button" class="icon" title="Remove">&times;</button>`;
      const lp = $('.lp', row), lv = $('.lv', row);
      if (line.product_id) lp.value = line.product_id;
      lv.innerHTML = optionsFor(lp.value); if (line.variant_id) lv.value = line.variant_id;
      lp.onchange = () => { lv.innerHTML = optionsFor(lp.value); };
      $('.icon', row).onclick = () => row.remove();
      root.appendChild(row);
    },
    set(lines) { root.innerHTML = ''; lines.forEach(l => api_.add(l)); },
    read() { return $$('.lrow', root).map(r => ({ product_id: Number($('.lp', r).value), variant_id: $('.lv', r).value ? Number($('.lv', r).value) : null, quantity: Number($('.lq', r).value) || 1 })); },
  };
  return api_;
}
