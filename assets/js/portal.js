/* Pro Travel Nannies account portal (login.html + account.html), backed by Supabase.
   What each person may see is enforced by the database rules in supabase/schema.sql;
   this file only decides how to show it. */
(() => {
  const loginRoot = document.querySelector('[data-portal-login]');
  const accountRoot = document.querySelector('[data-portal-account]');
  if (!loginRoot && !accountRoot) return;

  const root = loginRoot || accountRoot;
  const msgEl = root.querySelector('[data-msg]');
  const say = (text, kind = '') => { msgEl.textContent = text || ''; msgEl.className = 'portal-msg ' + kind; };

  const cfg = window.PTN_PORTAL || {};
  if (!cfg.url || !cfg.publishableKey || !window.supabase) {
    root.querySelectorAll('form').forEach(f => { f.hidden = true; });
    say('Accounts are not open yet. Please check back soon.', 'error');
    return;
  }
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey);
  const BUCKET = 'profiles';
  const MIN_PASSWORD = 10;

  // ---------- Small helpers ----------

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }
  const safeUrl = u => (/^https:\/\//i.test((u || '').trim()) ? u.trim() : null);
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = isoDate(new Date());
  const thisMonth = today.slice(0, 7);
  const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtShort = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const fmtStamp = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTime = t => (t ? t.slice(0, 5) : '');
  const euro = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' });
  const money = n => (n == null || n === '' ? '' : euro.format(Number(n)));
  const num = v => (v === '' || v == null ? null : Number(v));
  const blank = v => { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; };
  const dateRange = b => (b.end_date && b.end_date !== b.booking_date ? `${fmtDate(b.booking_date)} to ${fmtDate(b.end_date)}` : fmtDate(b.booking_date));
  const timeRange = b => [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' to ');
  const firstName = n => (n || '').trim().split(/\s+/)[0];
  const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
  function ageOf(dob) {
    if (!dob) return '';
    const b = new Date(dob + 'T00:00:00'), now = new Date();
    let months = (now.getFullYear() - b.getFullYear()) * 12 + now.getMonth() - b.getMonth();
    if (now.getDate() < b.getDate()) months--;
    if (months < 0) return '';
    return months < 24 ? plural(months, 'month') : plural(Math.floor(months / 12), 'year');
  }
  let idSeq = 0;

  function field(label, control, hint) {
    const id = 'pf' + (++idSeq);
    control.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('span', { class: 'hint' }, hint));
  }
  const input = (name, value, type = 'text', extra = {}) => h('input', { name, type, value: value ?? '', ...extra });
  const textarea = (name, value, rows = 3, extra = {}) => { const t = h('textarea', { name, rows, ...extra }); t.value = value ?? ''; return t; };
  function select(name, options, value) {
    const s = h('select', { name });
    options.forEach(([v, label]) => s.append(h('option', { value: v }, label)));
    s.value = value ?? options[0][0];
    return s;
  }
  function checkGroup(label, name, options, selected) {
    return h('div', { class: 'field' }, h('span', { class: 'label' }, label),
      h('div', { class: 'choices' }, options.map(o => h('label', { class: 'choice' },
        h('input', { type: 'checkbox', name, value: o, checked: (selected || []).includes(o) }), h('span', {}, o)))));
  }
  const checked = (form, name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
  const dl = rows => {
    const r = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
    return r.length ? h('dl', {}, r.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null;
  };

  // Wraps a form submit: shows progress, reports errors, then refreshes the page data
  function onSubmit(form, handler, okText) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      say('Saving…');
      try {
        await handler(Object.fromEntries(new FormData(form)), form);
        await refresh();
        say(okText || 'Saved.', 'ok');
      } catch (err) {
        say(niceError(err), 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    return form;
  }
  async function act(fn, okText) {
    say('Saving…');
    try { await fn(); await refresh(); say(okText || 'Saved.', 'ok'); } catch (err) { say(niceError(err), 'error'); }
  }
  const must = ({ data, error }) => { if (error) throw error; return data; };
  function niceError(err) {
    const m = (err && err.message) || String(err);
    if (/duplicate key.*email/i.test(m)) return 'Someone with that email is already on the list.';
    if (/duplicate key.*ref/i.test(m)) return 'That booking reference is already used.';
    if (/duplicate key.*reviews/i.test(m)) return "You've already reviewed this nanny for this booking.";
    if (/row-level security|permission/i.test(m)) return "You don't have permission to do that.";
    if (/exceeded the maximum allowed size|payload too large/i.test(m)) return 'That file is too big. Please choose one under 50 MB.';
    if (/password should be|weak password/i.test(m)) return 'Please choose a stronger password: at least 10 characters, mixing letters and numbers.';
    if (/should be different from the old/i.test(m)) return 'Your new password must be different from your old one.';
    return 'Something went wrong: ' + m;
  }

  function passwordFields() {
    return [
      field('New password', input('password', '', 'password', { autocomplete: 'new-password', required: true, minlength: MIN_PASSWORD }),
        `At least ${MIN_PASSWORD} characters. A short phrase you'll remember works well.`),
      field('Type it again', input('password2', '', 'password', { autocomplete: 'new-password', required: true }))
    ];
  }
  function checkPassword(f) {
    if ((f.password || '').length < MIN_PASSWORD) throw new Error(`your password needs at least ${MIN_PASSWORD} characters.`);
    if (!/[a-z]/i.test(f.password) || !/\d/.test(f.password)) throw new Error('please include both letters and numbers in your password.');
    if (f.password !== f.password2) throw new Error("the two passwords don't match.");
  }

  // ---------- Login page ----------

  if (loginRoot) {
    const forms = Object.fromEntries([...loginRoot.querySelectorAll('form[data-step]')].map(f => [f.dataset.step, f]));
    let email = '';
    const show = step => { Object.entries(forms).forEach(([k, f]) => { f.hidden = k !== step; }); say(''); const first = forms[step].querySelector('input'); if (first) first.focus(); };
    loginRoot.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.go === 'email') forms.email.email.value = forms.password.email.value;
      show(b.dataset.go);
    }));

    db.auth.getSession().then(({ data }) => { if (data.session) location.replace('account.html'); });

    forms.password.addEventListener('submit', async e => {
      e.preventDefault();
      const f = forms.password;
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      say('Logging in…');
      const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim().toLowerCase(), password: f.password.value });
      btn.disabled = false;
      if (error) {
        say(/invalid login/i.test(error.message)
          ? "That email and password don't match. Logging in for the first time? Use \"First time here\" below to get a login link."
          : /rate limit|too many/i.test(error.message) ? 'Too many attempts. Please wait a few minutes and try again.' : 'Sorry, something went wrong: ' + error.message, 'error');
        return;
      }
      location.replace('account.html');
    });

    forms.email.addEventListener('submit', async e => {
      e.preventDefault();
      email = forms.email.email.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) { say('Please enter a valid email address.', 'error'); return; }
      const btn = forms.email.querySelector('[type=submit]');
      btn.disabled = true;
      say('Sending…');
      const { error } = await db.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: new URL('account.html', location.href).href }
      });
      btn.disabled = false;
      if (error) {
        if (/database error|not been invited|signups not allowed/i.test(error.message)) {
          say("We couldn't find an account for that email. Use the email you gave us, or get in touch and we'll set you up.", 'error');
        } else if (/rate limit|security purposes|too many/i.test(error.message)) {
          say('Too many attempts. Please wait a few minutes and try again.', 'error');
        } else {
          say("Sorry, we couldn't send the email: " + error.message, 'error');
        }
        return;
      }
      loginRoot.querySelector('[data-sent-to]').textContent = email;
      show('code');
    });

    forms.code.addEventListener('submit', async e => {
      e.preventDefault();
      const token = forms.code.code.value.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(token)) { say('Please type the code from the email, or click the link in it.', 'error'); return; }
      const btn = forms.code.querySelector('[type=submit]');
      btn.disabled = true;
      say('Checking…');
      const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
      btn.disabled = false;
      if (error) { say('That code is wrong or has expired. Please try again or request a new one.', 'error'); return; }
      location.replace('account.html');
    });
    return;
  }

  // ---------- Account page ----------

  const wrap = accountRoot.querySelector('.wrap');
  const view = h('div');
  wrap.prepend(view);
  let me = null;
  let user = null;
  let data = {};
  let tabs = [];
  let activeTab = decodeURIComponent(location.hash.slice(1)) || '';
  const urls = {}; // storage path -> short-lived link

  start();

  async function start() {
    const { data: s } = await db.auth.getSession();
    if (!s.session) { location.replace('login.html'); return; }
    user = s.session.user;
    const { data: person, error } = await db.from('people').select('*').eq('user_id', user.id).maybeSingle();
    if (error || !person) {
      view.replaceChildren(h('div', { class: 'card portal-narrow' },
        h('h1', {}, "Your account isn't ready yet"),
        h('p', {}, "Please email cameron@protravelnannies.com and we'll set it up."),
        signOutButton()));
      say('');
      return;
    }
    me = person;
    if (!(user.user_metadata && user.user_metadata.password_set)) { renderSetPassword(); return; }
    tabs = me.role === 'admin' ? ADMIN_TABS : me.role === 'nanny' ? NANNY_TABS : FAMILY_TABS;
    if (!tabs.some(t => t.id === activeTab)) activeTab = tabs[0].id;
    await refresh();
    say('');
  }

  function renderSetPassword() {
    const form = h('form', { class: 'card form portal-narrow' },
      h('h1', { style: 'font-size:1.8rem;margin:0' }, `Welcome, ${firstName(me.full_name)}`),
      h('p', { style: 'margin:0' }, 'To keep your account secure, please create your own password. Next time, you can log in with your email and this password.'),
      ...passwordFields(),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save password and continue')));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      try {
        checkPassword(f);
        say('Saving…');
        const { data: d, error } = await db.auth.updateUser({ password: f.password, data: { password_set: true } });
        if (error) throw error;
        user = d.user;
        start();
      } catch (err) { say(niceError(err), 'error'); }
    });
    view.replaceChildren(form);
    say('');
  }

  async function refresh() {
    data = await (me.role === 'admin' ? loadAdmin() : me.role === 'nanny' ? loadNanny() : loadFamily());
    await signPaths(data.paths || []);
    render();
  }

  async function signPaths(paths) {
    const missing = [...new Set(paths.filter(p => p && !urls[p]))];
    if (!missing.length) return;
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(missing, 60 * 60 * 6);
    (signed || []).forEach(s => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }

  function signOutButton() {
    return h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { await db.auth.signOut(); location.replace('login.html'); } }, 'Log out');
  }

  function goTo(id) { activeTab = id; history.replaceState(null, '', '#' + id); say(''); render(); window.scrollTo({ top: 0 }); }

  function render() {
    const roleLabel = { admin: 'Admin', nanny: 'Nanny account', family: 'Family account' }[me.role];
    const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === activeTab), onclick: () => goTo(t.id) },
        t.label, t.count && t.count() ? h('span', { class: 'tab-count' }, t.count()) : null)));
    const panel = h('div', { class: 'portal-panel', role: 'tabpanel' });
    tabs.find(t => t.id === activeTab).render(panel);
    view.replaceChildren(
      h('div', { class: 'portal-head' },
        h('div', {}, h('p', { class: 'eyebrow left' }, roleLabel), h('h1', {}, `Hello, ${firstName(me.full_name)}`)),
        signOutButton()),
      tabBar,
      panel);
  }

  // ---------- Shared pieces ----------

  const SERVICES = ['Babysitting', 'Holiday nanny', 'Travel nanny', 'Weddings & events', 'Overnight care', 'Newborn & infant specialist'];
  const STATUS_LABEL = { Requested: 'Request received', Confirmed: 'Confirmed', Completed: 'Completed', Cancelled: 'Cancelled' };
  const AGE_GROUPS = ['Newborns (0–3 months)', 'Babies (3–12 months)', 'Toddlers (1–3)', 'Pre-school (3–5)', 'School age (5–12)', 'Teens (12+)'];
  const SKILLS = ['Driving licence', 'Own car', 'Confident swimmer', 'Lifeguard / water safety', 'CPR', 'Paediatric first aid', 'Safeguarding training', 'Special educational needs', 'Twins / multiples', 'Sleep routines', 'Cooking for children', 'Homework help', 'Arts and crafts', 'Outdoor activities'];
  const CHECKS = ['ID verified', 'Video interview', 'References checked', 'Sex-offence certificate checked', 'First aid', 'Self-employed (autónomo)'];

  const byKey = (list, key = 'id') => Object.fromEntries((list || []).map(x => [x[key], x]));
  const endOf = b => b.end_date || b.booking_date;
  const isPast = b => endOf(b) < today || b.status === 'Completed';
  const isLive = b => b.status !== 'Cancelled';
  const byDate = (a, b) => a.booking_date.localeCompare(b.booking_date);

  async function loadUpdates(bookingIds) {
    if (!bookingIds.length) return [];
    return must(await db.from('booking_updates').select('*').in('booking_id', bookingIds).order('created_at'));
  }
  async function loadReviews(nannyIds) {
    if (!nannyIds.length) return [];
    return must(await db.from('reviews').select('*').in('nanny_id', nannyIds).order('created_at', { ascending: false }));
  }

  function statusPill(b, override) {
    const label = override || STATUS_LABEL[b.status] || b.status;
    return h('span', { class: 'status ' + (override ? 'Requested' : b.status) }, label);
  }

  function bookingHeader(b, pill) {
    return h('div', { class: 'bk-top' },
      h('div', {}, h('p', { class: 'bk-service' }, b.service + (b.event_name ? ' · ' + b.event_name : '')), h('p', { class: 'bk-date' }, dateRange(b))),
      pill || statusPill(b));
  }

  function bookingFacts(b) {
    const facts = [
      ['Time', timeRange(b)],
      ['Hours booked', b.hours_booked ? `${Number(b.hours_booked)} hours` : ''],
      ['Children', [b.children_count != null ? String(b.children_count) : '', b.children_ages ? `(${b.children_ages})` : ''].filter(Boolean).join(' ')],
      ['Nannies', b.nannies_needed > 1 ? String(b.nannies_needed) : '']
    ].filter(([, v]) => v);
    return facts.length ? h('div', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('span', {}, k), h('strong', {}, v)))) : null;
  }

  function bookingRequest(b) {
    const rows = dl([
      ['What the family asked for', b.family_requests],
      ['Languages', b.languages_requested],
      ['Day-by-day plan', b.schedule],
      ['Travel details', b.travel_details],
      ['Address or meeting point', b.address],
      ['Info for the nanny', b.info_for_nanny],
      ['Booking ref', b.ref]
    ]);
    return rows ? h('div', { class: 'bk-box' }, h('h3', {}, 'Booking details'), rows) : null;
  }

  function updatesBox(b, canAdd) {
    const list = data.updates.filter(u => u.booking_id === b.id);
    const box = h('div', { class: 'bk-box' }, h('h3', {}, 'Hours and notes'));
    if (!list.length) box.append(h('p', { class: 'empty small' }, me.role === 'nanny' ? 'After the booking, log your hours here.' : 'Notes and hours from you and your nanny will appear here.'));
    else box.append(h('ul', { class: 'updates' }, list.map(u => {
      const who = u.author_id === me.id ? 'You' : (data.names[u.author_id] || 'Pro Travel Nannies');
      const title = u.kind === 'hours'
        ? `${who} logged ${plural(Number(u.hours), 'hour')}${u.work_date ? ' for ' + fmtShort(u.work_date) : ''}`
        : `${who} added a note`;
      const states = [];
      if (u.kind === 'hours') states.push(u.family_confirmed_at ? 'Confirmed by family' : 'Waiting for family to confirm');
      if (u.checked_by_admin_at) states.push('Checked by Pro Travel Nannies');
      const li = h('li', {}, h('strong', {}, title), u.note && h('div', {}, u.note),
        h('div', { class: 'meta' }, [fmtStamp(u.created_at), ...states].join(' · ')));
      if (me.role === 'family' && u.kind === 'hours' && !u.family_confirmed_at) {
        li.append(h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'button',
          onclick: () => act(async () => { must(await db.rpc('confirm_hours', { update_id: u.id })); }, 'Thanks, hours confirmed.') }, 'Confirm these hours')));
      }
      if (u.author_id === me.id && !u.family_confirmed_at && !u.checked_by_admin_at) {
        li.append(' ', h('button', { class: 'link-btn small', type: 'button',
          onclick: () => { if (confirm('Remove this?')) act(async () => { must(await db.from('booking_updates').delete().eq('id', u.id)); }, 'Removed.'); } }, 'Remove'));
      }
      return li;
    })));
    if (canAdd) box.append(addUpdateForm(b));
    return box;
  }

  function addUpdateForm(b) {
    const nanny = me.role === 'nanny';
    const kind = nanny ? select('kind', [['hours', 'Log hours worked'], ['note', 'Add a note']], 'hours') : null;
    const hoursRow = nanny ? h('div', { class: 'row' },
      field('Date worked', input('work_date', b.booking_date, 'date')),
      field('Hours worked', input('hours', '', 'number', { min: '0.25', max: '24', step: '0.25', inputmode: 'decimal' }))) : null;
    const form = h('form', { class: 'inline-form', style: 'margin-top:1rem' },
      kind && field('What would you like to add?', kind),
      hoursRow,
      field(nanny ? 'Note (optional for hours)' : 'Add a note for your nanny', textarea('note', '', 2),
        nanny ? 'e.g. "Stayed 30 minutes extra, agreed with the parents."' : 'e.g. bedtime, dinner plans or anything that has changed.'),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, nanny ? 'Add' : 'Add note')));
    if (kind) kind.addEventListener('change', () => { hoursRow.hidden = kind.value !== 'hours'; });
    return onSubmit(form, async f => {
      const isHours = nanny && f.kind === 'hours';
      if (isHours && !(Number(f.hours) > 0)) throw new Error('please enter the hours worked.');
      if (!isHours && !f.note.trim()) throw new Error('please write your note.');
      must(await db.from('booking_updates').insert({
        booking_id: b.id, author_id: me.id, kind: isHours ? 'hours' : 'note',
        work_date: isHours ? blank(f.work_date) : null, hours: isHours ? Number(f.hours) : null, note: blank(f.note)
      }));
    }, 'Added.');
  }

  function stars(rating) {
    const r = Math.round(rating * 2) / 2;
    return h('span', { class: 'stars', 'aria-label': `${r} out of 5 stars`, title: `${r} out of 5` }, '★★★★★'.slice(0, Math.round(r)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(r)));
  }
  function reviewSummary(list) {
    const pub = list.filter(r => r.published_at);
    if (!pub.length) return null;
    const avg = pub.reduce((s, r) => s + r.rating, 0) / pub.length;
    return h('p', { class: 'review-summary' }, stars(avg), ` ${avg.toFixed(1)} · ${plural(pub.length, 'review')}`);
  }
  function reviewList(list, names) {
    const pub = list.filter(r => r.published_at);
    if (!pub.length) return h('p', { class: 'empty small' }, 'No reviews yet.');
    return h('ul', { class: 'reviews' }, pub.map(r => h('li', {},
      h('div', {}, stars(r.rating), ' ', h('span', { class: 'meta' }, `${(names && names[r.family_id]) ? firstName(names[r.family_id]) + ' · ' : ''}${new Date(r.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`)),
      h('p', {}, r.comment))));
  }

  function avatar(path, size = 72, label = '') {
    const src = path && urls[path];
    return src ? h('img', { class: 'avatar', src, alt: label, width: size, height: size, style: `width:${size}px;height:${size}px` })
      : h('span', { class: 'avatar placeholder', style: `width:${size}px;height:${size}px`, 'aria-hidden': 'true' }, (label || '?').trim().charAt(0).toUpperCase());
  }

  function videoBlock(profile) {
    if (profile.video_path && urls[profile.video_path]) return h('video', { class: 'profile-video', src: urls[profile.video_path], controls: true, preload: 'metadata', playsinline: true });
    const link = safeUrl(profile.video_url);
    return link ? h('a', { class: 'btn btn-secondary btn-small', href: link, target: '_blank', rel: 'noopener' }, 'Watch intro video') : null;
  }

  // Full nanny profile, as families see it
  function nannyProfileView(person, p, reviews, opts = {}) {
    p = p || {};
    const gallery = (p.gallery_paths || []).filter(x => urls[x]);
    return h('div', { class: 'profile-view' },
      h('div', { class: 'person' }, avatar(p.photo_path, 96, person.full_name),
        h('div', {},
          h('h3', { style: 'margin:0' }, person.full_name),
          p.headline && h('p', { class: 'muted', style: 'margin:.2rem 0' }, p.headline),
          reviewSummary(reviews || []),
          p.checks && p.checks.length ? h('div', { class: 'badges', style: 'margin-top:.5rem' }, p.checks.map(c => h('span', { class: 'badge' }, c))) : null)),
      p.about && h('p', { class: 'pre' }, p.about),
      videoBlock(p),
      gallery.length ? h('div', { class: 'gallery' }, gallery.map(g => h('img', { src: urls[g], alt: `Photo from ${person.full_name}`, loading: 'lazy' }))) : null,
      dl([
        ['Experience', [p.experience_years != null ? `${plural(p.experience_years, 'year')}` : '', p.experience].filter(Boolean).join('. ')],
        ['Qualifications', p.qualifications],
        ['Languages', p.languages],
        ['Based in', p.based_in],
        ['Areas covered', p.areas],
        ['Services', (p.services || []).join(', ')],
        ['Ages', (p.age_groups || []).join(', ')],
        ['Skills', (p.skills || []).join(', ')]
      ]),
      opts.showReviews !== false ? h('div', {}, h('h4', {}, 'Reviews from families'), reviewList(reviews || [], opts.names)) : null);
  }

  function profileCompleteness(items) {
    const done = items.filter(([, ok]) => ok).length;
    const pct = Math.round((done / items.length) * 100);
    const missing = items.filter(([, ok]) => !ok).map(([label]) => label);
    return h('div', { class: 'completeness' },
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: `width:${pct}%` })),
      h('p', { class: 'small', style: 'margin:.4rem 0 0' }, `Profile ${pct}% complete`, missing.length ? h('span', { class: 'muted' }, ` · Still to add: ${missing.join(', ')}`) : ''));
  }

  // Shrinks big photos before upload so pages stay fast
  async function shrinkImage(file, max = 1600) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }

  async function uploadFile(file, kind, ownerId = me.id) {
    const isImage = /^image\/(jpeg|png|webp)$/.test(file.type);
    const isVideo = /^video\/(mp4|quicktime|webm)$/.test(file.type);
    if (!isImage && !isVideo) throw new Error('please choose a JPG, PNG or WEBP photo, or an MP4 or MOV video.');
    if (file.size > 50 * 1024 * 1024) throw new Error('that file is too big. Please choose one under 50 MB.');
    const f = isImage ? await shrinkImage(file) : file;
    const ext = (f.type.split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg');
    const path = `${ownerId}/${kind}-${Date.now()}.${ext}`;
    must(await db.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false }));
    return path;
  }
  const removeFiles = paths => { const p = paths.filter(Boolean); if (p.length) db.storage.from(BUCKET).remove(p); };

  function fileButton(label, accept, onFile) {
    const inp = h('input', { type: 'file', accept, class: 'visually-hidden-file' });
    const btn = h('label', { class: 'btn btn-secondary btn-small file-btn' }, label, inp);
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      say(/^video/.test(file.type) ? 'Uploading your video… this can take a minute.' : 'Uploading…');
      try { await onFile(file); await refresh(); say('Uploaded.', 'ok'); } catch (err) { say(niceError(err), 'error'); }
      inp.value = '';
    });
    return btn;
  }

  function accountPanel(panel) {
    panel.append(h('h2', {}, 'Account and security'));
    panel.append(h('div', { class: 'card' }, dl([
      ['Name', me.full_name], ['Email', me.email], ['Phone', me.phone || 'Not added']
    ]), h('p', { class: 'small muted', style: 'margin-top:1rem' }, 'To change your name, email or phone number, email cameron@protravelnannies.com so we can keep your account safe.')));
    const form = h('form', { class: 'card inline-form' }, h('h3', {}, 'Change your password'), ...passwordFields(),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Change password')));
    panel.append(onSubmit(form, async f => {
      checkPassword(f);
      must(await db.auth.updateUser({ password: f.password, data: { password_set: true } }));
      form.reset();
    }, 'Password changed.'));
    panel.append(h('div', { class: 'card' }, h('h3', {}, 'Keeping your account safe'),
      h('ul', { class: 'checks small' },
        h('li', {}, 'Only you, Pro Travel Nannies and the people booked with you can see your details.'),
        h('li', {}, 'Never share your password. We will never ask you for it.'),
        h('li', {}, 'Using a shared computer? Remember to log out when you finish.')),
      h('div', { style: 'margin-top:1rem' }, signOutButton())));
  }

  // ---------- Nanny ----------

  async function loadNanny() {
    const mine = must(await db.from('booking_nannies').select('*').eq('nanny_id', me.id));
    const ids = mine.filter(r => r.response !== 'declined').map(r => r.booking_id);
    const bookings = ids.length ? must(await db.from('bookings').select('*').in('id', ids).order('booking_date')) : [];
    const familyIds = [...new Set(bookings.map(b => b.family_id))];
    const [people, families, children, updates, availability, profile, reviews] = await Promise.all([
      familyIds.length ? db.from('people').select('id, full_name, phone').in('id', familyIds).then(must) : [],
      familyIds.length ? db.from('family_profiles').select('*').in('person_id', familyIds).then(must) : [],
      familyIds.length ? db.from('children').select('*').in('family_id', familyIds).order('date_of_birth').then(must) : [],
      loadUpdates(bookings.map(b => b.id)),
      db.from('availability').select('*').eq('nanny_id', me.id).order('date_from').then(must),
      db.from('nanny_profiles').select('*').eq('person_id', me.id).maybeSingle().then(must),
      loadReviews([me.id])
    ]);
    const names = Object.fromEntries(people.map(p => [p.id, p.full_name]));
    const paths = profile ? [profile.photo_path, profile.video_path, ...(profile.gallery_paths || [])] : [];
    families.forEach(f => paths.push(f.photo_path));
    return { mine: byKey(mine, 'booking_id'), bookings, people: byKey(people), families: byKey(families, 'person_id'), children, updates, availability, profile, reviews, names, paths };
  }

  const myRow = b => data.mine[b.id] || {};
  const accepted = b => myRow(b).response === 'accepted';
  const offers = () => data.bookings.filter(b => myRow(b).response === 'offered' && isLive(b) && !isPast(b));

  function payBox(b) {
    const r = myRow(b);
    if (r.nanny_pay == null && r.nanny_expenses == null) return null;
    const total = Number(r.nanny_pay || 0) + Number(r.nanny_expenses || 0);
    return h('div', { class: 'bk-box pay' }, h('h3', {}, 'Your pay'), dl([
      ['Pay', money(r.nanny_pay)],
      ['Expenses', money(r.nanny_expenses)],
      ['Total', money(total)],
      ['Note', r.pay_note],
      ['Status', r.nanny_paid_on ? `Paid on ${fmtDate(r.nanny_paid_on)}` : 'Not paid yet: paid on the Friday after the booking']
    ]));
  }

  function familyBox(b) {
    const fam = data.people[b.family_id];
    const fp = data.families[b.family_id] || {};
    const kids = data.children.filter(c => c.family_id === b.family_id);
    return h('div', { class: 'bk-box' }, h('h3', {}, 'The family'),
      h('div', { class: 'person' }, avatar(fp.photo_path, 56, fam ? fam.full_name : ''),
        h('div', {}, h('p', {}, h('strong', {}, fp.family_name || (fam && fam.full_name) || '')),
          fam && fam.phone && h('p', {}, h('a', { href: 'tel:' + fam.phone.replace(/[^\d+]/g, '') }, fam.phone)))),
      fp.about && h('p', { class: 'pre' }, fp.about),
      kids.length ? h('div', { class: 'kids' }, kids.map(c => h('div', { class: 'kid' },
        h('p', {}, h('strong', {}, c.first_name), c.date_of_birth ? ` · ${ageOf(c.date_of_birth)}` : ''),
        dl([['Allergies', c.allergies], ['Medical', c.medical], ['Loves', c.likes], ['Routine', c.routine]])))) : null,
      dl([
        ['Languages at home', fp.languages_at_home],
        ['Pets', fp.pets],
        ['House rules', fp.house_rules],
        ['Notes for nannies', fp.notes_for_nannies],
        ['Emergency contact', [fp.emergency_contact_name, fp.emergency_contact_phone].filter(Boolean).join(', ')]
      ]));
  }

  function nannyBookingCard(b) {
    const r = myRow(b);
    if (r.response === 'offered') {
      return h('article', { class: 'card bk offer' },
        bookingHeader(b, statusPill(b, 'Waiting for your answer')),
        bookingFacts(b), bookingRequest(b), payBox(b),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => act(async () => { must(await db.rpc('respond_to_booking', { b: b.id, answer: 'accepted' })); }, "Booking accepted. You'll now see the family's details.") }, 'Accept booking'),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { if (confirm('Decline this booking?')) act(async () => { must(await db.rpc('respond_to_booking', { b: b.id, answer: 'declined' })); }, 'Booking declined.'); } }, 'Decline')),
        h('p', { class: 'small muted', style: 'margin:0' }, "You'll see the family's full details and children's information once you accept."));
    }
    return h('article', { class: 'card bk' }, bookingHeader(b), bookingFacts(b), bookingRequest(b),
      isLive(b) ? familyBox(b) : null, payBox(b), isLive(b) ? updatesBox(b, true) : null);
  }

  function nannyOverview(panel) {
    const off = offers();
    const upcoming = data.bookings.filter(b => accepted(b) && isLive(b) && !isPast(b)).sort(byDate);
    const rows = Object.values(data.mine).filter(r => r.response === 'accepted');
    const bk = byKey(data.bookings);
    const earnedMonth = rows.filter(r => bk[r.booking_id] && bk[r.booking_id].booking_date.startsWith(thisMonth) && bk[r.booking_id].status !== 'Cancelled')
      .reduce((s, r) => s + Number(r.nanny_pay || 0) + Number(r.nanny_expenses || 0), 0);
    const owed = rows.filter(r => !r.nanny_paid_on && bk[r.booking_id] && bk[r.booking_id].status === 'Completed')
      .reduce((s, r) => s + Number(r.nanny_pay || 0) + Number(r.nanny_expenses || 0), 0);
    panel.append(h('div', { class: 'stat-row' },
      stat('New booking offers', off.length, () => goTo('bookings')),
      stat('Upcoming bookings', upcoming.length, () => goTo('bookings')),
      stat('Earnings this month', money(earnedMonth), () => goTo('earnings')),
      stat('Waiting to be paid', money(owed), () => goTo('earnings'))));
    if (off.length) { panel.append(h('h2', {}, 'Waiting for your answer')); off.sort(byDate).forEach(b => panel.append(nannyBookingCard(b))); }
    panel.append(h('h2', {}, 'Your next booking'));
    panel.append(upcoming.length ? nannyBookingCard(upcoming[0]) : h('p', { class: 'empty' }, 'No upcoming bookings yet. Keep your calendar up to date so we can offer you work.'));
    panel.append(h('div', { class: 'card' }, h('h3', {}, 'Your profile'), nannyCompleteness(),
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', style: 'margin-top:1rem', onclick: () => goTo('profile') }, 'Edit my profile')));
  }

  function stat(label, value, onclick) {
    return h('button', { class: 'stat', type: 'button', onclick }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label));
  }

  function nannyCompleteness() {
    const p = data.profile || {};
    return profileCompleteness([
      ['profile photo', p.photo_path], ['headline', p.headline], ['bio', p.about], ['intro video', p.video_path || p.video_url],
      ['experience', p.experience || p.experience_years != null], ['languages', p.languages], ['services', (p.services || []).length],
      ['age groups', (p.age_groups || []).length], ['photos', (p.gallery_paths || []).length]
    ]);
  }

  function nannyBookings(panel) {
    const off = offers().sort(byDate);
    const upcoming = data.bookings.filter(b => accepted(b) && isLive(b) && !isPast(b)).sort(byDate);
    const past = data.bookings.filter(b => !off.includes(b) && !upcoming.includes(b)).sort((a, b) => byDate(b, a));
    if (off.length) { panel.append(h('h2', {}, 'New booking offers')); off.forEach(b => panel.append(nannyBookingCard(b))); }
    panel.append(h('h2', {}, 'Upcoming bookings'));
    if (!upcoming.length) panel.append(h('p', { class: 'empty' }, 'No upcoming bookings yet.'));
    upcoming.forEach(b => panel.append(nannyBookingCard(b)));
    if (past.length) panel.append(pastSection(past, nannyBookingCard));
  }

  function pastSection(list, card) {
    const d = h('details', {}, h('summary', {}, `Past and cancelled bookings (${list.length})`));
    const inner = h('div', { class: 'portal-panel', style: 'margin-top:1rem' });
    list.forEach(b => inner.append(card(b)));
    d.append(inner);
    return d;
  }

  function nannyCalendar(panel) {
    const month = new Date(); month.setDate(1);
    const holder = h('div', { class: 'card cal' });
    const draw = () => {
      const y = month.getFullYear(), m = month.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-day out', 'aria-hidden': 'true' }));
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        const booked = data.bookings.some(b => accepted(b) && isLive(b) && b.booking_date <= iso && endOf(b) >= iso);
        const avail = data.availability.filter(a => a.date_from <= iso && a.date_to >= iso);
        const cls = booked ? 'booked' : avail.some(a => !a.available) ? 'away' : avail.some(a => a.available) ? 'free' : '';
        const label = booked ? 'booked' : cls === 'away' ? 'not available' : cls === 'free' ? 'available' : '';
        cells.push(h('div', { class: `cal-day ${cls} ${iso === today ? 'today' : ''}`, title: label, 'aria-label': `${d}${label ? ', ' + label : ''}` }, d));
      }
      holder.replaceChildren(
        h('div', { class: 'cal-nav' },
          h('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': 'Previous month', onclick: () => { month.setMonth(m - 1); draw(); } }, '←'),
          h('h3', {}, month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
          h('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': 'Next month', onclick: () => { month.setMonth(m + 1); draw(); } }, '→')),
        h('div', { class: 'cal-grid' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { class: 'dow' }, d)), cells),
        h('div', { class: 'cal-key' }, h('span', { class: 'k-booked' }, 'Booked'), h('span', { class: 'k-away' }, 'Not available'), h('span', { class: 'k-free' }, 'Available')));
    };
    draw();
    panel.append(holder);
  }

  function nannyAvailability(panel) {
    panel.append(h('h2', {}, 'My calendar'),
      h('p', { class: 'muted', style: 'margin:0' }, "Mark the dates you're away, or especially keen to work, so we only offer you bookings that suit you."));
    nannyCalendar(panel);
    const st = select('available', [['false', 'Not available'], ['true', 'Available']], 'false');
    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, 'Add dates'),
      h('div', { class: 'row' }, field('From', input('date_from', today, 'date', { required: true })), field('To', input('date_to', today, 'date', { required: true })), field('I am', st)),
      field('Note (optional)', input('note', '', 'text', { placeholder: 'e.g. Only evenings, or away in the UK' })),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Add dates')));
    panel.append(onSubmit(form, async f => {
      if (f.date_to < f.date_from) throw new Error('the "To" date must be on or after the "From" date.');
      must(await db.from('availability').insert({ nanny_id: me.id, date_from: f.date_from, date_to: f.date_to, available: f.available === 'true', note: blank(f.note) }));
    }, 'Dates added.'));
    const upcoming = data.availability.filter(a => a.date_to >= today);
    panel.append(h('h2', {}, 'Dates you have marked'));
    if (!upcoming.length) panel.append(h('p', { class: 'empty' }, 'None yet.'));
    else panel.append(h('ul', { class: 'updates' }, upcoming.map(a => h('li', {},
      h('strong', {}, `${fmtDate(a.date_from)}${a.date_to !== a.date_from ? ' to ' + fmtDate(a.date_to) : ''}: ${a.available ? 'Available' : 'Not available'}`),
      a.note && h('div', {}, a.note), ' ',
      h('button', { class: 'link-btn small', type: 'button', onclick: () => act(async () => { must(await db.from('availability').delete().eq('id', a.id)); }, 'Removed.') }, 'Remove')))));
  }

  function nannyEarnings(panel) {
    const bk = byKey(data.bookings);
    const rows = Object.values(data.mine).filter(r => r.response === 'accepted' && bk[r.booking_id]).sort((a, b) => byDate(bk[b.booking_id], bk[a.booking_id]));
    const total = r => Number(r.nanny_pay || 0) + Number(r.nanny_expenses || 0);
    const year = today.slice(0, 4);
    const live = rows.filter(r => bk[r.booking_id].status !== 'Cancelled');
    panel.append(h('h2', {}, 'My earnings'), h('div', { class: 'stat-row' },
      stat('This month', money(live.filter(r => bk[r.booking_id].booking_date.startsWith(thisMonth)).reduce((s, r) => s + total(r), 0))),
      stat(`So far in ${year}`, money(live.filter(r => bk[r.booking_id].booking_date.startsWith(year)).reduce((s, r) => s + total(r), 0))),
      stat('Waiting to be paid', money(live.filter(r => !r.nanny_paid_on && bk[r.booking_id].status === 'Completed').reduce((s, r) => s + total(r), 0)))));
    panel.append(h('p', { class: 'small muted', style: 'margin:0' }, "You're paid every Friday for the bookings you completed that week. As a self-employed nanny, you invoice and declare this income yourself."));
    if (!rows.length) { panel.append(h('p', { class: 'empty' }, 'No earnings yet.')); return; }
    panel.append(table(['Date', 'Booking', 'Pay', 'Expenses', 'Total', 'Paid'], rows.map(r => {
      const b = bk[r.booking_id];
      return h('tr', {}, h('td', {}, fmtShort(b.booking_date)), h('td', {}, b.service, b.status === 'Cancelled' ? h('div', { class: 'small muted' }, 'Cancelled') : null),
        h('td', {}, money(r.nanny_pay)), h('td', {}, money(r.nanny_expenses)), h('td', {}, h('strong', {}, money(total(r)))),
        h('td', {}, r.nanny_paid_on ? fmtShort(r.nanny_paid_on) : h('span', { class: 'muted' }, 'Not yet')));
    })));
  }

  function nannyProfile(panel) {
    const p = data.profile;
    panel.append(h('h2', {}, 'My profile'));
    if (!p) { panel.append(h('p', { class: 'empty' }, "Your profile hasn't been set up yet. Cameron will add it shortly.")); return; }
    panel.append(h('div', { class: 'card' }, nannyCompleteness()));

    // Photo
    panel.append(h('div', { class: 'card media-card' }, h('h3', {}, 'Profile photo'),
      h('div', { class: 'person' }, avatar(p.photo_path, 96, me.full_name),
        h('div', {}, h('p', { class: 'small muted' }, 'A clear, smiling photo of just you, facing the camera. This is the first thing families see.'),
          fileButton(p.photo_path ? 'Change photo' : 'Upload photo', 'image/jpeg,image/png,image/webp', async file => {
            const path = await uploadFile(file, 'photo');
            must(await db.from('nanny_profiles').update({ photo_path: path }).eq('person_id', me.id));
            removeFiles([p.photo_path]);
          })))));

    // Video
    const vForm = h('form', { class: 'inline-form', style: 'margin-top:1rem' },
      field('Or paste a YouTube or Vimeo link', input('video_url', p.video_url, 'url', { placeholder: 'https://' })),
      h('div', {}, h('button', { class: 'btn btn-secondary btn-small', type: 'submit' }, 'Save link')));
    onSubmit(vForm, async f => {
      if (f.video_url && !safeUrl(f.video_url)) throw new Error('please paste a full link starting with https://');
      must(await db.from('nanny_profiles').update({ video_url: safeUrl(f.video_url) }).eq('person_id', me.id));
    }, 'Video link saved.');
    panel.append(h('div', { class: 'card media-card' }, h('h3', {}, 'Intro video'),
      h('p', { class: 'small muted' }, 'A 30 to 60 second hello: who you are, your experience, and what you love doing with children. Families love this. Max 50 MB (record in 720p on your phone).'),
      videoBlock(p),
      h('div', { class: 'btn-row', style: 'margin-top:.8rem' },
        fileButton(p.video_path ? 'Replace video' : 'Upload video', 'video/mp4,video/quicktime,video/webm', async file => {
          const path = await uploadFile(file, 'video');
          must(await db.from('nanny_profiles').update({ video_path: path }).eq('person_id', me.id));
          removeFiles([p.video_path]);
        }),
        p.video_path && h('button', { class: 'link-btn small', type: 'button', onclick: () => act(async () => {
          must(await db.from('nanny_profiles').update({ video_path: null }).eq('person_id', me.id)); removeFiles([p.video_path]);
        }, 'Video removed.') }, 'Remove video')),
      vForm));

    // Gallery
    const gallery = p.gallery_paths || [];
    panel.append(h('div', { class: 'card media-card' }, h('h3', {}, 'More photos'),
      h('p', { class: 'small muted' }, 'Up to 6 photos: you doing activities, crafts you have made, places you love. Please no photos where children can be identified.'),
      gallery.length ? h('div', { class: 'gallery editable' }, gallery.map(g => h('figure', {},
        urls[g] ? h('img', { src: urls[g], alt: '' }) : h('span', { class: 'empty small' }, 'Loading…'),
        h('button', { class: 'link-btn small', type: 'button', onclick: () => act(async () => {
          must(await db.from('nanny_profiles').update({ gallery_paths: gallery.filter(x => x !== g) }).eq('person_id', me.id)); removeFiles([g]);
        }, 'Photo removed.') }, 'Remove')))) : null,
      gallery.length < 6 ? fileButton('Add a photo', 'image/jpeg,image/png,image/webp', async file => {
        const path = await uploadFile(file, 'gallery');
        must(await db.from('nanny_profiles').update({ gallery_paths: [...gallery, path] }).eq('person_id', me.id));
      }) : null));

    // Details
    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, 'About me'),
      field('Headline', input('headline', p.headline, 'text', { maxlength: 90, placeholder: 'e.g. Bilingual early-years teacher who loves the outdoors' })),
      field('Bio', textarea('about', p.about, 6), 'A few friendly paragraphs: your background, why you love working with children, what a day with you looks like.'),
      h('div', { class: 'row' },
        field('Years of childcare experience', input('experience_years', p.experience_years, 'number', { min: 0, max: 60 })),
        field('Based in', input('based_in', p.based_in, 'text', { placeholder: 'e.g. Marbella' })),
        field('Languages', input('languages', p.languages, 'text', { placeholder: 'e.g. English (native), Spanish (fluent)' }))),
      field('Experience', textarea('experience', p.experience, 5), 'Roles you have had, ages you have cared for, anything you are proud of. Add new experience here whenever you get it.'),
      field('Qualifications and training', textarea('qualifications', p.qualifications, 3)),
      field('Areas I can work in', input('areas', p.areas, 'text', { placeholder: 'e.g. Costa del Sol, Mallorca, happy to travel' })),
      checkGroup('Services I offer', 'services', SERVICES, p.services),
      checkGroup('Ages I am experienced with', 'age_groups', AGE_GROUPS, p.age_groups),
      checkGroup('Skills', 'skills', SKILLS, p.skills),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save my profile')));
    panel.append(onSubmit(form, async (f, el) => {
      must(await db.from('nanny_profiles').update({
        headline: blank(f.headline), about: blank(f.about), experience_years: num(f.experience_years), based_in: blank(f.based_in),
        languages: blank(f.languages), experience: blank(f.experience), qualifications: blank(f.qualifications), areas: blank(f.areas),
        services: checked(el, 'services'), age_groups: checked(el, 'age_groups'), skills: checked(el, 'skills')
      }).eq('person_id', me.id));
    }, 'Profile saved.'));

    panel.append(h('div', { class: 'card' }, h('h3', {}, 'Verified by Pro Travel Nannies'),
      p.checks && p.checks.length ? h('div', { class: 'badges' }, p.checks.map(c => h('span', { class: 'badge' }, c))) : h('p', { class: 'empty small' }, 'No checks added yet.'),
      h('p', { class: 'small muted', style: 'margin:.8rem 0 0' }, 'These badges are added by us once we have checked your documents. Email us if something is missing.')));

    panel.append(h('div', { class: 'card' }, h('h3', {}, 'My reviews'), reviewSummary(data.reviews), reviewList(data.reviews)));

    panel.append(h('details', { class: 'card' }, h('summary', {}, 'Preview: how families see my profile'),
      h('div', { style: 'margin-top:1rem' }, nannyProfileView(me, p, data.reviews))));
  }

  const NANNY_TABS = [
    { id: 'overview', label: 'Overview', render: nannyOverview },
    { id: 'bookings', label: 'Bookings', render: nannyBookings, count: () => offers().length },
    { id: 'calendar', label: 'My calendar', render: nannyAvailability },
    { id: 'earnings', label: 'Earnings', render: nannyEarnings },
    { id: 'profile', label: 'My profile', render: nannyProfile },
    { id: 'account', label: 'Account', render: accountPanel }
  ];

  // ---------- Family ----------

  async function loadFamily() {
    const bookings = must(await db.from('bookings').select('*').eq('family_id', me.id).order('booking_date'));
    const team = must(await db.rpc('family_booking_nannies'));
    const nannyIds = [...new Set(team.map(t => t.nanny_id))];
    const [payments, nannies, updates, profile, children, reviews] = await Promise.all([
      bookings.length ? db.from('booking_payments').select('*').in('booking_id', bookings.map(b => b.id)).then(must) : [],
      nannyIds.length ? db.from('nanny_profiles').select('*').in('person_id', nannyIds).then(must) : [],
      loadUpdates(bookings.map(b => b.id)),
      db.from('family_profiles').select('*').eq('person_id', me.id).maybeSingle().then(must),
      db.from('children').select('*').eq('family_id', me.id).order('date_of_birth').then(must),
      loadReviews(nannyIds)
    ]);
    const names = Object.fromEntries(team.map(t => [t.nanny_id, t.full_name]));
    const paths = [profile && profile.photo_path];
    nannies.forEach(n => paths.push(n.photo_path, n.video_path, ...(n.gallery_paths || [])));
    return { bookings, team, payments: byKey(payments, 'booking_id'), nannies: byKey(nannies, 'person_id'), updates, profile, children, reviews, names, paths };
  }

  const balanceOf = p => (p && p.family_total != null ? Number(p.family_total) - Number(p.amount_paid || 0) : null);
  const toConfirm = () => data.updates.filter(u => u.kind === 'hours' && !u.family_confirmed_at);
  const reviewable = () => data.bookings.filter(b => b.status === 'Completed').flatMap(b =>
    data.team.filter(t => t.booking_id === b.id && !data.reviews.some(r => r.booking_id === b.id && r.nanny_id === t.nanny_id)).map(t => ({ b, t })));

  function paymentBox(b) {
    const p = data.payments[b.id];
    if (!p || p.family_total == null) return h('div', { class: 'bk-box pay' }, h('h3', {}, 'Price'), h('p', { class: 'empty small' }, "We'll add your price here once your booking is confirmed."));
    const bal = balanceOf(p);
    return h('div', { class: 'bk-box pay' }, h('h3', {}, 'Price and payment'),
      p.breakdown && h('p', { class: 'pre small' }, p.breakdown),
      dl([
        ['Total', money(p.family_total)],
        ['Paid so far', money(p.amount_paid || 0)],
        ['Still to pay', bal > 0 ? money(bal) : 'Nothing, thank you!'],
        ['Due by', bal > 0 && p.due_date ? fmtDate(p.due_date) : ''],
        ['Invoice', p.invoice_no],
        ['Note', p.payment_note]
      ]));
  }

  function nannyCard(t) {
    const p = data.nannies[t.nanny_id] || {};
    const revs = data.reviews.filter(r => r.nanny_id === t.nanny_id);
    const person = { id: t.nanny_id, full_name: t.full_name };
    return h('div', { class: 'nanny-card' },
      h('div', { class: 'person' }, avatar(p.photo_path, 72, t.full_name),
        h('div', {}, h('p', {}, h('strong', {}, t.full_name)), p.headline && h('p', { class: 'small muted' }, p.headline), reviewSummary(revs),
          p.checks && p.checks.length ? h('div', { class: 'badges', style: 'margin-top:.4rem' }, p.checks.map(c => h('span', { class: 'badge' }, c))) : null)),
      h('details', {}, h('summary', {}, `See ${firstName(t.full_name)}'s full profile`), h('div', { style: 'margin-top:1rem' }, nannyProfileView(person, p, revs, { names: {} }))));
  }

  function reviewForm(b, t) {
    const rating = select('rating', [['5', '★★★★★  Excellent'], ['4', '★★★★  Very good'], ['3', '★★★  Good'], ['2', '★★  Not great'], ['1', '★  Poor']], '5');
    const form = h('form', { class: 'bk-box inline-form review-form' },
      h('h3', {}, `How was ${firstName(t.full_name)}?`),
      field('Your rating', rating),
      field('Your review', textarea('comment', '', 4, { required: true, maxlength: 3000 }), 'What went well? Would you book them again? We check reviews before they appear on their profile.'),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Send review')));
    return onSubmit(form, async f => {
      if (!f.comment.trim()) throw new Error('please write a few words about your nanny.');
      must(await db.from('reviews').insert({ booking_id: b.id, nanny_id: t.nanny_id, family_id: me.id, rating: Number(f.rating), comment: f.comment.trim() }));
    }, "Thank you! We'll publish your review after a quick check.");
  }

  function familyBookingCard(b) {
    const team = data.team.filter(t => t.booking_id === b.id);
    const needed = b.nannies_needed || 1;
    const nannyBox = h('div', { class: 'bk-box' }, h('h3', {}, needed > 1 ? 'Your nannies' : 'Your nanny'),
      team.length ? team.map(nannyCard)
        : h('p', { class: 'empty small' }, b.status === 'Cancelled' ? 'This booking was cancelled.' : "We're matching you with the right nanny. You'll see their profile here as soon as they're confirmed."),
      team.length && team.length < needed && b.status !== 'Cancelled' ? h('p', { class: 'small muted' }, `${team.length} of ${needed} nannies confirmed so far.`) : null);
    const reviews = b.status === 'Completed' ? team.filter(t => !data.reviews.some(r => r.booking_id === b.id && r.nanny_id === t.nanny_id)).map(t => reviewForm(b, t)) : [];
    return h('article', { class: 'card bk' }, bookingHeader(b), bookingFacts(b), bookingRequest(b), nannyBox, paymentBox(b),
      b.status === 'Confirmed' || b.status === 'Completed' ? updatesBox(b, true) : null, reviews);
  }

  function familyOverview(panel) {
    const upcoming = data.bookings.filter(b => isLive(b) && !isPast(b)).sort(byDate);
    const due = data.bookings.filter(isLive).reduce((s, b) => s + Math.max(0, balanceOf(data.payments[b.id]) || 0), 0);
    panel.append(h('div', { class: 'stat-row' },
      stat('Upcoming bookings', upcoming.length, () => goTo('bookings')),
      stat('Still to pay', money(due), () => goTo('payments')),
      stat('Hours to confirm', toConfirm().length, () => goTo('bookings')),
      stat('Reviews to write', reviewable().length, () => goTo('bookings'))));
    if (toConfirm().length) panel.append(h('div', { class: 'card blush' }, h('p', { style: 'margin:0' }, `Your nanny has logged hours waiting for you to confirm. `,
      h('button', { class: 'link-btn', type: 'button', onclick: () => goTo('bookings') }, 'Check them now'))));
    panel.append(h('h2', {}, 'Your next booking'));
    panel.append(upcoming.length ? familyBookingCard(upcoming[0])
      : h('div', { class: 'card' }, h('p', { style: 'margin-top:0' }, 'No upcoming bookings.'), h('a', { class: 'btn btn-primary btn-small', href: 'book.html' }, 'Request childcare')));
    const p = data.profile || {};
    panel.append(h('div', { class: 'card' }, h('h3', {}, 'Your family profile'),
      profileCompleteness([['family photo', p.photo_path], ['about your family', p.about], ['children', data.children.length], ['usual address', p.usual_address], ['emergency contact', p.emergency_contact_phone], ['notes for nannies', p.notes_for_nannies]]),
      h('p', { class: 'small muted' }, 'The more your nanny knows, the better they can care for your children.'),
      h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => goTo('family') }, 'Edit family profile')));
  }

  function familyBookings(panel) {
    const upcoming = data.bookings.filter(b => isLive(b) && !isPast(b)).sort(byDate);
    const past = data.bookings.filter(b => !upcoming.includes(b)).sort((a, b) => byDate(b, a));
    panel.append(h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary btn-small', href: 'book.html' }, 'Request new childcare')));
    panel.append(h('h2', {}, 'Upcoming bookings'));
    if (!upcoming.length) panel.append(h('p', { class: 'empty' }, 'No upcoming bookings.'));
    upcoming.forEach(b => panel.append(familyBookingCard(b)));
    if (past.length) panel.append(pastSection(past, familyBookingCard));
  }

  function familyPayments(panel) {
    const rows = data.bookings.filter(b => data.payments[b.id] && data.payments[b.id].family_total != null).sort((a, b) => byDate(b, a));
    const live = rows.filter(isLive);
    const outstanding = live.reduce((s, b) => s + Math.max(0, balanceOf(data.payments[b.id])), 0);
    const paid = rows.reduce((s, b) => s + Number(data.payments[b.id].amount_paid || 0), 0);
    panel.append(h('h2', {}, 'Payments'), h('div', { class: 'stat-row' }, stat('Still to pay', money(outstanding)), stat('Paid so far', money(paid))));
    if (!rows.length) { panel.append(h('p', { class: 'empty' }, 'No prices yet. You will see them here once your booking is confirmed.')); return; }
    panel.append(table(['Date', 'Booking', 'Total', 'Paid', 'To pay', 'Due by', 'Invoice'], rows.map(b => {
      const p = data.payments[b.id];
      const bal = balanceOf(p);
      return h('tr', {}, h('td', {}, fmtShort(b.booking_date)), h('td', {}, b.service, b.status === 'Cancelled' ? h('div', { class: 'small muted' }, 'Cancelled') : null),
        h('td', {}, money(p.family_total)), h('td', {}, money(p.amount_paid || 0)),
        h('td', {}, bal > 0 ? h('strong', {}, money(bal)) : 'Paid'), h('td', {}, bal > 0 && p.due_date ? fmtShort(p.due_date) : ''), h('td', {}, p.invoice_no || ''));
    })));
    panel.append(h('p', { class: 'small muted', style: 'margin:0' }, 'Questions about a payment? Email cameron@protravelnannies.com with your booking reference.'));
  }

  function familyProfile(panel) {
    const p = data.profile || {};
    panel.append(h('h2', {}, 'Our family profile'),
      h('p', { class: 'muted', style: 'margin:0' }, 'Your nanny sees this for your confirmed bookings, so they arrive knowing your children and your routines.'));
    panel.append(h('div', { class: 'card media-card' }, h('h3', {}, 'Family photo'),
      h('div', { class: 'person' }, avatar(p.photo_path, 96, me.full_name),
        h('div', {}, h('p', { class: 'small muted' }, 'Optional: helps your nanny recognise you when you meet.'),
          fileButton(p.photo_path ? 'Change photo' : 'Upload photo', 'image/jpeg,image/png,image/webp', async file => {
            const path = await uploadFile(file, 'photo');
            must(await db.from('family_profiles').upsert({ person_id: me.id, photo_path: path }));
            removeFiles([p.photo_path]);
          })))));

    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, 'About us'),
      h('div', { class: 'row' },
        field('Family name', input('family_name', p.family_name, 'text', { placeholder: 'e.g. The Smiths' })),
        field('Home country', input('home_country', p.home_country)),
        field('Languages spoken at home', input('languages_at_home', p.languages_at_home))),
      field('About our family', textarea('about', p.about, 4), 'A little about you, your trip and what you are hoping for from your nanny.'),
      field('Usual address or hotel', input('usual_address', p.usual_address)),
      h('div', { class: 'row' },
        field('Emergency contact name', input('emergency_contact_name', p.emergency_contact_name)),
        field('Emergency contact phone', input('emergency_contact_phone', p.emergency_contact_phone, 'tel'))),
      field('Pets', input('pets', p.pets)),
      field('House rules', textarea('house_rules', p.house_rules, 3), 'Screen time, snacks, bedtime, anything that matters to you.'),
      field('Anything else your nanny should know', textarea('notes_for_nannies', p.notes_for_nannies, 3)),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save family profile')));
    panel.append(onSubmit(form, async f => {
      must(await db.from('family_profiles').upsert({
        person_id: me.id, family_name: blank(f.family_name), home_country: blank(f.home_country), languages_at_home: blank(f.languages_at_home),
        about: blank(f.about), usual_address: blank(f.usual_address), emergency_contact_name: blank(f.emergency_contact_name),
        emergency_contact_phone: blank(f.emergency_contact_phone), pets: blank(f.pets), house_rules: blank(f.house_rules), notes_for_nannies: blank(f.notes_for_nannies)
      }));
    }, 'Family profile saved.'));

    panel.append(h('h2', {}, 'Our children'));
    if (!data.children.length) panel.append(h('p', { class: 'empty' }, 'Add each child so your nanny knows their age, allergies and routines.'));
    data.children.forEach(c => panel.append(childForm(c)));
    panel.append(h('details', { class: 'card', open: !data.children.length }, h('summary', {}, 'Add a child'), childForm(null)));
  }

  function childForm(c) {
    c = c || {};
    const form = h('form', { class: c.id ? 'card inline-form' : 'inline-form', style: c.id ? '' : 'margin-top:1rem' },
      c.id ? h('h3', {}, `${c.first_name}${c.date_of_birth ? ' · ' + ageOf(c.date_of_birth) : ''}`) : null,
      h('div', { class: 'row' }, field('First name', input('first_name', c.first_name, 'text', { required: true })), field('Date of birth', input('date_of_birth', c.date_of_birth, 'date', { max: today }))),
      field('Allergies', input('allergies', c.allergies, 'text', { placeholder: 'e.g. Nuts (EpiPen in the blue bag)' })),
      field('Medical needs or medication', input('medical', c.medical)),
      field('Loves', input('likes', c.likes, 'text', { placeholder: 'e.g. Dinosaurs, swimming, Bluey' })),
      field('Routine', textarea('routine', c.routine, 2), 'Naps, meals, bedtime, comforters.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, c.id ? 'Save' : 'Add child'),
        c.id && h('button', { class: 'link-btn small', type: 'button', onclick: () => { if (confirm(`Remove ${c.first_name}?`)) act(async () => { must(await db.from('children').delete().eq('id', c.id)); }, 'Removed.'); } }, 'Remove')));
    return onSubmit(form, async f => {
      if (!blank(f.first_name)) throw new Error("please add your child's first name.");
      const row = { family_id: me.id, first_name: blank(f.first_name), date_of_birth: blank(f.date_of_birth), allergies: blank(f.allergies), medical: blank(f.medical), likes: blank(f.likes), routine: blank(f.routine) };
      must(c.id ? await db.from('children').update(row).eq('id', c.id) : await db.from('children').insert(row));
    }, 'Saved.');
  }

  const FAMILY_TABS = [
    { id: 'overview', label: 'Overview', render: familyOverview },
    { id: 'bookings', label: 'Bookings', render: familyBookings, count: () => toConfirm().length + reviewable().length },
    { id: 'payments', label: 'Payments', render: familyPayments },
    { id: 'family', label: 'Family profile', render: familyProfile },
    { id: 'account', label: 'Account', render: accountPanel }
  ];

  // ---------- Admin ----------

  let editing = null; // { type: 'booking' | 'person', id }

  async function loadAdmin() {
    const [people, bookings, team, payments, updates, availability, nannies, families, reviews] = await Promise.all([
      db.from('people').select('*').order('full_name').then(must),
      db.from('bookings').select('*').order('booking_date', { ascending: false }).then(must),
      db.from('booking_nannies').select('*').then(must),
      db.from('booking_payments').select('*').then(must),
      db.from('booking_updates').select('*').order('created_at', { ascending: false }).limit(300).then(must),
      db.from('availability').select('*').gte('date_to', today).order('date_from').then(must),
      db.from('nanny_profiles').select('*').then(must),
      db.from('family_profiles').select('*').then(must),
      db.from('reviews').select('*').order('created_at', { ascending: false }).then(must)
    ]);
    const paths = [];
    nannies.forEach(n => paths.push(n.photo_path, n.video_path, ...(n.gallery_paths || [])));
    families.forEach(f => paths.push(f.photo_path));
    return {
      peopleList: people, people: byKey(people), names: Object.fromEntries(people.map(p => [p.id, p.full_name])),
      bookings, bookingsById: byKey(bookings), team, payments: byKey(payments, 'booking_id'), updates, availability,
      nannies: byKey(nannies, 'person_id'), families: byKey(families, 'person_id'), reviews, paths
    };
  }
  const nameOf = id => data.names[id] || '';

  function table(headers, rows) {
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, headers.map(x => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows)));
  }

  function nannyRow(r, nannies) {
    return h('div', { class: 'row team-row' },
      field('Nanny', select('t_nanny', [['', 'Choose…'], ...nannies.map(p => [p.id, p.full_name])], r.nanny_id || '')),
      field('Answer', select('t_response', [['offered', 'Offered (waiting)'], ['accepted', 'Accepted'], ['declined', 'Declined']], r.response || 'offered')),
      field('Nanny pay (€)', input('t_pay', r.nanny_pay, 'number', { step: '0.01', min: 0 })),
      field('Expenses (€)', input('t_exp', r.nanny_expenses, 'number', { step: '0.01', min: 0 })),
      field('Paid on', input('t_paid', r.nanny_paid_on, 'date')),
      field('Pay note', input('t_note', r.pay_note)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, ' '), h('button', { class: 'link-btn small', type: 'button', onclick: e => e.target.closest('.team-row').remove() }, 'Remove nanny')));
  }

  function bookingForm(b) {
    const fams = data.peopleList.filter(p => p.role === 'family');
    const nannies = data.peopleList.filter(p => p.role === 'nanny');
    if (!fams.length) return h('p', { class: 'card' }, 'Add the family on the People tab first.');
    b = b || { status: 'Confirmed', service: SERVICES[0], nannies_needed: 1 };
    const pay = (b.id && data.payments[b.id]) || {};
    const team = b.id ? data.team.filter(t => t.booking_id === b.id) : [];
    const teamBox = h('div', { class: 'team' }, (team.length ? team : [{}]).map(r => nannyRow(r, nannies)));
    const form = h('form', { class: 'form' },
      h('h3', {}, b.id ? 'Edit booking' : 'New booking'),
      h('fieldset', {}, h('legend', {}, 'The booking'),
        h('div', { class: 'row' },
          field('Booking ref', input('ref', b.ref), 'Same as the Google Sheet, e.g. PTN-2026-001'),
          field('Status', select('status', Object.entries(STATUS_LABEL), b.status)),
          field('Service', select('service', SERVICES.map(s => [s, s]), b.service))),
        h('div', { class: 'row' },
          field('Family', select('family_id', fams.map(p => [p.id, p.full_name]), b.family_id)),
          field('Event name (events only)', input('event_name', b.event_name)),
          field('Nannies needed', input('nannies_needed', b.nannies_needed, 'number', { min: 1, max: 30 }))),
        h('div', { class: 'row' },
          field('Date', input('booking_date', b.booking_date, 'date', { required: true })),
          field('End date (multi-day)', input('end_date', b.end_date, 'date')),
          field('Start time', input('start_time', fmtTime(b.start_time), 'time')),
          field('Finish time', input('end_time', fmtTime(b.end_time), 'time')),
          field('Total hours booked', input('hours_booked', b.hours_booked, 'number', { step: '0.25', min: 0 }))),
        h('div', { class: 'row' },
          field('Number of children', input('children_count', b.children_count, 'number', { min: 0 })),
          field('Children\'s ages', input('children_ages', b.children_ages, 'text', { placeholder: 'e.g. 2 and 6' })),
          field('Languages requested', input('languages_requested', b.languages_requested))),
        field('What the family asked for', textarea('family_requests', b.family_requests, 4), 'Shown to the nanny when you offer them the booking.'),
        field('Day-by-day plan (holiday / travel)', textarea('schedule', b.schedule, 3)),
        field('Travel details (travel nanny)', textarea('travel_details', b.travel_details, 2)),
        field('Address or meeting point', input('address', b.address)),
        field('Info for the nanny', textarea('info_for_nanny', b.info_for_nanny, 2), 'The family can see this too.')),
      h('fieldset', {}, h('legend', {}, 'Nanny or nannies (each nanny only sees their own pay)'), teamBox,
        h('div', {}, h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => teamBox.append(nannyRow({}, nannies)) }, 'Add another nanny'))),
      h('fieldset', {}, h('legend', {}, 'What the family pays (only the family sees this)'),
        field('Price breakdown', textarea('breakdown', pay.breakdown, 3), 'e.g. 4 hours × €32 = €128 (new line) Taxi home: €12'),
        h('div', { class: 'row' },
          field('Total (€)', input('family_total', pay.family_total, 'number', { step: '0.01', min: 0 })),
          field('Paid so far (€)', input('amount_paid', pay.amount_paid, 'number', { step: '0.01', min: 0 })),
          field('Due by', input('due_date', pay.due_date, 'date')),
          field('Invoice no.', input('invoice_no', pay.invoice_no))),
        field('Payment note', input('payment_note', pay.payment_note))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save booking'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { editing = null; render(); } }, 'Cancel'),
        b.id && h('button', { class: 'link-btn small', type: 'button', onclick: () => {
          if (confirm('Delete this booking with its pay, payments, hours and notes? This cannot be undone.')) act(async () => { must(await db.from('bookings').delete().eq('id', b.id)); editing = null; }, 'Booking deleted.');
        } }, 'Delete booking')));
    return onSubmit(form, async (f, el) => {
      if (!f.booking_date) throw new Error('please choose a date.');
      const row = {
        ref: blank(f.ref), status: f.status, service: f.service, family_id: f.family_id, event_name: blank(f.event_name),
        nannies_needed: Number(f.nannies_needed) || 1, booking_date: f.booking_date, end_date: blank(f.end_date),
        start_time: blank(f.start_time), end_time: blank(f.end_time), hours_booked: num(f.hours_booked),
        children_count: num(f.children_count), children_ages: blank(f.children_ages), languages_requested: blank(f.languages_requested),
        family_requests: blank(f.family_requests), schedule: blank(f.schedule), travel_details: blank(f.travel_details),
        address: blank(f.address), info_for_nanny: blank(f.info_for_nanny)
      };
      const saved = must(b.id ? await db.from('bookings').update(row).eq('id', b.id).select().single() : await db.from('bookings').insert(row).select().single());
      const rows = [...el.querySelectorAll('.team-row')].map(r => {
        const v = n => r.querySelector(`[name="${n}"]`).value;
        return { booking_id: saved.id, nanny_id: v('t_nanny'), response: v('t_response'), nanny_pay: num(v('t_pay')), nanny_expenses: num(v('t_exp')), nanny_paid_on: blank(v('t_paid')), pay_note: blank(v('t_note')) };
      }).filter(r => r.nanny_id);
      const ids = rows.map(r => r.nanny_id);
      if (new Set(ids).size !== ids.length) throw new Error('the same nanny is listed twice.');
      const old = data.team.filter(t => t.booking_id === saved.id);
      const gone = old.filter(t => !ids.includes(t.nanny_id)).map(t => t.nanny_id);
      if (gone.length) must(await db.from('booking_nannies').delete().eq('booking_id', saved.id).in('nanny_id', gone));
      rows.forEach(r => { const prev = old.find(t => t.nanny_id === r.nanny_id); r.responded_at = prev && prev.response === r.response ? prev.responded_at : (r.response === 'offered' ? null : new Date().toISOString()); });
      if (rows.length) must(await db.from('booking_nannies').upsert(rows));
      must(await db.from('booking_payments').upsert({
        booking_id: saved.id, breakdown: blank(f.breakdown), family_total: num(f.family_total), amount_paid: num(f.amount_paid) || 0,
        due_date: blank(f.due_date), invoice_no: blank(f.invoice_no), payment_note: blank(f.payment_note)
      }));
      editing = null;
    }, 'Booking saved.');
  }

  function adminBookings(panel) {
    panel.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { editing = { type: 'booking' }; render(); } }, 'Add a booking')));
    if (editing && editing.type === 'booking') panel.append(h('div', { class: 'card' }, bookingForm(editing.id && data.bookingsById[editing.id])));
    const teamText = b => {
      const t = data.team.filter(x => x.booking_id === b.id);
      if (!t.length) return h('span', { class: 'empty' }, 'Not assigned');
      return t.map(x => h('div', {}, nameOf(x.nanny_id), h('span', { class: 'small muted' }, ` (${x.response})`)));
    };
    const row = b => {
      const p = data.payments[b.id];
      const bal = balanceOf(p);
      return h('tr', {},
        h('td', {}, dateRange(b), timeRange(b) && h('div', { class: 'small muted' }, timeRange(b))),
        h('td', {}, b.service, b.ref && h('div', { class: 'small muted' }, b.ref)), h('td', {}, nameOf(b.family_id)),
        h('td', {}, teamText(b)),
        h('td', {}, p && p.family_total != null ? [money(p.family_total), h('div', { class: 'small muted' }, bal > 0 ? `${money(bal)} to pay` : 'Paid')] : ''),
        h('td', {}, statusPill(b)),
        h('td', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => { editing = { type: 'booking', id: b.id }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Edit')));
    };
    const heads = ['Date', 'Booking', 'Family', 'Nanny', 'Family pays', 'Status', ''];
    const upcoming = data.bookings.filter(b => isLive(b) && !isPast(b)).reverse();
    const past = data.bookings.filter(b => !upcoming.includes(b));
    panel.append(h('h2', {}, 'Upcoming'), upcoming.length ? table(heads, upcoming.map(row)) : h('p', { class: 'empty' }, 'No upcoming bookings.'));
    if (past.length) panel.append(h('details', {}, h('summary', {}, `Past and cancelled (${past.length})`), h('div', { style: 'margin-top:1rem' }, table(heads, past.map(row)))));
  }

  function personForm(p) {
    p = p || { role: 'nanny', can_log_in: true };
    const role = select('role', [['nanny', 'Nanny'], ['family', 'Family'], ['admin', 'Admin']], p.role);
    const np = (p.id && data.nannies[p.id]) || {};
    const nannyBits = h('fieldset', {}, h('legend', {}, 'Verified checks (only you can change these)'),
      checkGroup('Shown as badges on their profile', 'check', CHECKS, np.checks),
      h('p', { class: 'small muted', style: 'margin:0' }, 'The nanny fills in the rest of their profile (photo, video, bio) themselves after logging in.'));
    const sync = () => { nannyBits.hidden = role.value !== 'nanny'; };
    role.addEventListener('change', sync);
    sync();
    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, p.id ? 'Edit ' + p.full_name : 'Add a person'),
      h('div', { class: 'row' },
        field('Full name', input('full_name', p.full_name, 'text', { required: true })),
        field('Email', input('email', p.email, 'email', { required: true }), 'The email they will log in with'),
        field('Phone', input('phone', p.phone, 'tel')),
        field('Role', role)),
      h('label', { class: 'choice' }, h('input', { type: 'checkbox', name: 'can_log_in', value: 'yes', checked: p.can_log_in }), h('span', {}, 'Can log in')),
      nannyBits,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save'),
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { editing = null; render(); } }, 'Cancel')));
    return onSubmit(form, async (f, el) => {
      const row = { full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), phone: blank(f.phone), role: f.role, can_log_in: f.can_log_in === 'yes' };
      if (!row.full_name || !/^\S+@\S+\.\S+$/.test(row.email)) throw new Error('please enter a name and a valid email.');
      const saved = must(p.id ? await db.from('people').update(row).eq('id', p.id).select().single() : await db.from('people').insert(row).select().single());
      if (row.role === 'nanny') {
        const checks = checked(el, 'check');
        must(data.nannies[saved.id]
          ? await db.from('nanny_profiles').update({ checks }).eq('person_id', saved.id)
          : await db.from('nanny_profiles').insert({ person_id: saved.id, checks }));
      } else if (row.role === 'family' && !data.families[saved.id]) {
        must(await db.from('family_profiles').insert({ person_id: saved.id }));
      }
      editing = null;
    }, p.id ? 'Saved.' : 'Added. Tell them to go to protravelnannies.com/login.html and choose "First time here".');
  }

  function adminPeople(panel) {
    panel.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { editing = { type: 'person' }; render(); } }, 'Add a person')),
      h('p', { class: 'small muted', style: 'margin:0' }, 'Only people on this list can log in. Add a nanny once they have passed vetting, and a family once they have booked.'));
    if (editing && editing.type === 'person') panel.append(personForm(editing.id && data.people[editing.id]));
    for (const [role, title] of [['nanny', 'Nannies'], ['family', 'Families'], ['admin', 'Admins']]) {
      const list = data.peopleList.filter(p => p.role === role);
      if (!list.length) continue;
      panel.append(h('h2', {}, title), table(['', 'Name', 'Email', 'Phone', 'Logged in yet?', ''], list.map(p => {
        const prof = role === 'nanny' ? data.nannies[p.id] : role === 'family' ? data.families[p.id] : null;
        return h('tr', {},
          h('td', {}, avatar(prof && prof.photo_path, 40, p.full_name)),
          h('td', {}, p.full_name, !p.can_log_in && h('div', { class: 'small muted' }, 'Login switched off')),
          h('td', {}, p.email), h('td', {}, p.phone || ''), h('td', {}, p.user_id ? 'Yes' : 'Not yet'),
          h('td', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => { editing = { type: 'person', id: p.id }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Edit'),
            role === 'nanny' && prof ? h('details', {}, h('summary', { class: 'small' }, 'View profile'), h('div', { style: 'margin-top:.6rem;min-width:280px' }, nannyProfileView(p, prof, data.reviews.filter(r => r.nanny_id === p.id), { names: data.names }))) : null));
      })));
    }
  }

  function adminUpdates(panel) {
    const pending = data.updates.filter(u => !u.checked_by_admin_at);
    const done = data.updates.filter(u => u.checked_by_admin_at);
    const row = u => {
      const b = data.bookingsById[u.booking_id] || {};
      return h('tr', {},
        h('td', {}, fmtStamp(u.created_at)),
        h('td', {}, b.ref || b.service || '', h('div', { class: 'small muted' }, `${fmtShort(b.booking_date)} · ${nameOf(b.family_id)}`)),
        h('td', {}, nameOf(u.author_id)),
        h('td', {}, u.kind === 'hours' ? `${Number(u.hours)} h${u.work_date ? ' on ' + fmtShort(u.work_date) : ''}` : 'Note'),
        h('td', {}, u.note || ''),
        h('td', {}, u.kind === 'hours' ? (u.family_confirmed_at ? 'Yes' : 'Not yet') : ''),
        h('td', {}, u.checked_by_admin_at ? 'Checked' : h('button', { class: 'btn btn-primary btn-small', type: 'button',
          onclick: () => act(async () => { must(await db.from('booking_updates').update({ checked_by_admin_at: new Date().toISOString() }).eq('id', u.id)); }, 'Marked as checked.') }, 'Mark checked')));
    };
    const heads = ['Added', 'Booking', 'By', 'Type', 'Note', 'Family confirmed', ''];
    panel.append(h('h2', {}, 'To check'), h('p', { class: 'small muted', style: 'margin:0' }, 'Copy logged hours into the Google Sheet (Extra hours), then mark them checked.'),
      pending.length ? table(heads, pending.map(row)) : h('p', { class: 'empty' }, 'All caught up.'));
    if (done.length) panel.append(h('details', {}, h('summary', {}, `Already checked (${done.length})`), h('div', { style: 'margin-top:1rem' }, table(heads, done.map(row)))));
  }

  function adminReviews(panel) {
    const pending = data.reviews.filter(r => !r.published_at);
    const pub = data.reviews.filter(r => r.published_at);
    const row = r => h('tr', {},
      h('td', {}, new Date(r.created_at).toLocaleDateString('en-GB')), h('td', {}, nameOf(r.nanny_id)), h('td', {}, nameOf(r.family_id)),
      h('td', {}, stars(r.rating)), h('td', { class: 'pre' }, r.comment),
      h('td', {}, r.published_at
        ? h('button', { class: 'link-btn', type: 'button', onclick: () => act(async () => { must(await db.from('reviews').update({ published_at: null }).eq('id', r.id)); }, 'Review hidden.') }, 'Hide')
        : [h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => act(async () => { must(await db.from('reviews').update({ published_at: new Date().toISOString() }).eq('id', r.id)); }, 'Review published.') }, 'Publish'), ' ',
          h('button', { class: 'link-btn small', type: 'button', onclick: () => { if (confirm('Delete this review?')) act(async () => { must(await db.from('reviews').delete().eq('id', r.id)); }, 'Review deleted.'); } }, 'Delete')]));
    const heads = ['Date', 'Nanny', 'Family', 'Rating', 'Review', ''];
    panel.append(h('h2', {}, 'Waiting to be published'), pending.length ? table(heads, pending.map(row)) : h('p', { class: 'empty' }, 'No new reviews.'));
    if (pub.length) panel.append(h('h2', {}, 'Published'), table(heads, pub.map(row)));
  }

  function adminAvailability(panel) {
    panel.append(h('h2', {}, "Nannies' marked dates"));
    if (!data.availability.length) { panel.append(h('p', { class: 'empty' }, 'No upcoming dates marked.')); return; }
    panel.append(table(['Nanny', 'Dates', '', 'Note'], data.availability.map(a => h('tr', {},
      h('td', {}, nameOf(a.nanny_id)),
      h('td', {}, `${fmtDate(a.date_from)}${a.date_to !== a.date_from ? ' to ' + fmtDate(a.date_to) : ''}`),
      h('td', {}, a.available ? 'Available' : 'Not available'),
      h('td', {}, a.note || '')))));
  }

  const ADMIN_TABS = [
    { id: 'bookings', label: 'Bookings', render: adminBookings },
    { id: 'people', label: 'People', render: adminPeople },
    { id: 'updates', label: 'Hours & notes', render: adminUpdates, count: () => data.updates.filter(u => !u.checked_by_admin_at).length },
    { id: 'reviews', label: 'Reviews', render: adminReviews, count: () => data.reviews.filter(r => !r.published_at).length },
    { id: 'availability', label: 'Availability', render: adminAvailability },
    { id: 'account', label: 'Account', render: accountPanel }
  ];
})();
