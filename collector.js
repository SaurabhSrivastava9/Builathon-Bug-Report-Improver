// Runs inside the web page (MAIN world, document_start).
// Quietly records evidence so a bug report can be built from what REALLY happened:
//   - user actions (clicks, field changes, form submits, navigation)
//   - JavaScript errors / unhandled promise rejections / console.error
//   - failed network calls (HTTP >= 400 or request failure)
// Data stays in this tab (sessionStorage) until the user opens the extension popup.
// Password-like fields are never stored; URLs of network calls are stored without query strings.
(() => {
  'use strict';
  if (window.__bri) return;

  const KEY = '__bri_v1';
  const MAX = { actions: 60, errors: 25, net: 25 };
  const SENSITIVE = /pass|pwd|secret|token|otp|cvv|cvc|card|ssn|\bpin\b|iban/i;

  let state = { actions: [], errors: [], net: [] };
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.actions) && Array.isArray(s.errors) && Array.isArray(s.net)) state = s;
  } catch (e) {}

  const now = () => Date.now();
  const txt = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 60);
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  const push = (arr, item, max) => { arr.push(item); while (arr.length > max) arr.shift(); save(); };
  const cleanUrl = (u) => {
    try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch (e) { return txt(u, 120); }
  };

  // ---------- describing elements ----------
  function labelOf(el) {
    const a = el.getAttribute('aria-label'); if (a) return txt(a);
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + el.id.replace(/"/g, '') + '"]');
        if (l) return txt(l.textContent);
      } catch (e) {}
    }
    const wrap = el.closest('label'); if (wrap) return txt(wrap.textContent);
    const p = el.getAttribute('placeholder'); if (p) return txt(p);
    const n = el.getAttribute('name'); if (n) return txt(n);
    return '';
  }

  function selectorOf(el) {
    const tag = el.tagName.toLowerCase();
    for (const a of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(a);
      if (v) return '[' + a + '="' + v + '"]';
    }
    if (el.id && !/\d{4,}/.test(el.id)) return '#' + el.id;
    const nm = el.getAttribute('name');
    if (nm) return tag + '[name="' + nm + '"]';
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter((c) => c && !/\d{3,}|^css-|^_/.test(c))[0];
    return tag + (cls ? '.' + cls : '');
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const itype = (el.getAttribute('type') || '').toLowerCase();
    let role = el.getAttribute('role') || '';
    if (!role) {
      if (tag === 'a' && el.hasAttribute('href')) role = 'link';
      else if (tag === 'button' || (tag === 'input' && /^(button|submit|reset|image)$/.test(itype))) role = 'button';
      else if (tag === 'input' && itype === 'checkbox') role = 'checkbox';
      else if (tag === 'input' && itype === 'radio') role = 'radio';
      else if (tag === 'select') role = 'combobox';
      else if (tag === 'input' || tag === 'textarea') role = 'textbox';
    }
    const isField = /^(input|select|textarea)$/.test(tag) && !/^(button|submit|reset|image)$/.test(itype);
    const name = isField
      ? labelOf(el)
      : txt(el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || labelOf(el));
    return { tag, itype, role, name, sel: selectorOf(el) };
  }

  // ---------- navigation ----------
  const lastNavUrl = () => {
    for (let i = state.actions.length - 1; i >= 0; i--) if (state.actions[i].type === 'nav') return state.actions[i].url;
    return null;
  };
  const navPush = () => {
    try {
      if (lastNavUrl() !== location.href) push(state.actions, { t: now(), type: 'nav', url: location.href }, MAX.actions);
    } catch (e) {}
  };
  navPush();
  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      setTimeout(navPush, 0);
      return r;
    };
  });
  window.addEventListener('popstate', navPush);
  window.addEventListener('hashchange', navPush);

  // ---------- user actions ----------
  window.addEventListener('click', (e) => {
    try {
      const el = e.target && e.target.closest ? e.target : null;
      if (!el) return;
      const t = el.closest('a,button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],input,summary,select,textarea,label') || el;
      const tag = t.tagName.toLowerCase();
      const type = (t.getAttribute('type') || '').toLowerCase();
      if (tag === 'select' || tag === 'textarea' || tag === 'label') return;
      if (tag === 'input' && !/^(button|submit|reset|image)$/.test(type)) return; // handled by 'change'
      push(state.actions, Object.assign({ t: now(), type: 'click', url: location.href }, describe(t)), MAX.actions);
    } catch (err) {}
  }, true);

  window.addEventListener('change', (e) => {
    try {
      const el = e.target;
      if (!el || !el.tagName || !/^(input|select|textarea)$/i.test(el.tagName)) return;
      const d = describe(el);
      let value;
      if (d.itype === 'checkbox' || d.itype === 'radio') value = el.checked ? 'checked' : 'unchecked';
      else if (d.itype === 'file') value = '(file)';
      else if (d.itype === 'password' || SENSITIVE.test([el.name, el.id, el.getAttribute('autocomplete'), d.name].join(' '))) value = '***';
      else if (el.tagName.toLowerCase() === 'select') value = txt(el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value, 40);
      else value = txt(el.value, 40);
      push(state.actions, Object.assign({ t: now(), type: 'input', value, url: location.href }, d), MAX.actions);
    } catch (err) {}
  }, true);

  window.addEventListener('submit', (e) => {
    try {
      const last = state.actions[state.actions.length - 1];
      if (last && last.type === 'click' && now() - last.t < 800) return; // the click already explains it
      const f = e.target;
      const name = txt(f.getAttribute && (f.getAttribute('aria-label') || f.id || f.getAttribute('name')), 40);
      push(state.actions, { t: now(), type: 'submit', name, sel: f.id ? '#' + f.id : 'form', url: location.href }, MAX.actions);
    } catch (err) {}
  }, true);

  // ---------- errors ----------
  window.addEventListener('error', (e) => {
    try {
      if (e.target && e.target !== window && (e.target.src || e.target.href)) {
        push(state.errors, { t: now(), kind: 'resource', msg: 'Failed to load ' + e.target.tagName.toLowerCase() + ': ' + cleanUrl(e.target.src || e.target.href) }, MAX.errors);
      } else {
        const src = e.filename ? cleanUrl(e.filename).split('/').pop() + ':' + e.lineno : '';
        push(state.errors, { t: now(), kind: 'exception', msg: txt(e.message, 300), src }, MAX.errors);
      }
    } catch (err) {}
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e.reason;
      push(state.errors, { t: now(), kind: 'promise', msg: txt((r && (r.message || r.stack)) || r, 300) }, MAX.errors);
    } catch (err) {}
  });

  const origConsoleError = console.error;
  console.error = function () {
    try {
      const msg = Array.prototype.map.call(arguments, (a) => {
        if (a instanceof Error) return a.message;
        if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return '[object]'; } }
        return String(a);
      }).join(' ');
      push(state.errors, { t: now(), kind: 'console.error', msg: txt(msg, 300) }, MAX.errors);
    } catch (err) {}
    return origConsoleError.apply(this, arguments);
  };

  // ---------- network ----------
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const url = cleanUrl(typeof input === 'string' ? input : (input && input.url) || input);
      const t0 = now();
      return origFetch.apply(this, arguments).then(
        (res) => {
          if (res.status >= 400) push(state.net, { t: now(), method, url, status: res.status, ms: now() - t0 }, MAX.net);
          return res;
        },
        (err) => {
          push(state.net, { t: now(), method, url, status: 0, error: txt(err && err.message, 80), ms: now() - t0 }, MAX.net);
          throw err;
        }
      );
    };
  }

  if (window.XMLHttpRequest) {
    const xOpen = XMLHttpRequest.prototype.open;
    const xSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      try { this.__bri = { method: String(m).toUpperCase(), url: cleanUrl(u) }; } catch (e) {}
      return xOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const x = this;
      const t0 = now();
      x.addEventListener('loadend', () => {
        try {
          const i = x.__bri;
          if (i && x.status >= 400) push(state.net, { t: now(), method: i.method, url: i.url, status: x.status, ms: now() - t0 }, MAX.net);
          else if (i && x.status === 0) push(state.net, { t: now(), method: i.method, url: i.url, status: 0, error: 'request failed', ms: now() - t0 }, MAX.net);
        } catch (e) {}
      });
      return xSend.apply(this, arguments);
    };
  }

  // ---------- API used by the popup ----------
  function pageInfo() {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    return {
      title: txt(document.title, 100),
      url: location.href,
      viewport: window.innerWidth + 'x' + window.innerHeight,
      screen: screen.width + 'x' + screen.height,
      dpr: window.devicePixelRatio,
      lang: navigator.language,
      tz,
      online: navigator.onLine,
      conn: navigator.connection ? navigator.connection.effectiveType : '',
      selection: txt(window.getSelection ? window.getSelection().toString() : '', 200),
    };
  }

  Object.defineProperty(window, '__bri', {
    enumerable: false,
    value: {
      dump() { return JSON.parse(JSON.stringify({ actions: state.actions, errors: state.errors, net: state.net, page: pageInfo() })); },
      clear() { state = { actions: [], errors: [], net: [] }; save(); navPush(); },
    },
  });
})();
