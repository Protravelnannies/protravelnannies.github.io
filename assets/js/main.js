/* Pro Travel Nannies: shared site behaviour */
document.documentElement.classList.add('js');

// WhatsApp number for the floating chat bubble on every page.
// Write it in international format, digits only: country code + number,
// no "+", spaces or leading zero (e.g. Spain +34 612 345 678 -> '34612345678').
// While it is empty, the bubble opens the contact page instead.
const WHATSAPP_NUMBER = '';
const WHATSAPP_MESSAGE = "Hi Pro Travel Nannies! I'd like to ask about childcare.";

document.addEventListener('DOMContentLoaded', () => {
  // Floating WhatsApp bubble
  const wa = document.createElement('a');
  wa.className = 'wa-bubble';
  wa.href = WHATSAPP_NUMBER
    ? 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(WHATSAPP_MESSAGE)
    : 'contact.html';
  if (WHATSAPP_NUMBER) { wa.target = '_blank'; wa.rel = 'noopener'; }
  wa.setAttribute('aria-label', 'Chat with us on WhatsApp');
  wa.innerHTML = '<span class="wa-label">Chat with us</span>' +
    '<span class="wa-icon"><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3C8.8 3 3 8.7 3 15.8c0 2.5.7 4.9 2 7L3 29l6.4-2c2 1.1 4.3 1.7 6.6 1.7 7.2 0 13-5.7 13-12.8S23.2 3 16 3zm0 23.4c-2.1 0-4.1-.6-5.9-1.7l-.4-.3-3.8 1.2 1.2-3.7-.3-.4c-1.2-1.8-1.8-3.8-1.8-5.9C5 10 9.9 5.2 16 5.2S27 10 27 15.9s-4.9 10.5-11 10.5zm6-7.8c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.8.2-.2.3-.9 1.1-1.1 1.3-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.7-1.7-1-.9-1.7-2-1.9-2.3-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6-.1-.2-.8-1.8-1-2.5-.3-.7-.5-.6-.8-.6h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.7s1.2 3.2 1.4 3.4c.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 2-.8 2.2-1.6.3-.8.3-1.4.2-1.6-.1-.1-.3-.2-.6-.3z"/></svg></span>';
  document.body.appendChild(wa);

  // Sticky header border once the page scrolls
  const header = document.querySelector('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mobile menu
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      // The header is taller on phones (buttons on a second row), so open the menu right below it
      const bottom = header.getBoundingClientRect().bottom;
      nav.style.top = bottom + 'px';
      nav.style.maxHeight = 'calc(100vh - ' + bottom + 'px)';
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.querySelector('span').textContent = open ? 'Close' : 'Menu';
    });
  }

  // Dropdown groups
  document.querySelectorAll('.nav-group > button').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const group = btn.parentElement;
      const open = !group.classList.contains('open');
      document.querySelectorAll('.nav-group.open').forEach(g => { g.classList.remove('open'); g.querySelector('button').setAttribute('aria-expanded', 'false'); });
      group.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-group.open').forEach(g => { g.classList.remove('open'); g.querySelector('button').setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.nav-group.open').forEach(g => g.classList.remove('open'));
  });

  // Mark the current page in the nav
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.main-nav a').forEach(a => {
    if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
  });

  // Tabs: <div class="tabs" data-tabs> <button data-tab="x"> ... panels: <div data-panel="x">
  document.querySelectorAll('[data-tabs]').forEach(tabs => {
    const buttons = tabs.querySelectorAll('button[data-tab]');
    const scope = tabs.closest('[data-tab-scope]') || document;
    const show = name => {
      buttons.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
      scope.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== name; });
    };
    buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    const fromHash = location.hash.replace('#', '');
    const initial = [...buttons].find(b => b.dataset.tab === fromHash) || buttons[0];
    if (initial) show(initial.dataset.tab);
  });

  // Reveal on scroll
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  // Forms: client-side validation + confirmation state.
  // Each form posts to Web3Forms (data-endpoint), which emails hello@protravelnannies.com.
  document.querySelectorAll('form[data-form]').forEach(form => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const endpoint = form.dataset.endpoint;
      const btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        if (endpoint) {
          // Join multi-select checkboxes into one line so every choice arrives in the email
          const data = {};
          new FormData(form).forEach((value, key) => {
            data[key] = key in data ? data[key] + ', ' + value : value;
          });
          const who = data.name || [data.first_name, data.last_name].filter(Boolean).join(' ');
          if (data.subject && who) data.subject += ' from ' + who;
          if (data.email) data.replyto = data.email;
          const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || json.success === false) throw new Error('Request failed');
        }
        const success = document.getElementById(form.dataset.success);
        form.hidden = true;
        if (success) { success.hidden = false; success.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
        alert('Sorry, something went wrong sending your form. Please email us at hello@protravelnannies.com instead.');
      }
    });
  });

  // Cookie notice (only essential cookies are used until analytics are added)
  const bar = document.querySelector('.cookie-bar');
  if (bar) {
    let seen = null;
    try { seen = localStorage.getItem('ptn-cookies'); } catch (e) {}
    const setBar = open => { bar.hidden = !open; document.body.classList.toggle('cookie-open', open); };
    if (!seen) setBar(true);
    bar.querySelectorAll('[data-cookie]').forEach(b => b.addEventListener('click', () => {
      try { localStorage.setItem('ptn-cookies', b.dataset.cookie); } catch (e) {}
      setBar(false);
    }));
    // "Cookie settings" in the footer reopens the notice
    document.querySelectorAll('[data-cookie-settings]').forEach(link => link.addEventListener('click', e => {
      e.preventDefault();
      setBar(true);
    }));
  }

  // Find Childcare form: pre-fill the destination (and nanny) chosen on the nanny map
  const destSelect = document.getElementById('b-dest');
  if (destSelect) {
    const params = new URLSearchParams(location.search);
    const dest = params.get('destination');
    if (dest && [...destSelect.options].some(o => o.value === dest || o.text === dest)) destSelect.value = dest;
    const nanny = params.get('nanny');
    const pref = document.getElementById('b-pref');
    if (nanny && pref && !pref.value) pref.value = "I'd like to request " + nanny + ' (from the nanny map)';
  }

  // Footer year
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
});
