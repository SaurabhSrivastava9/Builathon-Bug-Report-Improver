const $ = (id) => document.getElementById(id);

let env = {};
let evidence = null; // from the in-page recorder
let shot = null;     // screenshot data URL
let last = null;     // last analysis
let aiMode = false;

// ---------- helpers ----------
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text; // textContent only: page data is untrusted
  if (cls) e.className = cls;
  return e;
}
function setStatus(msg, isErr) {
  $('status').textContent = msg || '';
  $('status').className = isErr ? 'err' : '';
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function buildEnv(tab) {
  const ua = navigator.userAgent;
  const ver = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || 'Unknown';
  let os = 'Unknown';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser: 'Chrome ' + ver, os, url: (tab && tab.url) || '', time: new Date().toLocaleString() };
}
function hasData() {
  return !!(evidence && ((evidence.actions || []).length || (evidence.errors || []).length || (evidence.net || []).length));
}
function evidenceForAnalysis() {
  return Object.assign({}, evidence || {}, { hasScreenshot: !!shot });
}

// ---------- evidence capture ----------
async function collect(tab) {
  evidence = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => (window.__bri ? window.__bri.dump() : null),
    });
    evidence = (res && res.result) || null;
  } catch (e) { evidence = null; }
}
async function capture(tab) {
  try { shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); } catch (e) { shot = null; }
}

function renderCapture() {
  const box = $('capture');
  if (evidence) {
    const a = (evidence.actions || []).length, e = (evidence.errors || []).length, n = (evidence.net || []).length;
    box.textContent = '● Recorder active · ' + a + ' actions · ' + e + ' errors · ' + n + ' failed requests · screenshot ' + (shot ? '✓' : '✗');
    box.className = 'capture on';
  } else {
    box.textContent = '○ Recorder not active on this page. Reload the page once, repeat the bug, then open this popup. (Note-only mode still works.)';
    box.className = 'capture off';
  }
}

function renderEvidence() {
  const body = $('evBody');
  body.textContent = '';
  if (evidence) {
    const rec = stepsFromActions(evidence.actions || []);
    const chips = el('div', null, 'chips');
    chips.appendChild(el('span', rec.steps.length + ' steps recorded', 'chip'));
    chips.appendChild(el('span', (evidence.errors || []).length + ' JS/console errors', 'chip' + ((evidence.errors || []).length ? ' warn' : '')));
    chips.appendChild(el('span', (evidence.net || []).length + ' failed requests', 'chip' + ((evidence.net || []).length ? ' warn' : '')));
    body.appendChild(chips);

    if (rec.steps.length) {
      body.appendChild(el('h4', 'Recorded steps'));
      const ol = el('ol');
      rec.steps.forEach((s) => ol.appendChild(el('li', s.text)));
      body.appendChild(ol);
    }
    if ((evidence.errors || []).length) {
      body.appendChild(el('h4', 'Errors'));
      const ul = el('ul');
      evidence.errors.forEach((e) => { const li = el('li'); li.appendChild(el('code', '[' + e.kind + '] ' + e.msg)); ul.appendChild(li); });
      body.appendChild(ul);
    }
    if ((evidence.net || []).length) {
      body.appendChild(el('h4', 'Failed requests'));
      const ul = el('ul');
      evidence.net.forEach((n) => { const li = el('li'); li.appendChild(el('code', n.method + ' ' + pathOf(n.url) + ' → ' + (n.status || 'FAILED'))); ul.appendChild(li); });
      body.appendChild(ul);
    }
  } else {
    body.appendChild(el('p', 'No recorder data on this page yet.', 'hint'));
  }
  $('shotBox').classList.toggle('hidden', !shot);
  if (shot) $('shot').src = shot;
}

// ---------- quality ----------
function renderQuality(q) {
  $('quality').classList.remove('hidden');
  $('qfill').style.width = q.score + '%';
  $('qfill').className = q.score >= 80 ? 'good' : q.score >= 50 ? 'ok' : 'bad';
  $('qtext').textContent = 'Report quality: ' + q.score + '/100 – ' + q.label;
  const ul = $('qmissing');
  ul.textContent = '';
  q.missing.forEach((m) => ul.appendChild(el('li', '❓ ' + m)));
}

// ---------- rendering ----------
function renderReport() {
  if (!last) return;
  $('output').value = $('format').value === 'jira' ? renderJira(last) : renderMarkdown(last);
  $('output').removeAttribute('readonly');
}
function renderAll(overrideText) {
  renderReport();
  if (overrideText) $('output').value = overrideText;
  $('testcode').value = buildPlaywright(last);
  renderQuality(last.quality);
  saveHistory();
}

// ---------- history ----------
async function loadHistory() {
  const { history } = await chrome.storage.local.get('history');
  return Array.isArray(history) ? history : [];
}
async function saveHistory() {
  const list = await loadHistory();
  list.unshift({ time: new Date().toLocaleString(), title: last.title, severity: last.severity, report: $('output').value });
  await chrome.storage.local.set({ history: list.slice(0, 15) });
  renderHistory();
}
async function renderHistory() {
  const ul = $('history');
  ul.textContent = '';
  const list = await loadHistory();
  if (!list.length) ul.appendChild(el('li', 'No reports yet'));
  list.forEach((h) => {
    const li = el('li', '[' + h.severity + '] ' + h.title + ' · ' + h.time);
    li.addEventListener('click', () => { $('output').value = h.report; showTab('report'); setStatus('Loaded from history.'); });
    ul.appendChild(li);
  });
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  ['report', 'evidence', 'test'].forEach((n) => $('pane-' + n).classList.toggle('hidden', n !== name));
}

