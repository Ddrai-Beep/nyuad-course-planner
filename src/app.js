import { parsePlan, pickPlanSheet, termLabel } from './parser.js';
import { buildCatalog, enrich, solve, eligibleCourses, stats, normKey } from './engine.js';
import { readFile, readGoogleSheet, readSample } from './io.js';
import { Votes, LS } from './votes.js';
import { DEFAULT_PLAN, DEFAULT_PLAN_LABEL } from '../config.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  programs: null, catalog: null, offerings: null, votes: null,
  plan: null, courses: [], source: null,
  track: LS.get('track', null),
  overrides: LS.get('overrides', {}),   // { 'major:new': {courseId: reqId|'none'}, minor: {...} }
  manual: LS.get('manual', {}),         // { 'core': {reqId: n} }
  open: new Set(),                      // expanded requirement keys
  error: null, loading: false,
};
const listKey = () => `list:${S.programs.registrationTerm}`;
const getList = () => LS.get(listKey(), []);
const setList = (l) => LS.set(listKey(), l);
const save = () => { LS.set('overrides', S.overrides); LS.set('manual', S.manual); LS.set('track', S.track); };

async function boot() {
  const [programs, catalog, offerings] = await Promise.all(
    ['data/programs.json', 'data/catalog.json', 'data/offerings.json'].map((u) => fetch(u).then((r) => r.json())));
  S.programs = programs;
  S.catalog = buildCatalog(catalog);
  S.offerings = offerings[programs.registrationTerm] || { courses: [], notOffered: {} };
  S.offeredKeys = new Set(S.offerings.courses.map(normKey));
  S.votes = new Votes(programs.registrationTerm);
  document.getElementById('topbar-meta').textContent = `Registering for ${programs.registrationTerm}`;
  S.votes.load().then(render);
  const cached = LS.get('lastPlan', null);
  if (cached) { try { loadSheets(cached.sheets, cached.source, false); } catch { /* ignore */ } }
  else if (DEFAULT_PLAN && !LS.get('skipDefault', false)) {
    try { loadSheets(await readSample(DEFAULT_PLAN), DEFAULT_PLAN_LABEL, false); } catch { /* fall back to upload screen */ }
  }
  render();
}

function loadSheets(sheets, source, persist = true) {
  const sheet = pickPlanSheet(sheets);
  const plan = parsePlan(sheet.grid);
  if (!plan.courses.length) throw new Error(plan.warnings[0]?.text || 'No courses found.');
  S.plan = plan; S.source = source;
  S.courses = plan.courses.map((c) => enrich(c, S.catalog));
  if (persist) LS.set('lastPlan', { sheets: [{ name: sheet.name, grid: sheet.grid }], source });
  S.error = null;
}

async function withLoad(fn, source) {
  S.loading = true; S.error = null; render();
  try { loadSheets(await fn(), source); } catch (e) { S.error = e.message || String(e); }
  S.loading = false; render();
}

// ---------- analysis ----------
function analyse() {
  const P = S.programs;
  const ov = (k) => S.overrides[k] || {};
  const mn = (k) => S.manual[k] || {};
  const tracks = P.major.tracks.map((t) => {
    const r = solve(t.requirements, S.courses, ov(`major:${t.id}`), mn(`major:${t.id}`));
    return { track: t, result: r, left: r.summary.needed, };
  });
  const best = [...tracks].sort((a, b) => a.left - b.left || a.result.summary.planned - b.result.summary.planned)[0];
  const trackId = S.track && tracks.find((t) => t.track.id === S.track) ? S.track : best.track.id;
  const major = tracks.find((t) => t.track.id === trackId);
  const minor = solve(P.minor.requirements, S.courses, ov('minor'), mn('minor'));
  const core = solve(P.core.requirements, S.courses, ov('core'), mn('core'));
  const gened = solve(P.gened.requirements, S.courses, ov('gened'), mn('gened'));
  const st = stats(S.courses, P.graduation.credits);
  return { tracks, best, major, trackId, minor, core, gened, st, flags: flags(major, minor) };
}

