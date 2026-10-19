/* Panel administratora */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  $$('[data-color]').forEach((el) => {
    const c = el.getAttribute('data-color');
    if (/^#[0-9a-f]{6}$/i.test(c)) el.style.setProperty('--c', c);
  });
  $$('[data-width]').forEach((el) => { el.style.height = el.dataset.width + '%'; });

  // Menu na telefonie
  const side = $('.side');
  $$('[data-menu]').forEach((b) => b.addEventListener('click', () => side.classList.toggle('open')));

  // Potwierdzenia akcji
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !confirm(msg)) e.preventDefault();
  });

  // Kopiowanie
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Skopiowano'; } catch { /* ignore */ }
  });

  // Warianty produktu: dodawanie / usuwanie wierszy
  const list = $('[data-variants]');
  const tpl = $('#variant-template');
  if (list && tpl) {
    let next = parseInt(list.dataset.next || '0', 10);
    $('[data-add-variant]').addEventListener('click', () => {
      const html = tpl.innerHTML.replace(/__i__/g, String(next++));
      list.insertAdjacentHTML('beforeend', html);
      syncDelivery();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove-variant]');
      if (!b) return;
      if (list.querySelectorAll('.vrow').length <= 1) return alert('Produkt musi mieć co najmniej jeden wariant.');
      b.closest('.vrow').remove();
    });
  }

  // Sposób dostawy — pokaż właściwe pola
  const dt = $('[name="delivery_type"]');
  function syncDelivery() {
    if (!dt) return;
    $$('[data-for-delivery]').forEach((el) => { el.hidden = !el.dataset.forDelivery.split(' ').includes(dt.value); });
  }
  if (dt) { dt.addEventListener('change', syncDelivery); syncDelivery(); }

  // Strefa upuszczania zdjęć z podglądem
  $$('.dropzone').forEach((zone) => {
    const input = $('input[type="file"]', zone);
    const previews = zone.parentElement.querySelector('.previews');
    const show = () => {
      if (!previews) return;
      previews.innerHTML = '';
      Array.from(input.files).forEach((f) => {
        if (!f.type.startsWith('image/')) {
          const s = document.createElement('span'); s.className = 'pill'; s.textContent = f.name; previews.appendChild(s); return;
        }
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f); img.alt = f.name;
        previews.appendChild(img);
      });
    };
    zone.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('over');
      input.files = e.dataTransfer.files; show();
    });
    input.addEventListener('change', show);
  });

  // Licznik linii w polu kluczy
  const keys = $('[data-count-lines]');
  if (keys) {
    const out = $('[data-lines-out]');
    const upd = () => { out.textContent = keys.value.split(/\r?\n/).filter((l) => l.trim()).length; };
    keys.addEventListener('input', upd); upd();
  }

  // Dostawca płatności — pokaż właściwe pola
  $$('[data-provider-form]').forEach((form) => {
    const sel = $('[name="provider"]', form);
    const sync = () => $$('[data-provider]', form).forEach((el) => { el.hidden = sel && el.dataset.provider !== sel.value; });
    if (sel) { sel.addEventListener('change', sync); sync(); }
  });
})();
