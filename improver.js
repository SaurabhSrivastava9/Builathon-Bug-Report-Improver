// Bug Report Improver – analysis + rendering. Pure functions, no network needed.
// analyze(note, env, evidence) -> data object
// renderMarkdown(data) / renderJira(data) / buildPlaywright(data) -> strings

const ACTION = /\b(click|clicked|tap|tapped|open|opened|enter|entered|type|typed|login|log in|logged in|go to|went to|navigate|navigated|select|selected|submit|submitted|press|pressed|upload|uploaded|search|searched|add|added|scroll|scrolled|choose|chose|fill|filled|visit|visited|launch|launched|hit|drag|dragged|download|downloaded|checkout|check out)\b/i;
const EXPECT = /\b(should|expected|expecting|supposed to|must|ought to)\b/i;
const ACTUAL = /\b(error|fail|failed|fails|failing|crash|crashed|not working|doesn'?t|does not|didn'?t|did not|can'?t|cannot|unable|broken|nothing happens|stuck|blank|freeze|frozen|wrong|incorrect|500|404|403|exception|timeout|timed out|shows|showing|showed|displayed|displays|instead|not (?:loading|showing|saving|opening|responding|updating|displayed))\b/i;

const SEVERITY_RULES = [
  { level: 'Critical', re: /\b(crash|crashed|data loss|lost data|deleted|security|vulnerab|leak|payment|charged|production down|prod down|outage|can'?t log ?in|cannot log ?in|login (?:fails|failed|broken)|500|blocker|corrupt)\b/i, why: 'Crash / data / security / payment / login impact' },
  { level: 'High', re: /\b(fail|failed|fails|error|exception|broken|cannot|can'?t|unable|not working|not saving|not loading|nothing happens|no response|not responding|timeout|timed out|stuck|freeze|frozen|404|403)\b/i, why: 'Core functionality fails or is blocked' },
  { level: 'Low', re: /\b(typo|spelling|alignment|misaligned|spacing|padding|cosmetic|color|colour|font|icon|tooltip|css|pixel|minor)\b/i, why: 'Cosmetic / UI polish issue' },
  { level: 'Medium', re: /\b(wrong|incorrect|unexpected|slow|delay|inconsistent|sometimes|intermittent|missing)\b/i, why: 'Feature misbehaves but has a workaround' },
];
const LEVELS = ['Low', 'Medium', 'High', 'Critical'];
const rank = (l) => LEVELS.indexOf(l);

// ---------- small helpers ----------
function clean(s) {
  return String(s || '').replace(/^\s*(?:\d+[\.\)]|[-*•>])\s*/, '').replace(/[\s.;,]+$/, '').trim();
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function pathOf(u) {
  try { const x = new URL(u); return x.pathname + (x.search ? '?…' : '') + (x.hash || ''); } catch (e) { return String(u); }
}
function dedupe(list, keyFn) {
  const map = new Map();
  for (const it of list) {
    const k = keyFn(it);
    if (map.has(k)) map.get(k).count++;
    else map.set(k, Object.assign({}, it, { count: 1 }));
  }
  return Array.from(map.values());
}

function splitClauses(note) {
  const sentences = String(note || '')
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clauses = [];
  for (const s of sentences) {
    const parts = s.split(/\s*(?:->|=>|→|;|,\s*(?:and\s+)?|,?\s+and then\s+|,?\s+then\s+|,?\s+after that\s+)\s*/i);
    for (const p of parts) {
      const c = clean(p);
      if (c) clauses.push(c);
    }
  }
  return clauses;
}

function detectSeverity(text) {
  for (const r of SEVERITY_RULES) if (r.re.test(text)) return { level: r.level, why: r.why };
  return { level: 'Medium', why: 'Impact unclear from the note; please confirm' };
}
function priorityFor(level) {
  return { Critical: 'P0 – Fix immediately', High: 'P1 – Fix this sprint', Medium: 'P2 – Plan soon', Low: 'P3 – Backlog' }[level];
}

// ---------- recorded actions -> readable steps ----------
function stepText(a) {
  const nm = a.name ? '"' + a.name + '"' : '`' + (a.sel || a.tag || 'element') + '`';
  if (a.type === 'click') return 'Click ' + (a.role ? a.role + ' ' : '') + nm;
  if (a.type === 'submit') return 'Submit the form' + (a.name ? ' ' + nm : '');
  if (a.type === 'input') {
    if (a.itype === 'checkbox' || a.itype === 'radio') return (a.value === 'checked' ? 'Check ' : 'Uncheck ') + nm;
    if (a.role === 'combobox') return 'Select "' + a.value + '" from ' + nm;
    if (a.itype === 'file') return 'Upload a file in ' + nm;
    if (a.value === '***') return 'Enter [hidden value] in ' + nm + ' field';
    if (!a.value) return 'Clear ' + nm + ' field';
    return 'Enter "' + a.value + '" in ' + nm + ' field';
  }
  return '';
}

function stepsFromActions(actions) {
  const raw = [];
  let lastActT = 0;
  (actions || []).forEach((a) => {
    if (a.type === 'nav') {
      if (!raw.length) raw.push({ base: 'Open ' + a.url, a, n: 1, suffix: '' });
      else if (a.t - lastActT < 3000 && raw[raw.length - 1].a.type !== 'nav') raw[raw.length - 1].suffix += ' → ' + pathOf(a.url);
      else raw.push({ base: 'Navigate to ' + a.url, a, n: 1, suffix: '' });
      return;
    }
    if (!raw.length) raw.push({ base: 'Open ' + a.url, a: { type: 'nav', url: a.url, t: a.t }, n: 1, suffix: '' });
    const text = stepText(a);
    if (!text) return;
    lastActT = a.t;
    const prev = raw[raw.length - 1];
    if (prev && prev.base === text) { prev.n++; return; }
    raw.push({ base: text, a, n: 1, suffix: '' });
  });
  const omitted = Math.max(0, raw.length - 15);
  const kept = raw.slice(-15);
  const steps = kept.map((s) => ({ text: s.base + (s.n > 1 ? ' (×' + s.n + ')' : '') + s.suffix, a: s.a }));
  const rage = kept.filter((s) => s.a.type === 'click' && s.n >= 3).map((s) => s.base);
  return { steps, omitted, rage };
}

// ---------- evidence -> clues ----------
function buildClues(errSummary, netSummary, rage, hasEvidence, actualText) {
  const clues = [];
  netSummary.forEach((n) => {
    const p = pathOf(n.url);
    if (n.status >= 500) clues.push('Server error (' + n.status + ') on ' + n.method + ' ' + p + ' → check backend logs for this endpoint.');
    else if (n.status === 401 || n.status === 403) clues.push('Auth/permission failure (' + n.status + ') on ' + n.method + ' ' + p + ' → check session/token or user role.');
    else if (n.status === 404) clues.push('Endpoint or resource not found (404) on ' + n.method + ' ' + p + ' → wrong URL, missing route or deleted data.');
    else if (n.status === 429) clues.push('Rate limited (429) on ' + n.method + ' ' + p + '.');
    else if (n.status >= 400) clues.push('Request rejected (' + n.status + ') on ' + n.method + ' ' + p + ' → check request payload / validation rules.');
    else clues.push('Request failed before a response on ' + n.method + ' ' + p + (n.error ? ' (' + n.error + ')' : '') + ' → network, CORS or blocked request.');
  });
  errSummary.forEach((e) => {
    if (e.kind === 'exception' || e.kind === 'promise') {
      const m = e.msg.match(/^(\w*Error)\b/);
      clues.push('Uncaught JavaScript ' + (m ? m[1] : 'error') + (e.src ? ' at ' + e.src : '') + ' → front-end bug likely.');
    } else if (e.kind === 'resource') {
      clues.push(e.msg + ' → missing/blocked asset.');
    }
  });
  rage.forEach((r) => clues.push('Repeated clicks detected (' + r + ') → the UI probably gave no feedback.'));
  if (hasEvidence && !errSummary.length && !netSummary.length && /nothing happens|not working|no response|not responding|doesn'?t work/i.test(actualText)) {
    clues.push('No console errors or failed requests were captured → likely a silent front-end logic / event-handler issue, or a request that never fires.');
  }
  return Array.from(new Set(clues)).slice(0, 6);
}

// ---------- report quality ----------
function assess(d, flags) {
  const checks = [
    { ok: d.steps.length >= 2, pts: 20, q: 'What are the exact steps to reproduce it?' },
    { ok: d.expected.length > 0, pts: 20, q: 'What did you expect to happen?' },
    { ok: flags.actualFromNote, pts: 15, q: 'What exactly went wrong (error text, wrong value, nothing happens)?' },
    { ok: flags.hasEvidence, pts: 15, q: 'No evidence attached – reload the page, repeat the bug, then open the popup (steps, errors, screenshot are auto-captured).' },
    { ok: /\b(always|every time|each time|sometimes|intermittent|randomly|once|reproducible|consistently|\d+\s?(?:out of|\/)\s?\d+)\b/i.test(d.original), pts: 15, q: 'Does it happen every time or only sometimes?' },
    { ok: /\b(staging|stage|qa|uat|prod|production|dev|localhost|sandbox|build|release|version|v?\d+\.\d+(?:\.\d+)?)\b/i.test(d.original + ' ' + (d.env.url || '')), pts: 15, q: 'Which environment / build version is this?' },
  ];
  const score = checks.reduce((s, c) => s + (c.ok ? c.pts : 0), 0);
  return {
    score,
    label: score >= 80 ? 'ready to file' : score >= 50 ? 'needs a little more' : 'too vague for a developer',
    missing: checks.filter((c) => !c.ok).map((c) => c.q),
  };
}

// ---------- main analysis ----------
function analyze(note, env, evidence) {
  note = String(note || '').trim();
  env = env || {};
  const ev = evidence || {};
  const actions = ev.actions || [];
  const errors = ev.errors || [];
  const net = ev.net || [];
  const hasEvidence = !!(actions.length || errors.length || net.length || ev.hasScreenshot);

  const clauses = splitClauses(note);
  const noteSteps = [], expected = [], actual = [], other = [];
  for (const c of clauses) {
    const label = c.match(/^(expected(?: result| behaviou?r)?|actual(?: result| behaviou?r)?)\s*[:\-]\s*(.+)$/i);
    if (label) { (/^exp/i.test(label[1]) ? expected : actual).push(cap(label[2])); continue; }
    if (EXPECT.test(c)) expected.push(cap(c));
    else if (ACTUAL.test(c) && !/^(click|open|go to|enter|type|select|tap|press)\b/i.test(c)) actual.push(cap(c));
    else if (ACTION.test(c)) noteSteps.push(cap(c));
    else other.push(cap(c));
  }

  // steps: prefer what the recorder really saw
  const rec = stepsFromActions(actions);
  const useRecorded = rec.steps.length >= 2 || (rec.steps.length === 1 && noteSteps.length === 0 && actions.length > 1);
  const steps = useRecorded ? rec.steps.map((s) => s.text) : noteSteps;
  const recordedActions = useRecorded ? rec.steps.map((s) => s.a) : [];

  const errSummary = dedupe(errors, (e) => e.kind + '|' + e.msg);
  const netSummary = dedupe(net, (n) => n.method + '|' + n.url + '|' + n.status);

  const actualFromNote = actual.length > 0;
  if (!actual.length) {
    if (note) actual.push(cap(clean(note)));
    else if (netSummary.length) {
      const n = netSummary[0];
      actual.push(n.method + ' ' + pathOf(n.url) + (n.status ? ' returned HTTP ' + n.status : ' failed (' + (n.error || 'no response') + ')'));
    } else if (errSummary.length) actual.push(cap(errSummary[0].msg));
    else actual.push('[Describe what went wrong]');
  }

  // severity: words in the note + hard evidence
  const textSev = detectSeverity(actual.concat(other).join(' ') || note);
  let sevLevel = textSev.level;
  let why = textSev.why;
  let evLevel = null, evWhy = '';
  const worstNet = netSummary.slice().sort((a, b) => b.status - a.status)[0];
  if (netSummary.some((n) => n.status >= 500) || errSummary.some((e) => e.kind === 'exception' || e.kind === 'promise')) {
    evLevel = 'High';
    evWhy = worstNet && worstNet.status >= 500 ? 'HTTP ' + worstNet.status + ' on ' + worstNet.method + ' ' + pathOf(worstNet.url) : 'uncaught JavaScript error';
  } else if (netSummary.length || errSummary.length) {
    evLevel = 'Medium';
    evWhy = netSummary.length ? 'failed request ' + netSummary[0].method + ' ' + pathOf(netSummary[0].url) + ' (' + netSummary[0].status + ')' : 'console error captured';
  }
  if (evLevel && rank(evLevel) > rank(sevLevel)) { sevLevel = evLevel; why = 'Evidence: ' + evWhy; }
  else if (evLevel && /^Impact unclear/.test(why)) why = 'Evidence: ' + evWhy;
  else if (evLevel) why += '; evidence: ' + evWhy;

  const clues = buildClues(errSummary, netSummary, rec.rage, hasEvidence, actual.join(' '));

  // title
  const lastStep = steps.length ? lcFirst(steps[steps.length - 1].replace(/\s*→.*$/, '').replace(/\s*\(×\d+\)/, '')) : '';
  let title = actual[0];
  if (lastStep && !/^\[/.test(actual[0])) title += ' – ' + lastStep;
  title = cap(title);
  if (title.length > 100) title = title.slice(0, 97) + '...';

  const startUrl = (actions.find((a) => a.type === 'nav') || actions[0] || {}).url || env.url || (ev.page && ev.page.url) || '';

  const data = {
    title,
    severity: sevLevel,
    severityWhy: why,
    priority: priorityFor(sevLevel),
    env,
    page: ev.page || null,
    steps,
    stepsSource: useRecorded ? 'recorded' : 'note',
    omitted: useRecorded ? rec.omitted : 0,
    actions: recordedActions,
    startUrl,
    expected,
    actual,
    notes: actualFromNote ? other : [],
    errors: errSummary.slice(0, 5),
    net: netSummary.slice(0, 6),
    hasShot: !!ev.hasScreenshot,
    clues,
    original: note,
  };
  data.quality = assess(data, { actualFromNote, hasEvidence });
  return data;
}

// ---------- renderers ----------
function envLines(d) {
  const e = d.env, p = d.page || {};
  const L = [];
  L.push(['Browser', e.browser || 'N/A'], ['OS', e.os || 'N/A'], ['URL', e.url || p.url || 'N/A']);
  if (p.title) L.push(['Page title', p.title]);
  if (p.viewport) L.push(['Viewport', p.viewport + (p.screen ? ' (screen ' + p.screen + ', DPR ' + p.dpr + ')' : '')]);
  if (p.lang) L.push(['Language / timezone', p.lang + (p.tz ? ' / ' + p.tz : '')]);
  if (p.conn) L.push(['Network', p.conn + (p.online === false ? ' (offline!)' : '')]);
  L.push(['Reported', e.time || new Date().toLocaleString()]);
  return L;
}
function netLine(n) {
  return n.method + ' ' + pathOf(n.url) + ' → ' + (n.status || 'FAILED' + (n.error ? ' (' + n.error + ')' : '')) + (n.count > 1 ? '  ×' + n.count : '');
}
function errLine(e) {
  return '[' + e.kind + '] ' + e.msg + (e.src ? ' (' + e.src + ')' : '') + (e.count > 1 ? '  ×' + e.count : '');
}

function renderMarkdown(d) {
  const L = [];
  L.push('## Title', d.title, '');
  L.push('## Severity / Priority', '**Severity:** ' + d.severity + ' (' + d.severityWhy + ')', '**Priority:** ' + d.priority, '');
  L.push('## Environment', ...envLines(d).map(([k, v]) => '- ' + k + ': ' + v), '');
  L.push('## Steps to Reproduce');
  if (d.stepsSource === 'recorded') L.push('_Auto-recorded from the real clicks and inputs on the page._');
  if (d.omitted) L.push('_(' + d.omitted + ' earlier steps omitted)_');
  if (d.steps.length) { d.steps.forEach((s, i) => L.push((i + 1) + '. ' + s)); L.push((d.steps.length + 1) + '. Observe the result'); }
  else L.push('1. [Steps not clear – please add]');
  L.push('', '## Expected Result', d.expected.length ? d.expected.join('\n') : '[Not mentioned – please add expected behaviour]', '');
  L.push('## Actual Result', d.actual.join('\n'));
  if (d.errors.length || d.net.length || d.hasShot) {
    L.push('', '## Technical Evidence');
    if (d.net.length) L.push('**Failed network requests**', ...d.net.map((n) => '- `' + netLine(n) + '`'));
    if (d.errors.length) L.push('**Console / JS errors**', ...d.errors.map((e) => '- `' + errLine(e) + '`'));
    if (d.hasShot) L.push('_Screenshot captured when the bug was reported – attach it to the ticket._');
  }
  if (d.clues.length) L.push('', '## Likely Cause / Where to Look', ...d.clues.map((c) => '- ' + c));
  if (d.notes.length) L.push('', '## Additional Notes', ...d.notes.map((o) => '- ' + o));
  if (d.original) L.push('', '## Original Note', '> ' + d.original.replace(/\n/g, '\n> '));
  return L.join('\n');
}

function renderJira(d) {
  const L = [];
  L.push('h2. Summary', d.title, '');
  L.push('h2. Severity / Priority', '*Severity:* ' + d.severity + ' (' + d.severityWhy + ')', '*Priority:* ' + d.priority, '');
  L.push('h2. Environment', ...envLines(d).map(([k, v]) => '* *' + k + ':* ' + v), '');
  L.push('h2. Steps to Reproduce');
  if (d.stepsSource === 'recorded') L.push('_Auto-recorded from the real clicks and inputs on the page._');
  if (d.steps.length) { d.steps.forEach((s) => L.push('# ' + s)); L.push('# Observe the result'); }
  else L.push('# [Steps not clear – please add]');
  L.push('', 'h2. Expected Result', d.expected.length ? d.expected.join('\n') : '[Not mentioned – please add expected behaviour]', '');
  L.push('h2. Actual Result', d.actual.join('\n'));
  if (d.errors.length || d.net.length || d.hasShot) {
    L.push('', 'h2. Technical Evidence');
    if (d.net.length) L.push('*Failed network requests*', ...d.net.map((n) => '* {{' + netLine(n) + '}}'));
    if (d.errors.length) L.push('*Console / JS errors*', ...d.errors.map((e) => '* {{' + errLine(e) + '}}'));
    if (d.hasShot) L.push('_Screenshot captured when the bug was reported – attach it to the ticket._');
  }
  if (d.clues.length) L.push('', 'h2. Likely Cause / Where to Look', ...d.clues.map((c) => '* ' + c));
  if (d.notes.length) L.push('', 'h2. Additional Notes', ...d.notes.map((o) => '* ' + o));
  if (d.original) L.push('', 'h2. Original Note', '{quote}', d.original, '{quote}');
  return L.join('\n');
}

// ---------- Playwright regression test ----------
function pwLocator(a) {
  const q = (s) => JSON.stringify(String(s));
  const field = ['textbox', 'combobox', 'checkbox', 'radio'].indexOf(a.role) >= 0;
  if (/^(\[data-|#|[a-z]+\[name=)/.test(a.sel || '')) return 'page.locator(' + q(a.sel) + ')';
  if (field && a.name) return 'page.getByLabel(' + q(a.name) + ')';
  if (a.role && a.name && /^(link|button|tab|menuitem)$/.test(a.role)) return 'page.getByRole(' + q(a.role) + ', { name: ' + q(a.name) + ' })';
  if (a.name) return 'page.getByText(' + q(a.name) + ')';
  return 'page.locator(' + q(a.sel || 'body') + ')';
}

function pwStep(a) {
  const q = (s) => JSON.stringify(String(s));
  if (a.type === 'nav') return ['  await page.goto(' + q(a.url) + ');'];
  if (a.type === 'submit') return ["  await page.keyboard.press('Enter'); // form submitted"];
  const loc = pwLocator(a);
  if (a.type === 'click') return ['  await ' + loc + '.click();'];
  if (a.type === 'input') {
    if (a.itype === 'checkbox' || a.itype === 'radio') return ['  await ' + loc + (a.value === 'checked' ? '.check();' : '.uncheck();')];
    if (a.role === 'combobox') return ['  await ' + loc + '.selectOption({ label: ' + q(a.value) + ' });'];
    if (a.itype === 'file') return ['  // TODO: await ' + loc + ".setInputFiles('path/to/file');"];
    if (a.value === '***') return ['  await ' + loc + ".fill(process.env.TEST_SECRET ?? ''); // value was hidden – supply it via env"];
    if (!a.value) return ['  await ' + loc + '.clear();'];
    return ['  await ' + loc + '.fill(' + q(a.value) + ');'];
  }
  return [];
}

function buildPlaywright(d) {
  const q = (s) => JSON.stringify(String(s));
  const L = [];
  L.push("import { test, expect } from '@playwright/test';", '');
  L.push('// Regression test generated by Bug Report Improver', '// Bug: ' + d.title, '// Severity: ' + d.severity, '');
  L.push('test(' + q(d.title) + ', async ({ page }) => {');
  L.push('  const jsErrors: string[] = [];', '  const failedCalls: string[] = [];');
  L.push("  page.on('pageerror', (e) => jsErrors.push(e.message));");
  L.push("  page.on('response', (r) => {");
  L.push('    if (r.status() >= 400) failedCalls.push(r.status() + " " + r.request().method() + " " + r.url());');
  L.push('  });', '');
  if (d.actions.length) {
    d.actions.forEach((a) => pwStep(a).forEach((l) => L.push(l)));
  } else {
    L.push('  await page.goto(' + q(d.startUrl || 'https://your-app-url') + ');');
    d.steps.forEach((s) => L.push('  // TODO: ' + s));
    if (!d.steps.length) L.push('  // TODO: add the steps that reproduce the bug');
  }
  L.push('');
  d.expected.forEach((e) => L.push('  // Expected: ' + e));
  if (!d.expected.length) L.push('  // Expected: [add expected behaviour]');
  L.push('  // TODO: assert the expected result, e.g.');
  L.push("  // await expect(page).toHaveURL(/expected-path/);");
  L.push("  // await expect(page.getByText('Expected text')).toBeVisible();");
  L.push('', "  expect(jsErrors, 'no uncaught JS errors').toEqual([]);");
  L.push("  expect(failedCalls, 'no failing network calls').toEqual([]);");
  L.push('});', '');
  return L.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { analyze, renderMarkdown, renderJira, buildPlaywright, stepsFromActions };
}