function flags(major, minor) {
  const out = [...S.plan.warnings];
  const term = S.programs.registrationTerm;
  for (const c of S.courses) {
    const name = `<b>${esc(c.displayCode || c.raw)}</b>`;
    const inMajor = major.result.used.has(c.id), inMinor = minor.used.has(c.id);
    if (c.status === 'slot') continue;
    if (/minor/i.test(c.reqText) && !inMinor && c.subject !== 'ECON')
      out.push({ level: 'warn', text: `${name} is marked "Minor" in your plan, but only ECON-subject courses count toward the Economics minor.` });
    if (/major/i.test(c.reqText) && !inMajor)
      out.push({ level: 'warn', text: `${name} is marked "Major Req" but doesn't fill any Political Science requirement on the <i>${esc(major.track.short)}</i> track. If an advisor approved it, set it under "Your plan" below.` });
    if (/^P$/i.test(c.grade) && (inMajor || inMinor))
      out.push({ level: 'warn', text: `${name} was taken Pass/Fail and is counting toward your ${inMajor ? 'major' : 'minor'}. Check that Pass/Fail is allowed for it.` });
    if (c.tags.has('study-away-equiv') && inMajor)
      out.push({ level: 'info', text: `${name} is counted as Intro to International Politics (study-away equivalent). Confirm it on the PS study-away pathway.` });
    if (c.noGrade && c.status === 'done')
      out.push({ level: 'info', text: `${name} (${esc(c.term.label)}) has no grade listed. I've assumed you completed it.` });
    if (c.creditsAssumed && c.status !== 'planned')
      out.push({ level: 'info', text: `${name} (${esc(c.term.label)}) has no credits listed. Assumed ${c.credits}.` });
    if (c.term.label === term && S.offerings.notOffered[normKey(c.displayCode)])
      out.push({ level: 'warn', text: `${name}: ${esc(S.offerings.notOffered[normKey(c.displayCode)])}` });
  }
  return out;
}

// ---------- render ----------
function render() {
  if (!S.programs) return;
  $app.innerHTML = S.plan ? renderDash() : renderLoad();
}

function renderLoad() {
  return `
  <section class="hero">
    <h1>See exactly what you still need to graduate.</h1>
    <p class="lead">Load your ARC 4-year plan. You'll see what's left for your Political Science major, Economics minor, Core and 128 credits, which courses fill each gap in ${esc(S.programs.registrationTerm)}, and a checklist to work through in Albert.</p>
    ${S.error ? `<div class="alert alert-error">${esc(S.error)}</div>` : ''}
    <div class="load-grid">
      <div class="card load-card">
        <div class="step">A</div>
        <h3>Google Sheets link</h3>
        <p class="muted small">Set sharing to <b>Anyone with the link → Viewer</b>.</p>
        <form id="gsheet-form" class="row">
          <input id="gsheet" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required>
          <button class="btn btn-primary" ${S.loading ? 'disabled' : ''}>Load</button>
        </form>
      </div>
      <div class="card load-card">
        <div class="step">B</div>
        <h3>Upload a file</h3>
        <p class="muted small">.xlsx or .csv of the ARC template.</p>
        <label class="btn btn-secondary file-btn">Choose file<input id="file" type="file" accept=".xlsx,.xls,.csv" hidden></label>
      </div>
      <div class="card load-card">
        <div class="step">C</div>
        <h3>Just looking?</h3>
        <p class="muted small">Try it with a made-up student's plan${DEFAULT_PLAN ? ` or ${esc(DEFAULT_PLAN_LABEL)}` : ''}.</p>
        <button class="btn btn-secondary" data-action="sample">Try sample plan</button>
        ${DEFAULT_PLAN ? `<button class="btn btn-ghost" data-action="default">${esc(DEFAULT_PLAN_LABEL)}</button>` : ''}
      </div>
    </div>
    <p class="muted small privacy">🔒 Your plan stays in this browser. It's never uploaded or stored on a server.</p>
    ${S.loading ? '<p class="muted">Reading your plan…</p>' : ''}
  </section>`;
}

