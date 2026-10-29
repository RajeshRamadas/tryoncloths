/* Private, offline review page. No networking or automatic storage. */
(() => {
  'use strict';
  const report = window.evaluationData;
  let index = 0;
  const drafts = new Map();
  const $ = id => document.getElementById(id);
  const keys = c => Object.keys(report.rubric).filter(k => c.task === 'tryon' || k !== 'garment');
  const key = (c, p) => `${c.id}/${p.id}`;
  function element(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }
  function rating(c, p) {
    const id = key(c, p);
    if (!drafts.has(id)) drafts.set(id, { caseId: c.id, providerId: p.id, scores: {}, notes: '' });
    return drafts.get(id);
  }
  const complete = (c, r) => keys(c).every(k => Number.isInteger(r.scores[k]) && r.scores[k] >= 1 && r.scores[k] <= 5);
  function completed() {
    return [...drafts.values()].filter(r => complete(report.cases.find(c => c.id === r.caseId), r));
  }
  function status() {
    const total = report.cases.reduce((n, c) => n + c.results.filter(r => r.status === 'review_required').length, 0);
    $('status').textContent = `${completed().length} of ${total} reviewable outputs scored. Failed, rejected and unrun cases remain in the report. Pilot targets require live results; fixtures do not count.`;
  }
  function picture(source, alt, parent) {
    const img = element('img', undefined, parent); img.src = source; img.alt = alt;
  }
  function render() {
    const c = report.cases[index], area = $('case'); area.replaceChildren();
    element('h2', `${c.id} · ${c.task} · ${c.profileId}`, area).id = 'case-title';
    $('position').textContent = `${index + 1} / ${report.cases.length}`;
    $('previous').disabled = index === 0; $('next').disabled = index === report.cases.length - 1;
    element('h3', 'Input references', area);
    const references = element('div', undefined, area); references.className = 'references';
    for (const [name, ref] of Object.entries(c.references)) {
      const figure = element('figure', undefined, references);
      picture(ref.image, `${c.id} ${name} reference`, figure); element('figcaption', name, figure);
    }
    element('h3', 'Provider results', area);
    const results = element('div', undefined, area); results.className = 'results';
    for (const p of report.providers) {
      const result = c.results.find(r => r.providerId === p.id), card = element('article', undefined, results);
      element('h3', p.label, card); element('small', `${p.model} · ${p.kind} model · ${p.evidence} evidence (operator supplied)`, card);
      if (result.image) picture(result.image, `${p.label} output for ${c.id}`, card);
      element('p', `Status: ${result.status}${result.failureCode ? ' · ' + result.failureCode : ''}`, card);
      element('small', `Latency: ${result.latencyMs == null ? 'not recorded' : (result.latencyMs / 1000).toFixed(1) + ' s'} · Cost: ${result.costUsd == null ? 'not recorded' : '$' + result.costUsd.toFixed(4)}`, card);
      if (result.status !== 'review_required') {
        element('p', 'Cannot approve this output. Missing results and failed automatic checks must be resolved with a separately authorized attempt.', card).className = 'warning';
        continue;
      }
      const draft = rating(c, p);
      for (const metric of keys(c)) {
        const label = element('label', report.rubric[metric], card);
        const select = element('select', undefined, label);
        select.setAttribute('aria-label', `${p.label}: ${report.rubric[metric]}`);
        const blank = element('option', 'Choose a score', select); blank.value = '';
        for (let score = 1; score <= 5; score++) { const option = element('option', String(score), select); option.value = String(score); }
        select.value = draft.scores[metric] ? String(draft.scores[metric]) : '';
        select.addEventListener('change', () => { draft.scores[metric] = Number(select.value); status(); });
      }
      const label = element('label', 'Review notes (avoid customer names)', card), notes = element('textarea', undefined, label);
      notes.maxLength = 2000; notes.value = draft.notes;
      notes.addEventListener('input', () => { draft.notes = notes.value; });
    }
    status();
  }
  $('previous').addEventListener('click', () => { index--; render(); });
  $('next').addEventListener('click', () => { index++; render(); });
  $('download').addEventListener('click', () => {
    const data = { version: 1, reportId: report.reportId, ratings: completed() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = element('a'); a.href = url; a.download = `review-${report.reportId.slice(0, 12)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('error').textContent = 'Downloaded complete ratings only. Finish any partially scored output before leaving this page.';
  });
  $('import').addEventListener('change', async event => {
    try {
      const file = event.target.files[0];
      if (!file || file.size > 1024 * 1024) throw new Error();
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || data.reportId !== report.reportId || !Array.isArray(data.ratings)) throw new Error();
      const incoming = new Map();
      for (const r of data.ratings) {
        const c = report.cases.find(c => c.id === r.caseId), p = report.providers.find(p => p.id === r.providerId);
        if (!c || !p || c.results.find(result => result.providerId === p.id)?.status !== 'review_required' ||
            !r.scores || !complete(c, r) || typeof r.notes !== 'string' || r.notes.length > 2000 || incoming.has(key(c, p))) throw new Error();
        incoming.set(key(c, p), { caseId: c.id, providerId: p.id, scores: Object.fromEntries(keys(c).map(k => [k, r.scores[k]])), notes: r.notes });
      }
      for (const [key, value] of incoming) drafts.set(key, value);
      $('error').textContent = ''; render();
    } catch { $('error').textContent = 'Cannot load this review. Choose scores exported for this exact report.'; }
    event.target.value = '';
  });
  render();
})();