// ---------- Claude mode ----------
function aiPrompt(note, d, fmt) {
  const facts = {
    note,
    suggestedSeverity: d.severity + ' – ' + d.severityWhy,
    environment: d.env,
    page: d.page,
    recordedSteps: d.stepsSource === 'recorded' ? d.steps : [],
    stepsFromNote: d.stepsSource === 'note' ? d.steps : [],
    expectedFromNote: d.expected,
    actualFromNote: d.actual,
    consoleErrors: d.errors.map((e) => '[' + e.kind + '] ' + e.msg),
    failedRequests: d.net.map((n) => n.method + ' ' + pathOf(n.url) + ' -> ' + (n.status || 'failed')),
    automaticClues: d.clues,
  };
  return 'You are a senior QA engineer. Write a clear, professional bug report in ' +
    (fmt === 'jira' ? 'Jira wiki markup' : 'Markdown') + ' from the facts below.\n\n' +
    'Sections: Title, Severity / Priority (with a one-line reason), Environment, Steps to Reproduce (numbered; use the recorded steps faithfully but reword them clearly), Expected Result, Actual Result, Technical Evidence (only if present), Suspected Cause (clearly labelled as a hypothesis, only if evidence supports it), Questions for the reporter (only for genuinely missing info).\n' +
    'Rules: never invent facts, steps, versions or error text. If something is missing write "[Not mentioned – please add]". Keep it concise.\n\n' +
    'FACTS (JSON):\n' + JSON.stringify(facts, null, 2);
}
async function askClaude(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || 'API error ' + res.status);
  return data.content.map((b) => b.text || '').join('');
}

// ---------- actions ----------
function getNote() {
  const note = $('note').value.trim();
  if (!note && !hasData()) {
    setStatus('Write a short note, or reproduce the bug on the page first so the recorder has something.', true);
    return null;
  }
  return note;
}
function analyzeNow(note) {
  env.time = new Date().toLocaleString();
  last = analyze(note, env, evidenceForAnalysis());
}

$('offline').addEventListener('click', () => {
  const note = getNote();
  if (note === null) return;
  aiMode = false;
  analyzeNow(note);
  renderAll();
  showTab('report');
  setStatus('Report ready (offline). You can edit it below.');
});

$('ai').addEventListener('click', async () => {
  const note = getNote();
  if (note === null) return;
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    setStatus('Add your API key in Settings below to use Claude.', true);
    document.querySelectorAll('details')[1].open = true;
    return;
  }
  analyzeNow(note);
  setStatus('Asking Claude…');
  try {
    const text = await askClaude(aiPrompt(note, last, $('format').value), apiKey);
    aiMode = true;
    renderAll(text);
    showTab('report');
    setStatus('Done (Claude, using your recorded evidence). You can edit it below.');
  } catch (e) {
    aiMode = false;
    renderAll();
    setStatus('Claude failed: ' + e.message + ' – showing the offline report instead.', true);
  }
});

$('format').addEventListener('change', () => {
  if (!last) return;
  if (aiMode) { setStatus('Click "Improve with Claude" again to get the other format.'); return; }
  renderReport();
});

async function copyText(text, okMsg) {
  if (!text) return setStatus('Nothing to copy yet.', true);
  await navigator.clipboard.writeText(text);
  setStatus(okMsg);
}
$('copyReport').addEventListener('click', () => copyText($('output').value, 'Report copied ✔'));
$('copyTest').addEventListener('click', () => copyText($('testcode').value, 'Playwright test copied ✔'));

$('copyShot').addEventListener('click', async () => {
  try {
    const blob = await (await fetch(shot)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus('Screenshot copied – paste it into your ticket ✔');
  } catch (e) { setStatus('Could not copy the image – use Download instead.', true); }
});
$('dlShot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = shot;
  a.download = 'bug-screenshot.png';
  a.click();
});

$('clearTrail').addEventListener('click', async () => {
  try {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => { if (window.__bri) window.__bri.clear(); } });
    await collect(tab);
    renderCapture();
    renderEvidence();
    setStatus('Recorded trail cleared. Start reproducing the bug again.');
  } catch (e) { setStatus('Could not clear the trail on this page.', true); }
});

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

$('saveKey').addEventListener('click', async () => {
  const k = $('key').value.trim();
  await chrome.storage.local.set({ apiKey: k });
  $('key').value = '';
  setStatus(k ? 'API key saved.' : 'API key removed.');
});

// ---------- start ----------
(async function init() {
  const tab = await activeTab();
  env = buildEnv(tab);
  if (tab) await Promise.all([collect(tab), capture(tab)]);
  renderCapture();
  renderEvidence();
  renderHistory();
})();
