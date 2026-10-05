/* Pro Travel Nannies: interactive Europe nanny map for families.
   Renders into any <div data-nanny-map></div>. Data lives in nanny-data.js. */
(function () {
  // Must match the projection used to draw assets/img/europe-map.svg
  const LON0 = -12, LON1 = 22, LAT0 = 34, LAT1 = 56.5;
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const pos = (lat, lon) => ({
    x: (lon - LON0) / (LON1 - LON0) * 100,
    y: (merc(LAT1) - merc(lat)) / (merc(LAT1) - merc(LAT0)) * 100
  });
  const COUNTRY_LABELS = [
    { name: 'Spain', lat: 39.1, lon: -5.6 },
    { name: 'Portugal', lat: 39.9, lon: -8.05, small: true },
    { name: 'France', lat: 46.9, lon: 2.3 },
    { name: 'Germany', lat: 50.9, lon: 10.3 }
  ];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bookUrl = (dest, nanny) => 'book.html?destination=' + encodeURIComponent(dest) + (nanny ? '&nanny=' + encodeURIComponent(nanny) : '') + '#b-dest';

  function nannyCard(n, loc) {
    return `
      <article class="nmap-nanny">
        <div class="nmap-nanny-head">
          <span class="nmap-avatar" aria-hidden="true">${esc(n.name.charAt(0))}</span>
          <div>
            <h4>${esc(n.name)}</h4>
            <p class="small muted">${esc(n.years)} years' experience · ${esc(n.ages)}</p>
          </div>
          ${n.example ? '<span class="nmap-example">Example profile</span>' : ''}
        </div>
        <p class="small">${esc(n.intro)}</p>
        <p class="small muted" style="margin-bottom:.6rem"><strong style="color:var(--ink)">Speaks:</strong> ${n.languages.map(esc).join(', ')}</p>
        <div class="badges">${n.checks.map(c => `<span class="badge">${esc(c)}</span>`).join('')}</div>
        ${n.example ? '' : `<a class="btn btn-primary" style="margin-top:1rem;width:100%" href="${bookUrl(loc.destination, n.name)}">Request ${esc(n.name)}</a>`}
      </article>`;
  }

  function init(root) {
    const locs = window.PTN_LOCATIONS || [];
    const nannies = window.PTN_NANNIES || [];

    root.classList.add('nmap');
    root.innerHTML = `
      <div class="nmap-stage">
        <img src="assets/img/europe-map.svg" alt="Map of Europe showing where Pro Travel Nannies cares for families" width="1000" height="959">
        ${COUNTRY_LABELS.map(c => { const p = pos(c.lat, c.lon); return `<span class="nmap-country${c.small ? ' small' : ''}" style="left:${p.x}%;top:${p.y}%" aria-hidden="true">${c.name}</span>`; }).join('')}
        ${locs.map(l => { const p = pos(l.lat, l.lon); return `
          <button type="button" class="nmap-pin" data-loc="${l.id}" style="left:${p.x}%;top:${p.y}%" aria-label="${esc(l.name)}, ${esc(l.country)}: see nannies">
            <svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19z"/><circle cx="12" cy="12" r="4"/></svg>
            <span class="nmap-pin-label">${esc(l.name)}</span>
          </button>`; }).join('')}
      </div>
      <aside class="nmap-panel" aria-live="polite"></aside>`;

    const panel = root.querySelector('.nmap-panel');
    const pins = root.querySelectorAll('.nmap-pin');

    function showOverview() {
      pins.forEach(p => p.classList.remove('active'));
      const byCountry = {};
      locs.forEach(l => (byCountry[l.country] = byCountry[l.country] || []).push(l));
      panel.innerHTML = `
        <p class="eyebrow left">Find a nanny near you</p>
        <h3>Where are you travelling?</h3>
        <p class="muted small">Tap a pin on the map, or choose a destination below, to see nannies in that area.</p>
        ${Object.keys(byCountry).map(c => `
          <div class="nmap-group">
            <h4>${esc(c)}</h4>
            <div class="nmap-list">${byCountry[c].map(l => `<button type="button" data-loc="${l.id}">${esc(l.name)}</button>`).join('')}</div>
          </div>`).join('')}
        <p class="small muted" style="margin-top:1.4rem">Going somewhere else in Europe? <a href="book.html">Tell us your plans</a> and we'll let you know what we can arrange.</p>`;
      panel.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => select(b.dataset.loc, true)));
    }

    function select(id, focusPanel) {
      const loc = locs.find(l => l.id === id);
      if (!loc) return showOverview();
      pins.forEach(p => p.classList.toggle('active', p.dataset.loc === id));
      const list = nannies.filter(n => n.location === id);
      const examples = list.length && list.every(n => n.example);
      panel.innerHTML = `
        <button type="button" class="nmap-back">← All destinations</button>
        <p class="eyebrow left" style="margin-top:1rem">${esc(loc.country)}</p>
        <h3 tabindex="-1">${esc(loc.name)}</h3>
        <p class="muted small">${esc(loc.blurb)}</p>
        ${examples ? '<p class="note small" style="margin:1rem 0">These are example profiles showing what you\'ll see. Real, verified nannies for this area will appear here.</p>' : ''}
        <div class="nmap-nannies">
          ${list.length ? list.map(n => nannyCard(n, loc)).join('') : '<p class="muted">We\'re welcoming new nannies in this area. Send us your dates and we\'ll personally find the right person for your family.</p>'}
        </div>
        <a class="btn btn-primary" style="width:100%;margin-top:1.2rem" href="${bookUrl(loc.destination)}">Request childcare in ${esc(loc.name)}</a>
        <p class="small muted center" style="margin-top:.8rem">Every family is matched personally. Nothing is charged until you confirm.</p>`;
      panel.querySelector('.nmap-back').addEventListener('click', () => {
        history.replaceState(null, '', location.pathname + location.search);
        showOverview();
        root.querySelector('.nmap-stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      history.replaceState(null, '', '#map-' + id);
      if (focusPanel) {
        panel.querySelector('h3').focus({ preventScroll: true });
        if (window.innerWidth < 900) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    pins.forEach(p => p.addEventListener('click', () => select(p.dataset.loc, true)));
    const fromHash = location.hash.startsWith('#map-') ? location.hash.slice(5) : null;
    fromHash ? select(fromHash, false) : showOverview();
  }

  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-nanny-map]').forEach(init));
})();