const STATUS = {
  done: ['Done', 'ok'], inprogress: ['In progress', 'prog'], planned: ['Planned', 'plan'],
  slot: ['Slot in plan', 'slot'], needed: ['Needed', 'need'],
};
const pill = (s) => `<span class="pill pill-${STATUS[s][1]}">${STATUS[s][0]}</span>`;

function renderDash() {
  const A = analyse();
  const P = S.programs;
  const st = A.st;
  const pct = (x) => Math.min(100, (x / st.gradCredits) * 100);
  const left = A.major.result.summary.needed + A.minor.summary.needed + A.core.summary.needed + A.gened.summary.needed;
  const m = S.plan.meta;
  const warn = A.flags.filter((f) => f.level !== 'info'), info = A.flags.filter((f) => f.level === 'info');

  return `
  <section class="summary card">
    <div class="summary-head">
      <div>
        <h1 class="h2">${esc(m.majors || 'Political Science')}${m.minors ? ` <span class="muted">+ ${esc(m.minors)} minor</span>` : ''}</h1>
        <p class="muted small">${[m.admitted && `Admitted ${esc(m.admitted)}`, m.standing && esc(m.standing), `${S.courses.length} courses read from ${esc(S.source)}`].filter(Boolean).join(' · ')}</p>
      </div>
      <button class="btn btn-ghost small" data-action="reset">Load a different plan</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${left}</div><div class="stat-label">requirements left</div></div>
      <div class="stat"><div class="stat-num">${st.earned}<span class="muted">/${st.gradCredits}</span></div><div class="stat-label">credits earned</div></div>
      <div class="stat"><div class="stat-num">${st.earned + st.inprog + st.planned + st.slots}</div><div class="stat-label">credits if your plan holds</div></div>
      ${st.gpa ? `<div class="stat"><div class="stat-num">${st.gpa.toFixed(2)}</div><div class="stat-label">GPA (from grades listed)</div></div>` : ''}
    </div>
    <div class="bar" title="Earned · in progress · planned">
      <span class="bar-ok" style="width:${pct(st.earned)}%"></span><span class="bar-prog" style="width:${pct(st.inprog)}%"></span><span class="bar-plan" style="width:${pct(st.planned + st.slots)}%"></span>
    </div>
    <div class="legend small muted"><span><i class="dot dot-ok"></i>Earned ${st.earned}</span><span><i class="dot dot-prog"></i>In progress ${st.inprog}</span><span><i class="dot dot-plan"></i>Planned ${st.planned + st.slots}</span><span>Need ${st.gradCredits}</span></div>
  </section>

  ${warn.length || info.length ? `
  <section class="card flags">
    <h2 class="h3">${warn.length} thing${warn.length === 1 ? '' : 's'} to check</h2>
    <ul class="flag-list">${warn.map((f) => `<li class="flag-warn">${f.text}</li>`).join('')}</ul>
    ${info.length ? `<details><summary class="small muted">${info.length} assumption${info.length === 1 ? '' : 's'} I made</summary><ul class="flag-list">${info.map((f) => `<li>${f.text}</li>`).join('')}</ul></details>` : ''}
  </section>` : ''}

  <section>
    <h2 class="section-title"><span class="num">1</span> Pick your bulletin track</h2>
    <p class="muted small section-sub">The PS major changed this year. 2nd and 3rd years can graduate under either bulletin. Here's what you'd have left on each.</p>
    <div class="tracks">
      ${A.tracks.map((t) => `
        <button class="track ${t.track.id === A.trackId ? 'track-on' : ''}" data-action="track" data-id="${t.track.id}">
          ${t === A.best ? '<span class="badge-best">Fewest left</span>' : ''}
          <span class="track-kicker">${esc(t.track.name)}</span>
          <span class="track-name">${esc(t.track.short)}</span>
          <span class="track-left"><b>${t.left}</b> left</span>
          <span class="track-sub">${t.result.summary.done} done · ${t.result.summary.inprogress + t.result.summary.planned} in progress/planned</span>
        </button>`).join('')}
    </div>
    <p class="muted small">Questions about tracks: ${esc(P.major.contact)}</p>
  </section>

  <div class="cols">
    <section class="col-main">
      <h2 class="section-title"><span class="num">2</span> What you still need</h2>
      <p class="muted small section-sub">Open a requirement to see courses that fill it. <b>Offered ${esc(P.registrationTerm)}</b> marks courses on the department's list. Add the ones you want to your registration list.</p>
      ${renderProgram(`major:${A.trackId}`, `${P.major.name} · ${A.major.track.short}`, A.major.result)}
      ${renderProgram('minor', P.minor.name, A.minor)}
      ${renderProgram('core', P.core.name, A.core)}
      ${renderProgram('gened', P.gened.name, A.gened)}
      ${renderPlan(A)}
    </section>
    <aside class="col-side">${renderList()}</aside>
  </div>`;
}

