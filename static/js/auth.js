/* PART 1 - Login and registration (+ admin-only staff accounts). */
const PW_HINT = 'More than 8 characters, with an uppercase letter, a lowercase letter and a special character.';

function authCard(el, title, inner) {
  el.innerHTML = `<div class="authwrap"><div class="card auth"><div class="sub" style="margin-bottom:6px">&#9711; Brightloop Software</div><h1>${esc(title)}</h1>${inner}</div></div>`;
}
function bindAuth(el, fields, submit) {
  const form = $('form', el);
  form.addEventListener('submit', async e => {
    e.preventDefault(); const err = $('.err', form); err.hidden = true;
    try { await submit(readForm(form, fields)); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}
const authForm = (fields, btn) => `<form>${fields.map(f => fieldHtml(f)).join('')}<div class="err" hidden></div>
  <button class="btn primary" style="width:100%;margin-top:6px">${esc(btn)}</button></form>`;

pages.login = el => {
  const fields = [{ k: 'email', l: 'Email', t: 'email', req: true }, { k: 'password', l: 'Password', t: 'password', req: true }];
  authCard(el, 'Log in', authForm(fields, 'Log in') + `<p class="sub"><a href="#/forgot">Forgot password?</a> &middot; <a href="#/signup">Create an account</a></p>
    <p class="hint">Demo: admin@brightloop.test / Admin@12345</p>`);
  bindAuth(el, fields, async v => setSession(await api('/auth/login', { method: 'POST', body: v })));
};

pages.signup = el => {
  const fields = [{ k: 'name', l: 'Your name', req: true }, { k: 'company', l: 'Company (optional)' },
    { k: 'email', l: 'Email', t: 'email', req: true }, { k: 'password', l: 'Password', t: 'password', req: true, hint: PW_HINT }];
  authCard(el, 'Create your account', authForm(fields, 'Sign up') + '<p class="sub"><a href="#/login">I already have an account</a></p>');
  bindAuth(el, fields, async v => setSession(await api('/auth/signup', { method: 'POST', body: v })));
};

pages.forgot = el => {
  const fields = [{ k: 'email', l: 'Registered email', t: 'email', req: true }];
  authCard(el, 'Reset your password', authForm(fields, 'Send reset link') + '<p class="sub"><a href="#/login">Back to log in</a></p>');
  bindAuth(el, fields, async v => {
    const r = await api('/auth/forgot', { method: 'POST', body: v });
    authCard(el, 'Check your email', `<p>${esc(r.message)}</p><p class="sub"><a href="#/login">Back to log in</a></p>`);
  });
};

pages.reset = (el, _a, params) => {
  const fields = [{ k: 'new_password', l: 'New password', t: 'password', req: true, hint: PW_HINT }];
  authCard(el, 'Choose a new password', authForm(fields, 'Update password'));
  bindAuth(el, fields, async v => {
    await api('/auth/reset', { method: 'POST', body: { token: params.get('token') || '', new_password: v.new_password } });
    toast('Password updated - please log in'); location.hash = '#/login';
  });
};

pages.staff = async el => {
  if (!isAdmin()) { el.innerHTML = '<div class="err">Only the admin can manage staff.</div>'; return; }
  const users = (await api('/users')).filter(u => u.role !== 'customer');
  el.innerHTML = head('Staff', 'Internal team members. Only the admin can add them.', '<button class="btn primary" id="add">Add staff member</button>') +
    table([{ h: 'Name', f: u => esc(u.name) }, { h: 'Email', f: u => esc(u.email) }, { h: 'Role', f: u => badge(u.role) }, { h: 'Added', f: u => esc((u.created_at || '').slice(0, 10)) }], users);
  $('#add', el).onclick = () => formModal({
    title: 'Add staff member', submit: 'Create account',
    fields: [{ k: 'name', l: 'Name', req: true }, { k: 'email', l: 'Email', t: 'email', req: true }, { k: 'password', l: 'Temporary password', t: 'password', req: true, hint: PW_HINT }],
    onSubmit: async (v, m) => { await api('/users/staff', { method: 'POST', body: v }); m.close(); toast('Staff member added'); route(); },
  });
};
