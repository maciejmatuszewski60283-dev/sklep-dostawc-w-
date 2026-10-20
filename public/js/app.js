/* najtańsze itemki — skrypty frontendu (bez zewnętrznych bibliotek) */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Kolory platform (CSP blokuje atrybuty style, więc ustawiamy zmienne CSS z JS)
  $$('[data-color]').forEach((el) => {
    const c = el.getAttribute('data-color');
    if (/^#[0-9a-f]{6}$/i.test(c)) el.style.setProperty('--c', c);
  });

  // Kopiowanie do schowka
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Skopiowano';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1600);
  });

  // Pola ilości +/-
  $$('[data-qty]').forEach((box) => {
    const input = $('input[type="number"]', box);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]');
      if (!b) return;
      const max = parseInt(input.max || '10', 10);
      const v = Math.min(max, Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(b.dataset.step, 10)));
      if (String(v) === input.value) return;
      input.value = v;
      if (box.hasAttribute('data-autosubmit-qty')) box.requestSubmit ? box.requestSubmit() : box.submit();
    });
    if (box.hasAttribute('data-autosubmit-qty')) input.addEventListener('change', () => box.submit());
  });

  // Automatyczne wysyłanie sortowania
  $$('form[data-autosubmit] select').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // Filtry na telefonie
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const t = document.getElementById(b.dataset.toggle);
    if (t) t.classList.toggle('open');
  }));

  // Galeria produktu
  const main = $('[data-gallery-main] img');
  $$('.gallery-thumbs button').forEach((b) => b.addEventListener('click', () => {
    if (!main) return;
    main.src = b.dataset.full;
    $$('.gallery-thumbs button').forEach((x) => x.classList.toggle('active', x === b));
  }));

  // Wybór wariantu: aktualizacja ceny
  $$('.variant input').forEach((r) => r.addEventListener('change', () => {
    const price = $('[data-price]');
    const cmp = $('[data-compare]');
    const lowWrap = $('[data-lowest-wrap]');
    if (price) price.textContent = r.dataset.price;
    if (cmp) { cmp.textContent = r.dataset.compare; cmp.hidden = !r.dataset.compare; }
    if (lowWrap) { $('[data-lowest]').textContent = r.dataset.lowest; lowWrap.hidden = !r.dataset.lowest; }
  }));

  // Zakładki
  $$('[data-tabs]').forEach((tabs) => {
    const btns = $$('[role="tab"]', tabs);
    btns.forEach((b) => b.addEventListener('click', () => {
      btns.forEach((x) => {
        const on = x === b;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      });
    }));
  });

  // Dodawanie do koszyka bez przeładowania (z zachowaniem działania bez JS)
  $$('form[data-add-to-cart]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      if (e.submitter && e.submitter.name === 'buy_now') return;
      e.preventDefault();
      const btn = $('[data-add]', form);
      btn.disabled = true;
      try {
        const res = await fetch(form.action, {
          method: 'POST', body: new URLSearchParams(new FormData(form)),
          headers: { accept: 'application/json' }, credentials: 'same-origin',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Błąd');
        const c = $('[data-cart-count]');
        if (c) { c.textContent = data.count; c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
        btn.textContent = 'Dodano ✓';
        setTimeout(() => { btn.innerHTML = btn.dataset.html; btn.disabled = false; }, 1400);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
    const b = $('[data-add]', form);
    if (b) b.dataset.html = b.innerHTML;
  });

  // Zabezpieczenie przed podwójnym wysłaniem zamówienia
  const checkout = $('form[data-checkout]');
  if (checkout) checkout.addEventListener('submit', () => {
    const b = $('[data-submit]', checkout);
    setTimeout(() => { b.disabled = true; b.textContent = 'Przygotowujemy płatność…'; }, 0);
  });

  // Paski postępu (szerokość z atrybutu)
  $$('[data-progress]').forEach((el) => { el.style.width = Math.min(100, parseInt(el.dataset.progress, 10) || 0) + '%'; });

  // Odliczanie czasu płatności
  const cd = $('[data-countdown]');
  if (cd) {
    const end = new Date(cd.dataset.countdown).getTime();
    const bar = $('[data-countdown-bar]');
    const total = bar ? parseInt(bar.dataset.total, 10) : 0;
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      cd.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      cd.classList.toggle('urgent', left < 5 * 60000);
      if (bar && total) bar.style.width = (left / total * 100).toFixed(1) + '%';
      if (left <= 0) { clearInterval(t); setTimeout(() => location.reload(), 1500); }
    };
    const t = setInterval(tick, 1000);
    tick();
  }

  // Odpytywanie statusu zamówienia — przeładowanie przy zmianie
  const poll = $('[data-poll]');
  if (poll) {
    let delay = 8000;
    const check = async () => {
      try {
        const r = await fetch(poll.dataset.poll, { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
        if (r.ok) {
          const d = await r.json();
          const p = d.payment || {};
          const state = `${d.order}|${p.status}|${p.txCount || 0}|${p.confirmations || 0}`;
          if (state !== poll.dataset.state) return location.reload();
          delay = 8000;
        } else delay = Math.min(60000, delay * 2);
      } catch { delay = Math.min(60000, delay * 2); }
      setTimeout(check, document.hidden ? 30000 : delay);
    };
    setTimeout(check, delay);
  }
})();