function renderProgram(key, title, res) {
  const s = res.summary;
  const needed = res.reqs.filter((r) => r.status !== 'done').length;
  return `
  <div class="card program">
    <div class="program-head">
      <h3>${esc(title)}</h3>
      <span class="small muted">${needed ? `${s.needed} to go` : '✅ Complete'} · ${s.done}/${res.total} done</span>
    </div>
    <div class="progress"><span style="width:${(s.done / res.total) * 100}%"></span><span class="p2" style="width:${((s.inprogress + s.planned) / res.total) * 100}%"></span></div>
    <ul class="reqs">${res.reqs.map((r) => renderReq(key, r)).join('')}</ul>
  </div>`;
}

function renderReq(pkey, r) {
  const key = `${pkey}|${r.req.id}`;
  const open = S.open.has(key);
  const fills = r.slots.map((s) => {
    if (s.manual) return `<span class="chip chip-ok">Marked done <button class="link" data-action="unmanual" data-p="${pkey}" data-r="${r.req.id}">undo</button></span>`;
    if (!s.course) return '';
    const c = s.course;
    return `<span class="chip chip-${STATUS[c.status][1]}" title="${esc(c.raw)} · ${esc(c.term.label)}">${esc(c.displayCode || c.raw)}${c.status === 'slot' ? ' (no course yet)' : ''} <span class="muted">· ${esc(c.term.label)}</span></span>`;
  }).join('');
  const missing = r.slots.filter((s) => !s.manual && (!s.course || s.course.status === 'slot')).length;
  const countTag = r.req.count > 1 ? `<span class="muted small"> · ${r.filled}/${r.req.count}</span>` : '';
  return `
  <li class="req req-${STATUS[r.status][1]}">
    <div class="req-row">
      <span class="req-icon">${r.status === 'done' ? '✓' : r.status === 'needed' || r.status === 'slot' ? '' : '◐'}</span>
      <div class="req-body">
        <div class="req-label">${esc(r.req.label)}${countTag}</div>
        <div class="chips">${fills}</div>
        ${r.req.note ? `<div class="small muted">${esc(r.req.note)}</div>` : ''}
      </div>
      <div class="req-actions">
        ${pill(r.status)}
        ${missing ? `<button class="btn btn-small ${open ? 'btn-secondary' : 'btn-primary'}" data-action="toggle" data-key="${esc(key)}">${open ? 'Hide' : 'Find courses'}</button>` : ''}
      </div>
    </div>
    ${open && missing ? renderOptions(pkey, r) : ''}
  </li>`;
}

