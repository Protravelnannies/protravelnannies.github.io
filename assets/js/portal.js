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
  const safeUrl = u => (/^https:\/\//i.test(u || '') ? u : null);
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = isoDate(new Date());
  const fmtDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtShort = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const fmtStamp = t => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTime = t => (t ? t.slice(0, 5) : '');
  const dateRange = b => (b.end_date && b.end_date !== b.booking_date ? `${fmtDate(b.booking_date)} to ${fmtDate(b.end_date)}` : fmtDate(b.booking_date));
  const timeRange = b => [fmtTime(b.start_time), fmtTime(b.end_time)].filter(Boolean).join(' to ');
  const firstName = n => (n || '').trim().split(/\s+/)[0];
  const blank = v => (v === '' || v == null ? null : v);
  let idSeq = 0;

  function field(label, control, hint) {
    const id = 'pf' + (++idSeq);
    control.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('span', { class: 'hint' }, hint));
  }
  const input = (name, value, type = 'text', extra = {}) => h('input', { name, type, value: value ?? '', ...extra });
  const textarea = (name, value, rows = 3) => { const t = h('textarea', { name, rows }); t.value = value ?? ''; return t; };
  function select(name, options, value) {
    const s = h('select', { name });
    options.forEach(([v, label]) => s.append(h('option', { value: v }, label)));
    s.value = value ?? options[0][0];
    return s;
  }

  // Wraps a form submit: shows progress, reports errors, then refreshes the page data
  function onSubmit(form, handler, okText) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      say('Saving…');
      try {
        await handler(Object.fromEntries(new FormData(form)));
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
    if (/row-level security|permission/i.test(m)) return "You don't have permission to do that.";
    return 'Something went wrong: ' + m;
  }

  // ---------- Login page ----------

  if (loginRoot) {
    const emailForm = loginRoot.querySelector('[data-step=email]');
    const codeForm = loginRoot.querySelector('[data-step=code]');
    let email = '';

    db.auth.getSession().then(({ data }) => { if (data.session) location.replace('account.html'); });

    emailForm.addEventListener('submit', async e => {
      e.preventDefault();
      email = emailForm.email.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) { say('Please enter a valid email address.', 'error'); return; }
      const btn = emailForm.querySelector('button');
      btn.disabled = true;
      say('Sending your code…');
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
          say("Sorry, we couldn't send the code: " + error.message, 'error');
        }
        return;
      }
      loginRoot.querySelector('[data-sent-to]').textContent = email;
      emailForm.hidden = true;
      codeForm.hidden = false;
      say('');
      codeForm.code.focus();
    });

    codeForm.addEventListener('submit', async e => {
      e.preventDefault();
      const token = codeForm.code.value.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(token)) { say('Please enter the code from the email.', 'error'); return; }
      const btn = codeForm.querySelector('[type=submit]');
      btn.disabled = true;
      say('Checking…');
      const { error } = await db.auth.verifyOtp({ email, token, type: 'email' });
      btn.disabled = false;
      if (error) { say('That code is wrong or has expired. Please try again or request a new one.', 'error'); return; }
      location.replace('account.html');
    });

    loginRoot.querySelector('[data-restart]').addEventListener('click', () => {
      codeForm.hidden = true;
      emailForm.hidden = false;
      codeForm.code.value = '';
      say('');
      emailForm.email.focus();
    });
    return;
  }

  // ---------- Account page ----------

  const wrap = accountRoot.querySelector('.wrap');
  const view = h('div');
  wrap.prepend(view);
  let me = null;
  let data = {};
  let tabs = [];
  let activeTab = decodeURIComponent(location.hash.slice(1)) || '';

  start();

  async function start() {
    const { data: s } = await db.auth.getSession();
    if (!s.session) { location.replace('login.html'); return; }
    const { data: person, error } = await db.from('people').select('*').eq('user_id', s.session.user.id).maybeSingle();
    if (error || !person) {
      view.replaceChildren(h('div', { class: 'card portal-narrow' },
        h('h1', {}, 'Your account isn\'t ready yet'),
        h('p', {}, 'Please email cameron@protravelnannies.com and we\'ll set it up.'),
        signOutButton()));
      say('');
      return;
    }
    me = person;
    tabs = me.role === 'admin' ? ADMIN_TABS : me.role === 'nanny' ? NANNY_TABS : FAMILY_TABS;
    if (!tabs.some(t => t.id === activeTab)) activeTab = tabs[0].id;
    await refresh();
    say('');
  }

  async function refresh() {
    data = await (me.role === 'admin' ? loadAdmin() : me.role === 'nanny' ? loadNanny() : loadFamily());
    render();
  }

  function signOutButton() {
    return h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: async () => { await db.auth.signOut(); location.replace('login.html'); } }, 'Log out');
  }

  function render() {
    const roleLabel = { admin: 'Admin', nanny: 'Nanny account', family: 'Family account' }[me.role];
    const tabBar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(t =>
      h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(t.id === activeTab),
        onclick: () => { activeTab = t.id; history.replaceState(null, '', '#' + t.id); say(''); render(); }
      }, t.label)));
    const panel = h('div', { class: 'portal-panel', role: 'tabpanel' });
    tabs.find(t => t.id === activeTab).render(panel);
    view.replaceChildren(
      h('div', { class: 'portal-head' },
        h('div', {}, h('p', { class: 'eyebrow left' }, roleLabel), h('h1', {}, `Hello, ${firstName(me.full_name)}`), tabBar),
        signOutButton()),
      panel);
  }

  // ---------- Shared pieces ----------

  const byId = list => Object.fromEntries((list || []).map(x => [x.id || x.person_id, x]));
  const isUpcoming = b => (b.end_date || b.booking_date) >= today && b.status !== 'Cancelled';
  const nameOf = id => (data.people[id] ? data.people[id].full_name : id === me.id ? me.full_name : 'Pro Travel Nannies');

  async function loadUpdates(bookingIds) {
    if (!bookingIds.length) return [];
    return must(await db.from('booking_updates').select('*').in('booking_id', bookingIds).order('created_at'));
  }

  function bookingList(panel, bookings, card) {
    const upcoming = bookings.filter(isUpcoming).sort((a, b) => a.booking_date.localeCompare(b.booking_date));
    const past = bookings.filter(b => !isUpcoming(b)).sort((a, b) => b.booking_date.localeCompare(a.booking_date));
    panel.append(h('h2', {}, 'Upcoming bookings'));
    if (!upcoming.length) panel.append(h('p', { class: 'empty' }, 'No upcoming bookings yet.'));
    upcoming.forEach(b => panel.append(card(b)));
    if (past.length) {
      const d = h('details', {}, h('summary', {}, `Past and cancelled bookings (${past.length})`));
      const inner = h('div', { class: 'portal-panel', style: 'margin-top:1rem' });
      past.forEach(b => inner.append(card(b)));
      d.append(inner);
      panel.append(d);
    }
  }

  function bookingDetails(b, extraRows = []) {
    const rows = [
      ['Time', timeRange(b)],
      ['Service', b.service],
      ...extraRows,
      ['Children', b.children],
      ['Address', b.address],
      ['Info for the nanny', b.info_for_nanny],
      ['Booking ref', b.ref]
    ].filter(([, v]) => v);
    return h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  function bookingTop(b) {
    return h('div', { class: 'bk-top' }, h('p', { class: 'bk-date' }, dateRange(b)), h('span', { class: 'status ' + b.status }, b.status));
  }

  function updatesBox(b) {
    const list = data.updates.filter(u => u.booking_id === b.id);
    const box = h('div', { class: 'bk-box' }, h('h3', {}, 'Hours and notes'));
    if (!list.length) box.append(h('p', { class: 'empty small' }, 'Nothing added yet.'));
    else box.append(h('ul', { class: 'updates' }, list.map(u => {
      const who = u.author_id === me.id ? 'You' : nameOf(u.author_id);
      const title = u.kind === 'hours'
        ? `${who} logged ${Number(u.hours)} hour${Number(u.hours) === 1 ? '' : 's'}${u.work_date ? ' for ' + fmtShort(u.work_date) : ''}`
        : `${who} added a note`;
      const states = [];
      if (u.kind === 'hours') states.push(u.family_confirmed_at ? 'Confirmed by family' : 'Waiting for family to confirm');
      if (u.checked_by_admin_at) states.push('Checked by Pro Travel Nannies');
      const li = h('li', {}, h('strong', {}, title), u.note && h('div', {}, u.note),
        h('div', { class: 'meta' }, [fmtStamp(u.created_at), ...states].join(' · ')));
      if (me.role === 'family' && u.kind === 'hours' && !u.family_confirmed_at) {
        li.append(h('button', { class: 'btn btn-primary btn-small', type: 'button',
          onclick: () => act(async () => { must(await db.rpc('confirm_hours', { update_id: u.id })); }, 'Thanks, hours confirmed.') }, 'Confirm these hours'));
      }
      if (u.author_id === me.id && !u.family_confirmed_at && !u.checked_by_admin_at) {
        li.append(' ', h('button', { class: 'link-btn small', type: 'button',
          onclick: () => { if (confirm('Remove this?')) act(async () => { must(await db.from('booking_updates').delete().eq('id', u.id)); }, 'Removed.'); } }, 'Remove'));
      }
      return li;
    })));
    if (b.status === 'Confirmed' || b.status === 'Completed') box.append(addUpdateForm(b));
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
        work_date: isHours ? blank(f.work_date) : null, hours: isHours ? Number(f.hours) : null, note: blank(f.note.trim())
      }));
    }, 'Added.');
  }

  function personCard(p, profile) {
    const photo = safeUrl(profile && profile.photo_url);
    const video = safeUrl(profile && profile.video_url);
    return h('div', { class: 'person' },
      photo ? h('img', { src: photo, alt: '' }) : null,
      h('div', {},
        h('p', {}, h('strong', {}, p ? p.full_name : '')),
        profile && profile.about && h('p', {}, profile.about),
        profile && profile.languages && h('p', { class: 'small muted' }, 'Languages: ' + profile.languages),
        profile && profile.checks && profile.checks.length ? h('div', { class: 'badges', style: 'margin:.5rem 0' }, profile.checks.map(c => h('span', { class: 'badge' }, c))) : null,
        video && h('a', { class: 'text-link', href: video, target: '_blank', rel: 'noopener' }, 'Watch intro video')));
  }

  // ---------- Nanny ----------

  async function loadNanny() {
    const bookings = must(await db.from('bookings').select('*').eq('nanny_id', me.id).order('booking_date'));
    const familyIds = [...new Set(bookings.map(b => b.family_id))];
    const [people, families, updates, availability, profile] = await Promise.all([
      familyIds.length ? db.from('people').select('id, full_name, phone, email').in('id', familyIds).then(must) : [],
      familyIds.length ? db.from('family_profiles').select('*').in('person_id', familyIds).then(must) : [],
      loadUpdates(bookings.map(b => b.id)),
      db.from('availability').select('*').eq('nanny_id', me.id).order('date_from').then(must),
      db.from('nanny_profiles').select('*').eq('person_id', me.id).maybeSingle().then(must)
    ]);
    return { bookings, people: byId(people), families: byId(families), updates, availability, profile };
  }

  function nannyBookingCard(b) {
    const fam = data.people[b.family_id];
    const fp = data.families[b.family_id] || {};
    const famBox = h('div', { class: 'bk-box' }, h('h3', {}, 'The family'),
      h('dl', {}, [
        ['Name', fam && fam.full_name],
        ['Phone', fam && fam.phone],
        ['Children', fp.children],
        ['Allergies and medical', fp.allergies_medical],
        ['Notes for nannies', fp.notes_for_nannies]
      ].filter(([, v]) => v).map(([k, v]) => [h('dt', {}, k), h('dd', {}, k === 'Phone' ? h('a', { href: 'tel:' + v.replace(/[^\d+]/g, '') }, v) : v)])));
    return h('article', { class: 'card bk' }, bookingTop(b), bookingDetails(b), famBox, updatesBox(b));
  }

  function nannyCalendar(panel) {
    let month = new Date(); month.setDate(1);
    const holder = h('div', { class: 'card cal' });
    const draw = () => {
      const y = month.getFullYear(), m = month.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-day out', 'aria-hidden': 'true' }));
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
        const booked = data.bookings.some(b => b.status !== 'Cancelled' && b.booking_date <= iso && (b.end_date || b.booking_date) >= iso);
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
      h('p', { class: 'muted' }, "Mark the dates you're away or especially keen to work, so we only offer you bookings that suit you."));
    nannyCalendar(panel);
    const st = select('available', [['false', 'Not available'], ['true', 'Available']], 'false');
    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, 'Add dates'),
      h('div', { class: 'row' }, field('From', input('date_from', today, 'date', { required: true })), field('To', input('date_to', today, 'date', { required: true })), field('I am', st)),
      field('Note (optional)', input('note', '')),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Add dates')));
    panel.append(onSubmit(form, async f => {
      if (f.date_to < f.date_from) throw new Error('the "To" date must be on or after the "From" date.');
      must(await db.from('availability').insert({ nanny_id: me.id, date_from: f.date_from, date_to: f.date_to, available: f.available === 'true', note: blank(f.note.trim()) }));
    }, 'Dates added.'));
    const upcoming = data.availability.filter(a => a.date_to >= today);
    panel.append(h('h2', {}, 'Dates you have marked'));
    if (!upcoming.length) panel.append(h('p', { class: 'empty' }, 'None yet.'));
    else panel.append(h('ul', { class: 'updates' }, upcoming.map(a => h('li', {},
      h('strong', {}, `${fmtDate(a.date_from)}${a.date_to !== a.date_from ? ' to ' + fmtDate(a.date_to) : ''}: ${a.available ? 'Available' : 'Not available'}`),
      a.note && h('div', {}, a.note), ' ',
      h('button', { class: 'link-btn small', type: 'button', onclick: () => act(async () => { must(await db.from('availability').delete().eq('id', a.id)); }, 'Removed.') }, 'Remove')))));
  }

  function nannyProfile(panel) {
    const p = data.profile;
    panel.append(h('h2', {}, 'My profile'));
    if (!p) { panel.append(h('p', { class: 'empty' }, "Your profile hasn't been set up yet. Cameron will add it shortly.")); return; }
    panel.append(h('div', { class: 'card' }, h('p', { class: 'small muted' }, 'This is how families see you on their bookings.'), personCard(me, p)));
    const form = h('form', { class: 'card inline-form' },
      field('About me', textarea('about', p.about, 5), 'A few friendly sentences: your experience, what you love doing with children.'),
      h('div', { class: 'row' }, field('Languages', input('languages', p.languages)), field('Areas I cover', input('areas', p.areas))),
      h('p', { class: 'small muted' }, `Email: ${me.email}${me.phone ? ' · Phone: ' + me.phone : ''}. To change these, your photo or your video, email cameron@protravelnannies.com.`),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save profile')));
    panel.append(onSubmit(form, async f => {
      must(await db.from('nanny_profiles').update({ about: blank(f.about.trim()), languages: blank(f.languages.trim()), areas: blank(f.areas.trim()) }).eq('person_id', me.id));
    }, 'Profile saved.'));
  }

  const NANNY_TABS = [
    { id: 'bookings', label: 'My bookings', render: panel => bookingList(panel, data.bookings, nannyBookingCard) },
    { id: 'calendar', label: 'My calendar', render: nannyAvailability },
    { id: 'profile', label: 'My profile', render: nannyProfile }
  ];

  // ---------- Family ----------

  async function loadFamily() {
    const bookings = must(await db.from('bookings').select('*').eq('family_id', me.id).order('booking_date'));
    const nannyIds = [...new Set(bookings.map(b => b.nanny_id).filter(Boolean))];
    const [people, nannies, updates, profile] = await Promise.all([
      nannyIds.length ? db.from('people').select('id, full_name').in('id', nannyIds).then(must) : [],
      nannyIds.length ? db.from('nanny_profiles').select('*').in('person_id', nannyIds).then(must) : [],
      loadUpdates(bookings.map(b => b.id)),
      db.from('family_profiles').select('*').eq('person_id', me.id).maybeSingle().then(must)
    ]);
    return { bookings, people: byId(people), nannies: byId(nannies), updates, profile };
  }

  function familyBookingCard(b) {
    const showNanny = b.nanny_id && data.people[b.nanny_id] && (b.status === 'Confirmed' || b.status === 'Completed');
    const nannyBox = h('div', { class: 'bk-box' }, h('h3', {}, 'Your nanny'),
      showNanny ? personCard(data.people[b.nanny_id], data.nannies[b.nanny_id])
        : h('p', { class: 'empty small' }, b.status === 'Enquiry' ? "We're finding the right nanny for you. You'll see them here once it's confirmed." : 'No nanny assigned.'));
    return h('article', { class: 'card bk' }, bookingTop(b), bookingDetails(b), nannyBox, b.status !== 'Enquiry' ? updatesBox(b) : null);
  }

  function familyDetails(panel) {
    const p = data.profile || {};
    panel.append(h('h2', {}, 'Our details'),
      h('p', { class: 'muted' }, 'Your nanny can see these details for your bookings, so they always have the latest information.'));
    const form = h('form', { class: 'card inline-form' },
      field('Children (names and ages)', textarea('children', p.children, 2)),
      field('Allergies and medical information', textarea('allergies_medical', p.allergies_medical, 3), 'Include any medication and where it is kept.'),
      field('Usual address or hotel', input('usual_address', p.usual_address)),
      field('Notes for nannies', textarea('notes_for_nannies', p.notes_for_nannies, 4), 'Routines, naps, bedtimes, favourite things, house rules.'),
      h('p', { class: 'small muted' }, `Email: ${me.email}${me.phone ? ' · Phone: ' + me.phone : ''}. To change these, email cameron@protravelnannies.com.`),
      h('div', {}, h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save details')));
    panel.append(onSubmit(form, async f => {
      must(await db.from('family_profiles').upsert({
        person_id: me.id, children: blank(f.children.trim()), allergies_medical: blank(f.allergies_medical.trim()),
        usual_address: blank(f.usual_address.trim()), notes_for_nannies: blank(f.notes_for_nannies.trim())
      }));
    }, 'Details saved.'));
  }

  const FAMILY_TABS = [
    { id: 'bookings', label: 'Our bookings', render: panel => bookingList(panel, data.bookings, familyBookingCard) },
    { id: 'details', label: 'Our details', render: familyDetails }
  ];

  // ---------- Admin ----------

  const SERVICES = ['Babysitting', 'Holiday nanny', 'Travel nanny', 'Weddings & events', 'Overnight care', 'Newborn & infant care'];
  const STATUSES = ['Enquiry', 'Confirmed', 'Completed', 'Cancelled'];
  const CHECKS = ['ID verified', 'Video interview', 'References checked', 'Sex-offence certificate checked', 'First aid', 'Self-employed (autónomo)'];
  let editing = null; // { type: 'booking' | 'person', id }

  async function loadAdmin() {
    const [people, bookings, updates, availability, nannies, families] = await Promise.all([
      db.from('people').select('*').order('full_name').then(must),
      db.from('bookings').select('*').order('booking_date', { ascending: false }).then(must),
      db.from('booking_updates').select('*').order('created_at', { ascending: false }).limit(300).then(must),
      db.from('availability').select('*').gte('date_to', today).order('date_from').then(must),
      db.from('nanny_profiles').select('*').then(must),
      db.from('family_profiles').select('*').then(must)
    ]);
    return { peopleList: people, people: byId(people), bookings, bookingsById: byId(bookings), updates, availability, nannies: byId(nannies), families: byId(families) };
  }

  function table(headers, rows) {
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, headers.map(x => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, rows)));
  }

  function bookingForm(b) {
    const fams = data.peopleList.filter(p => p.role === 'family');
    const nannies = data.peopleList.filter(p => p.role === 'nanny');
    if (!fams.length) return h('p', { class: 'card' }, 'Add the family on the People tab first.');
    b = b || { status: 'Confirmed', service: SERVICES[0] };
    const form = h('form', { class: 'card inline-form' },
      h('h3', {}, b.id ? 'Edit booking' : 'New booking'),
      h('div', { class: 'row' },
        field('Booking ref', input('ref', b.ref), 'Same as in the Google Sheet, e.g. PTN-2026-001'),
        field('Status', select('status', STATUSES.map(s => [s, s]), b.status)),
        field('Service', select('service', SERVICES.map(s => [s, s]), b.service))),
      h('div', { class: 'row' },
        field('Family', select('family_id', fams.map(p => [p.id, p.full_name]), b.family_id)),
        field('Nanny', select('nanny_id', [['', 'Not assigned yet'], ...nannies.map(p => [p.id, p.full_name])], b.nanny_id || ''))),
      h('div', { class: 'row' },
        field('Date', input('booking_date', b.booking_date, 'date', { required: true })),
        field('End date (multi-day)', input('end_date', b.end_date, 'date')),
        field('Start time', input('start_time', fmtTime(b.start_time), 'time')),
        field('Finish time', input('end_time', fmtTime(b.end_time), 'time'))),
      field('Children on this booking', input('children', b.children)),
      field('Address or meeting point', input('address', b.address)),
      field('Info for the nanny', textarea('info_for_nanny', b.info_for_nanny, 3), 'Both the nanny and the family can see this.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save booking'),
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { editing = null; render(); } }, 'Cancel'),
        b.id && h('button', { class: 'link-btn small', type: 'button', onclick: () => {
          if (confirm('Delete this booking and its hours and notes? This cannot be undone.')) act(async () => { must(await db.from('bookings').delete().eq('id', b.id)); editing = null; }, 'Booking deleted.');
        } }, 'Delete booking')));
    return onSubmit(form, async f => {
      if (!f.booking_date) throw new Error('please choose a date.');
      const row = {
        ref: blank(f.ref.trim()), status: f.status, service: f.service, family_id: f.family_id, nanny_id: blank(f.nanny_id),
        booking_date: f.booking_date, end_date: blank(f.end_date), start_time: blank(f.start_time), end_time: blank(f.end_time),
        children: blank(f.children.trim()), address: blank(f.address.trim()), info_for_nanny: blank(f.info_for_nanny.trim())
      };
      must(b.id ? await db.from('bookings').update(row).eq('id', b.id) : await db.from('bookings').insert(row));
      editing = null;
    }, 'Booking saved.');
  }

  function adminBookings(panel) {
    panel.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { editing = { type: 'booking' }; render(); } }, 'Add a booking')));
    if (editing && editing.type === 'booking') panel.append(bookingForm(editing.id && data.bookingsById[editing.id]));
    const row = b => h('tr', {},
      h('td', {}, dateRange(b), timeRange(b) && h('div', { class: 'small muted' }, timeRange(b))),
      h('td', {}, b.ref || ''), h('td', {}, b.service), h('td', {}, nameOf(b.family_id)),
      h('td', {}, b.nanny_id ? nameOf(b.nanny_id) : h('span', { class: 'empty' }, 'Not assigned')),
      h('td', {}, h('span', { class: 'status ' + b.status }, b.status)),
      h('td', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => { editing = { type: 'booking', id: b.id }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Edit')));
    const heads = ['Date', 'Ref', 'Service', 'Family', 'Nanny', 'Status', ''];
    const upcoming = data.bookings.filter(isUpcoming).reverse();
    const past = data.bookings.filter(b => !isUpcoming(b));
    panel.append(h('h2', {}, 'Upcoming'), upcoming.length ? table(heads, upcoming.map(row)) : h('p', { class: 'empty' }, 'No upcoming bookings.'));
    if (past.length) panel.append(h('details', {}, h('summary', {}, `Past and cancelled (${past.length})`), h('div', { style: 'margin-top:1rem' }, table(heads, past.map(row)))));
  }

  function personForm(p) {
    p = p || { role: 'nanny', can_log_in: true };
    const role = select('role', [['nanny', 'Nanny'], ['family', 'Family'], ['admin', 'Admin']], p.role);
    const np = (p.id && data.nannies[p.id]) || {};
    const fp = (p.id && data.families[p.id]) || {};
    const nannyBits = h('fieldset', {}, h('legend', {}, 'Nanny profile'),
      field('About', textarea('about', np.about, 4)),
      h('div', { class: 'row' }, field('Languages', input('languages', np.languages)), field('Areas covered', input('areas', np.areas))),
      field('Photo link', input('photo_url', np.photo_url, 'url'), 'A https:// link to the photo'),
      field('Intro video link', input('video_url', np.video_url, 'url'), 'e.g. an unlisted YouTube link'),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Checks completed (shown as badges)'),
        h('div', { class: 'choices' }, CHECKS.map(c => h('label', { class: 'choice' },
          h('input', { type: 'checkbox', name: 'check', value: c, checked: (np.checks || []).includes(c) }), h('span', {}, c))))));
    const familyBits = h('fieldset', {}, h('legend', {}, 'Family details'),
      field('Children (names and ages)', textarea('children', fp.children, 2)),
      field('Allergies and medical', textarea('allergies_medical', fp.allergies_medical, 2)),
      field('Usual address or hotel', input('usual_address', fp.usual_address)),
      field('Notes for nannies', textarea('notes_for_nannies', fp.notes_for_nannies, 3)));
    const sync = () => { nannyBits.hidden = role.value !== 'nanny'; familyBits.hidden = role.value !== 'family'; };
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
      nannyBits, familyBits,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Save'),
        h('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: () => { editing = null; render(); } }, 'Cancel')));
    return onSubmit(form, async f => {
      const checks = [...form.querySelectorAll('input[name=check]:checked')].map(i => i.value);
      const row = { full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), phone: blank(f.phone.trim()), role: f.role, can_log_in: f.can_log_in === 'yes' };
      if (!row.full_name || !/^\S+@\S+\.\S+$/.test(row.email)) throw new Error('please enter a name and a valid email.');
      const saved = must(p.id ? await db.from('people').update(row).eq('id', p.id).select().single() : await db.from('people').insert(row).select().single());
      if (row.role === 'nanny') {
        must(await db.from('nanny_profiles').upsert({
          person_id: saved.id, about: blank(f.about.trim()), languages: blank(f.languages.trim()), areas: blank(f.areas.trim()),
          photo_url: safeUrl(f.photo_url.trim()), video_url: safeUrl(f.video_url.trim()), checks
        }));
      } else if (row.role === 'family') {
        must(await db.from('family_profiles').upsert({
          person_id: saved.id, children: blank(f.children.trim()), allergies_medical: blank(f.allergies_medical.trim()),
          usual_address: blank(f.usual_address.trim()), notes_for_nannies: blank(f.notes_for_nannies.trim())
        }));
      }
      editing = null;
    }, 'Saved. They can now log in with their email.');
  }

  function adminPeople(panel) {
    panel.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { editing = { type: 'person' }; render(); } }, 'Add a person')),
      h('p', { class: 'small muted', style: 'margin:0' }, 'Only people on this list can log in. Add a nanny once they have passed vetting, and a family once they have booked.'));
    if (editing && editing.type === 'person') panel.append(personForm(editing.id && data.people[editing.id]));
    for (const [role, title] of [['nanny', 'Nannies'], ['family', 'Families'], ['admin', 'Admins']]) {
      const list = data.peopleList.filter(p => p.role === role);
      if (!list.length) continue;
      panel.append(h('h2', {}, title), table(['Name', 'Email', 'Phone', 'Logged in yet?', ''], list.map(p => h('tr', {},
        h('td', {}, p.full_name, !p.can_log_in && h('div', { class: 'small muted' }, 'Login switched off')),
        h('td', {}, p.email), h('td', {}, p.phone || ''), h('td', {}, p.user_id ? 'Yes' : 'Not yet'),
        h('td', {}, h('button', { class: 'link-btn', type: 'button', onclick: () => { editing = { type: 'person', id: p.id }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Edit'))))));
    }
  }

  function adminUpdates(panel) {
    const pending = data.updates.filter(u => !u.checked_by_admin_at);
    const done = data.updates.filter(u => u.checked_by_admin_at);
    const row = u => {
      const b = data.bookingsById[u.booking_id] || {};
      return h('tr', {},
        h('td', {}, fmtStamp(u.created_at)),
        h('td', {}, b.ref || '', h('div', { class: 'small muted' }, `${fmtShort(b.booking_date)} · ${nameOf(b.family_id)}`)),
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
    { id: 'updates', label: 'Hours & notes', render: adminUpdates },
    { id: 'availability', label: 'Availability', render: adminAvailability }
  ];
})();
