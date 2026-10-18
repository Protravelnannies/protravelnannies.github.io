/* Shows the booking form (book.html) and the nanny application (apply.html) only to people
   who are logged in. Everyone else sees the [data-form-gate] card asking them to create an
   account or log in; portal.js then brings them back here afterwards (see "ptn-next"). */
(() => {
  const gate = document.querySelector('[data-form-gate]');
  const content = document.querySelector('[data-gate-content]');
  if (!gate || !content) return;

  const wanted = gate.dataset.formGate; // 'family' or 'nanny'
  const open = () => { gate.hidden = true; content.hidden = false; };

  const cfg = window.PTN_PORTAL || {};
  if (!cfg.url || !cfg.publishableKey || !window.supabase) { open(); return; } // accounts down: never lose a request
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);

  const set = (name, value) => {
    const input = content.querySelector(`[name="${name}"]`);
    if (input && value && !input.value) input.value = value;
  };

  (async () => {
    const { data: s } = await db.auth.getSession();
    if (!s.session) return;
    const { data: me } = await db.from('people').select('full_name, email, phone, role').eq('user_id', s.session.user.id).maybeSingle();
    if (!me) return;
    if (me.role !== wanted && me.role !== 'admin') {
      gate.querySelector('h2').textContent = wanted === 'family' ? 'This form is for families' : 'This form is for nannies';
      gate.querySelector('p').textContent = `You're logged in with a ${me.role} account. Please log out and use a ${wanted} account, or email cameron@protravelnannies.com if you need help.`;
      gate.querySelector('.btn-row').replaceChildren(Object.assign(document.createElement('a'), { className: 'btn btn-primary', href: 'account.html', textContent: 'Go to my account' }));
      return;
    }
    const name = (me.full_name || '').trim();
    set('name', name);
    set('first_name', name.split(/\s+/)[0]);
    set('last_name', name.split(/\s+/).slice(1).join(' '));
    set('email', me.email);
    set('phone', me.phone);
    open();
  })();
})();