const ALBERT_HINT = {
  cadt: 'CADT-UH', ccea: 'CCEA-UH', cdad: 'CDAD-UH', csts: 'CSTS-UH', ccol: 'CCOL-UH (14-week)', field: 'CCOL-UH …J (J-Term)',
  fyws: 'FYWS', x: 'courses ending in X', e: 'courses ending in E', q: 'courses ending in Q', pe: 'PHYED-UH',
};

function renderOptions(pkey, r) {
  const opts = eligibleCourses(r.req, S.catalog)
    .map((e) => ({ e, offered: S.offeredKeys.has(normKey(e.code)), notOffered: S.offerings.notOffered[normKey(e.code)] }))
    .sort((a, b) => b.offered - a.offered || a.e.code.localeCompare(b.e.code));
  const inList = new Set(getList().map((i) => i.code));
  const term = S.programs.registrationTerm;
  const manualBtn = `<button class="btn btn-ghost btn-small" data-action="manual" data-p="${pkey}" data-r="${r.req.id}">I've already done this</button>`;
  if (!opts.length) {
    return `<div class="options"><p class="small">Search Albert for <b>${esc(ALBERT_HINT[r.req.id] || r.req.label)}</b>, then add the course to your list by code.</p>
      <form class="row add-custom" data-label="${esc(r.req.label)}"><input name="code" placeholder="e.g. CADT-UH 1018" required><button class="btn btn-secondary btn-small">Add to list</button></form>
      <div class="options-foot">${manualBtn}</div></div>`;
  }
  const showAll = S.open.has(`${pkey}|${r.req.id}|all`);
  const shown = showAll ? opts : opts.slice(0, 8);
  return `
  <div class="options">
    <table class="opt-table">
      ${shown.map(({ e, offered, notOffered }) => {
        const v = S.votes.status(e.code);
        return `<tr>
          <td class="opt-code"><code>${esc(e.code)}</code></td>
          <td>${esc(e.title)}${notOffered ? `<div class="small warn-text">${esc(notOffered)}</div>` : ''}</td>
          <td>${offered ? `<span class="tag tag-offered">Offered ${esc(term)}</span>` : '<span class="tag">Check Albert</span>'}${voteBadge(v)}</td>
          <td class="opt-act">${inList.has(e.code) ? '<span class="small muted">On your list</span>' : `<button class="btn btn-small btn-secondary" data-action="add" data-code="${esc(e.code)}" data-title="${esc(e.title)}" data-label="${esc(r.req.label)}">+ Add</button>`}</td>
        </tr>`;
      }).join('')}
    </table>
    <div class="options-foot">
      ${opts.length > 8 ? `<button class="link small" data-action="toggle" data-key="${esc(`${pkey}|${r.req.id}|all`)}">${showAll ? 'Show fewer' : `Show all ${opts.length}`}</button>` : '<span></span>'}
      ${manualBtn}
    </div>
  </div>`;
}

function voteBadge(v) {
  if (v.verdict === 'open') return `<span class="tag tag-open" title="${v.yes} said open, ${v.no} said not running">✓ Open in Albert (${v.yes})</span>`;
  if (v.verdict === 'closed') return `<span class="tag tag-closed" title="${v.yes} said open, ${v.no} said not running">✗ Not running (${v.no})</span>`;
  if (v.verdict === 'split') return `<span class="tag" title="Reports are tied">Reports split ${v.yes}–${v.no}</span>`;
  return '';
}

function renderList() {
  const list = getList();
  const term = S.programs.registrationTerm;
  const done = list.filter((i) => i.registered).length;
  const planned = S.courses.filter((c) => c.term.label === term && c.displayCode && !list.some((i) => i.code === c.displayCode));
  return `
  <div class="card list-card">
    <h2 class="section-title"><span class="num">3</span> Your ${esc(term)} list</h2>
    <ol class="how small">
      <li>Search each code in <b>Albert</b>.</li>
      <li>Report whether it's running. This helps everyone else.</li>
      <li>Tick it once you're registered.</li>
    </ol>
    ${list.length ? `<div class="list-progress small"><b>${done}/${list.length}</b> registered</div>` : ''}
    <ul class="reg-list">
      ${list.map((i, idx) => {
        const v = S.votes.status(i.code);
        return `<li class="reg ${i.registered ? 'reg-done' : ''}">
          <label class="reg-check"><input type="checkbox" data-action="reg" data-idx="${idx}" ${i.registered ? 'checked' : ''}><span></span></label>
          <div class="reg-body">
            <div class="reg-top"><code>${esc(i.code)}</code><button class="icon-btn" data-action="copy" data-code="${esc(i.code)}" title="Copy code">⧉</button><button class="icon-btn" data-action="remove" data-idx="${idx}" title="Remove">✕</button></div>
            <div class="small">${esc(i.title || '')}</div>
            ${i.label ? `<div class="small muted">for: ${esc(i.label)}</div>` : ''}
            <div class="vote-row">
              <span class="small muted">In Albert it's…</span>
              <button class="vote ${v.mine === true ? 'vote-on-yes' : ''}" data-action="vote" data-code="${esc(i.code)}" data-v="1">Open</button>
              <button class="vote ${v.mine === false ? 'vote-on-no' : ''}" data-action="vote" data-code="${esc(i.code)}" data-v="0">Not running</button>
            </div>
            <div class="small">${S.votes.online ? (v.yes + v.no ? `${voteBadge(v)} <span class="muted">${v.yes} open · ${v.no} not running</span>` : '<span class="muted">No reports yet. Be the first.</span>') : ''}</div>
          </div>
        </li>`;
      }).join('') || '<li class="muted small empty">Nothing yet. Use <b>Find courses</b> to add some.</li>'}
    </ul>
    ${planned.length ? `<button class="btn btn-secondary btn-small full" data-action="addplanned">+ Add the ${planned.length} course${planned.length > 1 ? 's' : ''} already in your plan for ${esc(term)}</button>` : ''}
    ${S.votes.online ? '' : '<p class="small muted offline">Shared availability reports are offline, so your reports are saved on this device only.</p>'}
  </div>`;
}

function renderPlan(A) {
  const terms = [];
  for (const c of S.courses) { let t = terms.find((x) => x.label === c.term.label); if (!t) terms.push(t = { label: c.term.label, items: [] }); t.items.push(c); }
  const majorKey = `major:${A.trackId}`;
  const mreqs = A.major.track.requirements, nreqs = S.programs.minor.requirements;
  const assigned = (res, c) => res.reqs.find((r) => r.slots.some((s) => s.course?.id === c.id))?.req.label;
  const sel = (key, reqs, c, cur) => {
    const v = (S.overrides[key] || {})[c.id] || '';
    return `<select data-action="override" data-key="${key}" data-id="${esc(c.id)}">
      <option value="">${cur ? `Auto: ${esc(cur)}` : 'Auto: doesn’t count'}</option>
      ${reqs.map((r) => `<option value="${r.id}" ${v === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
      <option value="none" ${v === 'none' ? 'selected' : ''}>Doesn’t count</option></select>`;
  };
  return `
  <details class="card plan" ${S.open.has('plan') ? 'open' : ''}>
    <summary data-action="plantoggle"><h3>Your plan, as I read it</h3><span class="small muted">Wrong match? Set what each course counts toward.</span></summary>
    ${terms.map((t) => `
      <div class="term"><h4>${esc(t.label)}</h4>
      <table class="plan-table">
        <tr><th>Course</th><th>Status</th><th>Counts toward major</th><th>Counts toward minor</th></tr>
        ${t.items.map((c) => `<tr>
          <td><div>${c.displayCode ? `<code>${esc(c.displayCode)}</code> ` : ''}${esc(c.displayCode ? (c.title || '') : c.raw)}</div>
            <div class="small muted">${[c.grade && `Grade ${esc(c.grade)}`, `${c.credits} cr${c.creditsAssumed ? ' (assumed)' : ''}`, c.reqText && `Plan says: ${esc(c.reqText)}`].filter(Boolean).join(' · ')}</div></td>
          <td>${pill(c.status === 'dropped' ? 'needed' : c.status)}</td>
          <td>${c.status === 'slot' ? '<span class="small muted">placeholder</span>' : sel(majorKey, mreqs, c, assigned(A.major.result, c))}</td>
          <td>${c.status === 'slot' ? '' : sel('minor', nreqs, c, assigned(A.minor, c))}</td>
        </tr>`).join('')}
      </table></div>`).join('')}
  </details>`;
}

// ---------- events ----------
let toastT;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

function addToList(code, title, label) {
  const l = getList();
  if (!l.some((i) => i.code === code)) { l.push({ code, title, label, registered: false }); setList(l); toast(`Added ${code}`); }
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const a = el.dataset.action;
  if (a === 'plantoggle') { ev.preventDefault(); S.open.has('plan') ? S.open.delete('plan') : S.open.add('plan'); return render(); }
  if (a === 'sample') return withLoad(() => readSample(), 'the sample plan');
  if (a === 'default') return withLoad(() => readSample(DEFAULT_PLAN), DEFAULT_PLAN_LABEL);
  if (a === 'reset') { S.plan = null; LS.set('lastPlan', null); LS.set('skipDefault', true); return render(); }
  if (a === 'track') { S.track = el.dataset.id; save(); return render(); }
  if (a === 'toggle') { const k = el.dataset.key; S.open.has(k) ? S.open.delete(k) : S.open.add(k); return render(); }
  if (a === 'add') { addToList(el.dataset.code, el.dataset.title, el.dataset.label); return render(); }
  if (a === 'addplanned') {
    for (const c of S.courses) if (c.term.label === S.programs.registrationTerm && c.displayCode) addToList(c.displayCode, c.cat?.title || c.title, c.reqText);
    return render();
  }
  if (a === 'remove') { const l = getList(); l.splice(+el.dataset.idx, 1); setList(l); return render(); }
  if (a === 'reg') { const l = getList(); l[+el.dataset.idx].registered = el.checked; setList(l); return render(); }
  if (a === 'copy') { try { await navigator.clipboard.writeText(el.dataset.code); toast('Copied. Paste it into Albert search.'); } catch { toast(el.dataset.code); } return; }
  if (a === 'vote') { await S.votes.cast(el.dataset.code, el.dataset.v === '1'); toast('Thanks! Report saved.'); return render(); }
  if (a === 'manual' || a === 'unmanual') {
    const p = el.dataset.p, r = el.dataset.r;
    const m = S.manual[p] || (S.manual[p] = {});
    m[r] = Math.max(0, (m[r] || 0) + (a === 'manual' ? 1 : -1));
    save(); return render();
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'file' && el.files[0]) { const f = el.files[0]; return withLoad(() => readFile(f), f.name); }
  if (el.dataset.action === 'override') {
    const o = S.overrides[el.dataset.key] || (S.overrides[el.dataset.key] = {});
    if (el.value) o[el.dataset.id] = el.value; else delete o[el.dataset.id];
    save(); S.open.add('plan'); render();
  }
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === 'gsheet-form') { const url = f.querySelector('#gsheet').value; return withLoad(() => readGoogleSheet(url), 'Google Sheets'); }
  if (f.classList.contains('add-custom')) {
    const code = f.code.value.trim().toUpperCase();
    if (code) { addToList(code, '', f.dataset.label); render(); }
  }
});

boot().catch((e) => { $app.innerHTML = `<div class="alert alert-error">Couldn't start: ${esc(e.message)}</div>`; });
