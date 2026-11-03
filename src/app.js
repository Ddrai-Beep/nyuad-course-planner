import { parsePlan, pickPlanSheet } from './parser.js';
import { buildCatalog, enrich, solve, eligibleCourses, stats, normKey, reqMatches, isPassFail, setPassFailTerms, belowC, isPFExceptionTerm } from './engine.js';
import { readFile, readGoogleSheet, readSample } from './io.js';
import { Votes, LS } from './votes.js';
import { DEFAULT_PLAN, DEFAULT_PLAN_LABEL } from '../config.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  programs: null, catalog: null, offerings: null, votes: null,
  plan: null, courses: [], source: null,
  majorId: LS.get('majorId', null), track: LS.get('track', null), trackOpen: false,
  minorId: LS.get('minorId', null),
  extraMinors: LS.get('extraMinors', []),
  checkMinor: null,
  overrides: LS.get('overrides', {}),
  manual: LS.get('manual', {}),
  open: new Set(), editRow: null,
  error: null, loading: false,
};
const listKey = () => `list:${S.programs.registrationTerm}`;
const getList = () => LS.get(listKey(), []);
const setList = (l) => LS.set(listKey(), l);
const save = () => {
  LS.set('overrides', S.overrides); LS.set('manual', S.manual); LS.set('track', S.track); LS.set('majorId', S.majorId);
  LS.set('minorId', S.minorId); LS.set('extraMinors', S.extraMinors);
};

async function boot() {
  const [programs, catalog, offerings] = await Promise.all(
    ['data/programs.json', 'data/catalog.json', 'data/offerings.json'].map((u) => fetch(u).then((r) => r.json())));
  S.programs = programs;
  setPassFailTerms(programs.policy?.passFailCounts?.terms);
  S.catalog = buildCatalog(catalog);
  S.offerings = offerings[programs.registrationTerm] || { courses: [], notOffered: {} };
  S.offeredKeys = new Set(S.offerings.courses.map(normKey));
  S.votes = new Votes(programs.registrationTerm);
  document.getElementById('topbar-meta').textContent = `Registering for ${programs.registrationTerm}`;
  S.votes.load().then(render);
  const cached = LS.get('lastPlan', null);
  if (cached) { try { loadSheets(cached.sheets, cached.source, false); } catch { /* ignore */ } }
  else if (DEFAULT_PLAN && !LS.get('skipDefault', false)) {
    try { loadSheets(await readSample(DEFAULT_PLAN), DEFAULT_PLAN_LABEL, false); } catch { /* upload screen */ }
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
const COMPETENCIES = ['cadt', 'ccea', 'cdad', 'csts'];
const GENERIC = (c) => c.status === 'slot' && !c.hint;

function minorById(id) { return S.programs.minors.find((m) => m.id === id); }
// The major: picked by hand, else read from the plan's "Major(s)" line (earliest mention wins), else Political Science
function detectMajor() {
  const txt = (S.plan?.meta.majors || '').toLowerCase();
  const hits = S.programs.majors.map((m) => ({ m, i: txt.indexOf(m.match) })).filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i || b.m.match.length - a.m.match.length);
  return hits[0]?.m || S.programs.majors[0];
}
function majorDef() { return S.programs.majors.find((m) => m.id === S.majorId) || detectMajor(); }
function defaultMinor() {
  const txt = (S.plan.meta.minors || '').toLowerCase();
  return S.programs.minors.find((m) => txt.includes(m.match)) || S.programs.minors[0];
}

function analyse() {
  const P = S.programs;
  const ov = (k) => S.overrides[k] || {};
  const mn = (k) => S.manual[k] || {};
  const minorDef = minorById(S.minorId) || defaultMinor();
  const M = majorDef();
  const chosen = M.tracks.find((t) => t.id === S.track);

  // Core first, steering away from courses the major/minor could use.
  const majorish = new Set(S.courses.filter((c) =>
    [...(chosen || M.tracks[0]).requirements, ...minorDef.requirements].some((r) => reqMatches(c, r))).map((c) => c.id));
  const core = solve(P.core.requirements, S.courses, ov('core'), mn('core'), { avoid: majorish });
  // Policy: a Core competency course can't also count toward a major or minor.
  const coreComp = new Set(core.reqs.filter((r) => COMPETENCIES.includes(r.req.id)).flatMap((r) => r.slots.map((s) => s.course?.id)).filter(Boolean));

  const tracks = M.tracks.map((t) => {
    const r = solve(t.requirements, S.courses, ov(`major:${t.id}`), mn(`major:${t.id}`), { exclude: coreComp });
    return { track: t, result: r, left: notDone(r) };
  });
  const best = [...tracks].sort((a, b) => a.left - b.left || a.result.summary.planned - b.result.summary.planned)[0];
  const trackId = chosen ? chosen.id : best.track.id;
  const major = tracks.find((t) => t.track.id === trackId);
  const minor = solve(minorDef.requirements, S.courses, ov(`minor:${minorDef.id}`), mn(`minor:${minorDef.id}`), { exclude: coreComp, avoid: major.result.used });
  const gened = solve(P.gened.requirements, S.courses, ov('gened'), mn('gened'));
  const extras = S.extraMinors.map(minorById).filter((m) => m && m.id !== minorDef.id).map((m) => ({
    def: m, result: solve(m.requirements, S.courses, ov(`minor:${m.id}`), mn(`minor:${m.id}`), { exclude: coreComp, avoid: new Set([...major.result.used, ...minor.used]) }),
  }));
  const st = stats(S.courses, P.graduation.credits);
  // Electives per policy: 128 minus what you've taken/are taking, minus the credits your
  // remaining major, minor and Core requirements will take. Ignores what the plan pencils in.
  const genericSlots = S.courses.filter((c) => GENERIC(c) && c.term.order > 0);
  const seen = new Set(); let reqCredits = 0, reqCount = 0;
  for (const res of [major.result, minor, core, ...extras.map((x) => x.result)]) {
    for (const r of res.reqs) for (const sl of r.slots) {
      if (sl.manual) continue;
      const c = sl.course;
      if (c && c.status === 'done') continue;
      if (c) { if (seen.has(c.id)) continue; seen.add(c.id); }
      reqCredits += r.req.credits ?? (r.req.id === 'field' ? 3 : 4); reqCount++;
    }
  }
  reqCredits = Math.round(reqCredits);
  const electiveCredits = Math.max(0, P.graduation.credits - st.earned - reqCredits);
  const needE = gened.reqs.some((r) => r.req.id === 'e' && r.status === 'needed');
  const electives = { left: Math.ceil(electiveCredits / 4), credits: electiveCredits, openSlots: genericSlots.length, reqCredits, reqCount, needE };
  const ctx = { M, tracks, best, major, trackId, minorDef, minor, core, gened, extras, st, electives, coreComp };
  ctx.flags = flags(ctx);
  return ctx;
}

// Nothing counts as taken until it's done: in-progress and planned courses are still "left"
const notDone = (res) => res.total - res.summary.done;

function uniqueCount(minorRes, majorUsed) {
  return minorRes.reqs.flatMap((r) => r.slots).filter((s) => (s.course && !majorUsed.has(s.course.id)) || (!s.course && !s.manual)).length;
}

function flags({ M, major, minor, minorDef, coreComp }) {
  const out = [...S.plan.warnings];
  const term = S.programs.registrationTerm;
  for (const c of S.courses) {
    if (c.status === 'slot') continue;
    const name = `<b>${esc(c.displayCode || c.raw)}</b>`;
    const inMajor = major.result.used.has(c.id), inMinor = minor.used.has(c.id);
    if (isPassFail(c) && (/major|minor|core/i.test(c.reqText) || c.tags.size))
      out.push({ level: 'warn', text: `${name} was taken Pass/Fail. NYUAD policy: Pass/Fail courses don't count toward the Core, a major or a minor (the Spring 2026 exception doesn't cover ${esc(c.term.label)}), so I haven't counted it. If you were granted an exception, set it under "Your plan".` });
    if (/minor/i.test(c.reqText) && !inMinor && !(minorDef.id === 'econ' && c.subject === 'ECON'))
      out.push({ level: 'warn', text: `${name} is marked "Minor" in your plan but doesn't fill ${/^[AEIOU]/.test(minorDef.name) ? 'an' : 'a'} ${esc(minorDef.name)} requirement.${minorDef.id === 'econ' ? ' Only ECON-subject courses count as Economics electives.' : ''}` });
    if (/major/i.test(c.reqText) && !inMajor && !isPassFail(c)) {
      const full = major.result.reqs.find((r) => reqMatches(c, r.req));
      const why = coreComp.has(c.id) ? ' It counts for a Core competency, which can\'t double-count.'
        : full ? ` It would count as "${esc(full.req.label)}", but that's already filled by ${full.slots.map((sl) => `<b>${esc(sl.course?.displayCode || sl.course?.raw || 'a course')}</b>`).join(', ')}.` : '';
      out.push({ level: 'warn', text: `${name} is marked "Major Req" but doesn't fill ${/^[AEIOU]/.test(M.name) ? 'an' : 'a'} ${esc(shortMajor(M))} requirement${M.tracks.length > 1 ? ` on the <i>${esc(major.track.short)}</i> track` : ''}.${why}` });
    }
    if (c.tags.has('study-away-equiv') && inMajor)
      out.push({ level: 'info', text: `${name} is counted as Intro to International Politics (study-away equivalent). Confirm it on the PS study-away pathway.` });
    if (c.noGrade && c.status === 'done')
      out.push({ level: 'info', text: `${name} (${esc(c.term.label)}) has no grade listed. I've assumed you completed it.` });
    if (c.creditsAssumed && c.status !== 'planned')
      out.push({ level: 'info', text: `${name} (${esc(c.term.label)}) has no credits listed. Assumed ${c.credits}.` });
    if (c.term.label === term && S.offerings.notOffered[normKey(c.displayCode)])
      out.push({ level: 'warn', text: `${name}: ${esc(S.offerings.notOffered[normKey(c.displayCode)])}` });
  }
  for (const c of S.courses) {
    if (c.status === 'slot') continue;
    const name = `<b>${esc(c.displayCode || c.raw)}</b>`;
    if (belowC(c)) out.push({ level: 'warn', text: `${name} got a ${esc(c.grade)}. Only a C or higher satisfies major, minor, Core and prerequisite requirements, so it only counts toward your 128 credits.` });
    if (/^P$/i.test(c.grade) && !c.pe && isPFExceptionTerm(c) && (major.result.used.has(c.id) || minor.used.has(c.id)))
      out.push({ level: 'info', text: `${name} (P, ${esc(c.term.label)}) counts toward your requirements under the Spring 2026 grading policy, but it doesn't meet prerequisites for later courses. Check with the ARC if a course you plan needs it.` });
  }
  const pfUsed = S.courses.filter((c) => /^P$/i.test(c.grade) && !c.pe && !isPFExceptionTerm(c)).length;
  if (pfUsed > S.programs.policy.passFailLimit) out.push({ level: 'warn', text: `You have ${pfUsed} Pass/Fail courses. The limit is ${S.programs.policy.passFailLimit} (Spring 2026 doesn't count toward it).` });
  const st = stats(S.courses, S.programs.graduation.credits);
  if (st.gpa !== null && st.gpa < S.programs.graduation.gpa) out.push({ level: 'warn', text: `Your GPA from the grades listed is ${st.gpa.toFixed(2)}. You need at least ${S.programs.graduation.gpa.toFixed(1)} to graduate.` });
  const uniq = uniqueCount(minor, major.result.used);
  if (uniq < S.programs.policy.minorUnique)
    out.push({ level: 'warn', text: `Your ${esc(minorDef.name)} needs at least ${S.programs.policy.minorUnique} courses that don't also count toward your major. Right now only ${uniq} would be unique.` });
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
    <p class="lead">Load your ARC 4-year plan to see what's left for your major, minor, Core and 128 credits, which courses fill each gap in ${esc(S.programs.registrationTerm)}, and a checklist for Albert.</p>
    ${S.error ? `<div class="alert alert-error">${esc(S.error)}</div>` : ''}
    <div class="load-grid">
      <div class="card load-card">
        <h3>Google Sheets link</h3>
        <p class="muted small">Set sharing to <b>Anyone with the link → Viewer</b>.</p>
        <form id="gsheet-form" class="row">
          <input id="gsheet" type="url" placeholder="https://docs.google.com/spreadsheets/d/…" required>
          <button class="btn btn-primary" ${S.loading ? 'disabled' : ''}>Load</button>
        </form>
      </div>
      <div class="card load-card">
        <h3>Upload a file</h3>
        <p class="muted small">.xlsx or .csv of the ARC template.</p>
        <label class="btn btn-secondary file-btn">Choose file<input id="file" type="file" accept=".xlsx,.xls,.csv" hidden></label>
      </div>
      <div class="card load-card">
        <h3>Just looking?</h3>
        <p class="muted small">Open an example plan.</p>
        <div class="row-wrap">
          ${DEFAULT_PLAN ? `<button class="btn btn-secondary" data-action="default">${esc(DEFAULT_PLAN_LABEL)}</button>` : ''}
          <button class="btn btn-ghost" data-action="sample">Sample plan</button>
        </div>
      </div>
    </div>
    <p class="muted small privacy">Your plan stays in this browser.</p>
    ${S.loading ? '<p class="muted">Reading your plan…</p>' : ''}
  </section>`;
}

const STATUS = {
  done: ['Done', 'ok'], inprogress: ['In progress', 'plan'], planned: ['Planned', 'plan'],
  slot: ['Planned', 'plan'], needed: ['Needed', 'need'],
};
const pill = (s) => `<span class="pill pill-${STATUS[s][1]}">${STATUS[s][0]}</span>`;

function renderDash() {
  const A = analyse();
  const P = S.programs;
  const st = A.st, el = A.electives;
  const G = st.gradCredits;
  const pct = (x) => Math.min(100, (x / G) * 100);
  const left = notDone(A.major.result) + notDone(A.minor) + notDone(A.core) + notDone(A.gened);
  const plannedReq = el.reqCredits;
  const m = S.plan.meta;
  const warn = A.flags.filter((f) => f.level !== 'info'), info = A.flags.filter((f) => f.level === 'info');

  return `
  <section class="summary card">
    <div class="summary-head">
      <h1 class="h2">${esc(m.majors || A.M.name)}${m.minors ? ` <span class="muted">+ ${esc(m.minors)} minor</span>` : ''}</h1>
      <button class="btn btn-ghost small" data-action="reset">Load a different plan</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-num">${left}</div><div class="stat-label">requirements not yet completed</div></div>
      <div class="stat"><div class="stat-num">${el.left}</div><div class="stat-label">electives left after major, minor &amp; Core <span class="muted">(${el.credits} cr${el.needE ? ', one must be an E course' : ''})</span></div></div>
      <div class="stat"><div class="stat-num">${st.earned}<span class="muted">/${G}</span></div><div class="stat-label">credits earned</div></div>
      ${st.gpa ? `<div class="stat"><div class="stat-num">${st.gpa.toFixed(2)}</div><div class="stat-label">GPA</div></div>` : ''}
    </div>
    <div class="bar">
      <span class="bar-ok" style="width:${pct(st.earned)}%"></span><span class="bar-plan" style="width:${pct(Math.max(0, plannedReq))}%"></span><span class="bar-elec" style="width:${pct(el.credits)}%"></span>
    </div>
    <div class="legend small"><span><i class="dot dot-ok"></i>Completed ${st.earned}</span><span><i class="dot dot-plan"></i>Requirements still to complete ${plannedReq} (${el.reqCount} courses, incl. in progress)</span><span><i class="dot dot-elec"></i>Electives left ${el.credits}</span><span>Total ${G}</span></div>
  </section>

  ${warn.length || info.length ? `
  <section class="card flags">
    <h2 class="h3">${warn.length} thing${warn.length === 1 ? '' : 's'} to check</h2>
    <ul class="flag-list">${warn.map((f) => `<li>${f.text}</li>`).join('')}</ul>
    ${info.length ? `<details><summary class="small muted">${info.length} assumption${info.length === 1 ? '' : 's'} I made</summary><ul class="flag-list">${info.map((f) => `<li>${f.text}</li>`).join('')}</ul></details>` : ''}
  </section>` : ''}

  ${renderTracks(A)}

  <div class="cols">
    <section class="col-main">
      <h2 class="section-title"><span class="num">2</span> What you still need</h2>
      ${renderProgram(`major:${A.trackId}`, A.M.tracks.length > 1 ? `${A.M.name} · ${A.major.track.short}` : A.M.name, A.major.result)}
      ${renderProgram(`minor:${A.minorDef.id}`, A.minorDef.name, A.minor)}
      ${A.extras.map((x) => renderProgram(`minor:${x.def.id}`, x.def.name, x.result, `<button class="link small" data-action="dropminor" data-id="${x.def.id}">Remove</button>`)).join('')}
      ${renderProgram('core', P.core.name, A.core)}
      ${renderProgram('gened', P.gened.name, A.gened)}
      ${renderBoth(A)}
      ${renderMinorCheck(A)}
    </section>
    <aside class="col-side">${renderList()}</aside>
  </div>
  ${renderPlan(A)}`;
}

const shortMajor = (M) => M.name.replace(/ \((BA|BS)\)$/, '');

function majorSelect() {
  const auto = detectMajor();
  const opts = [...S.programs.majors].sort((a, b) => a.name.localeCompare(b.name));
  return `<label class="major-pick small"><span class="muted">Major</span>
    <select data-action="major" aria-label="Major">
      <option value="" ${!S.majorId ? 'selected' : ''}>From your plan: ${esc(shortMajor(auto))}</option>
      ${opts.map((m) => `<option value="${m.id}" ${S.majorId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
    </select></label>`;
}

function renderTracks(A) {
  const M = A.M;
  const single = M.tracks.length === 1;
  const src = `<span title="${esc(M.source || '')}">Source: ${esc((M.source || '').split(' (')[0])}</span>`;
  if (single || (M.tracks.some((t) => t.id === S.track) && !S.trackOpen)) {
    const t = A.major;
    return `<section class="card track-collapsed">
      <span class="num">1</span>
      <div><div class="small muted">${single ? 'Major' : 'Major and track'}</div><b>${esc(M.name)}</b>${single ? '' : ` · ${esc(t.track.short)}`} <span class="muted">· ${t.left} left</span>
        <div class="small muted">${M.trackNote ? `${esc(M.trackNote)} ` : ''}${src}</div></div>
      ${majorSelect()}
      ${single ? '' : '<button class="btn btn-ghost btn-small" data-action="trackopen">Change track</button>'}
    </section>`;
  }
  return `
  <section>
    <div class="section-row"><h2 class="section-title"><span class="num">1</span> Pick your ${M.id === 'ps' ? 'bulletin track' : 'track'}</h2>${majorSelect()}</div>
    <p class="muted small section-sub">${esc(M.trackNote || '')}${M.contact ? ` Questions: ${esc(M.contact)}.` : ''} ${src}</p>
    <div class="tracks">
      ${A.tracks.map((t) => `
        <button class="track ${t.track.id === A.trackId ? 'track-on' : ''}" data-action="track" data-id="${t.track.id}">
          ${t === A.best ? '<span class="badge-best">Fewest left</span>' : ''}
          <span class="track-kicker">${esc(t.track.name)}</span>
          <span class="track-name">${esc(t.track.short)}</span>
          <span class="track-left"><b>${t.left}</b> left</span>
          <span class="track-sub">${t.result.summary.done} done of ${t.result.total}</span>
        </button>`).join('')}
    </div>
  </section>`;
}

function renderProgram(key, title, res, extra = '') {
  const s = res.summary;
  const complete = !res.reqs.some((r) => r.status !== 'done');
  const rows = res.reqs.flatMap((r) => r.slots.map((slot, i) => renderSlot(key, r, slot, i)));
  return `
  <div class="card program">
    <div class="program-head">
      <h3>${esc(title)}</h3>
      <span class="small muted">${complete ? 'Complete' : `${res.total - s.done} left`} · ${s.done}/${res.total} done ${extra}</span>
    </div>
    <div class="progress"><span style="width:${(s.done / res.total) * 100}%"></span></div>
    <ul class="reqs">${rows.join('')}</ul>
  </div>`;
}

function renderSlot(pkey, r, slot, i) {
  const status = slot.manual ? 'done' : slot.course ? (slot.course.status === 'slot' ? 'planned' : slot.course.status) : 'needed';
  const label = r.req.count > 1 ? `${r.req.label} ${i + 1}` : r.req.label;
  const key = `${pkey}|${r.req.id}|${i}`;
  const open = S.open.has(key);
  const c = slot.course;
  let fill = '';
  if (slot.manual) fill = `<div class="fill">Marked done · <button class="link" data-action="unmanual" data-p="${pkey}" data-r="${r.req.id}">undo</button></div>`;
  else if (c && c.status === 'slot') fill = `<div class="fill muted">${esc(c.raw)} · ${esc(c.term.label)} · course not chosen yet</div>`;
  else if (c) fill = `<div class="fill"><span class="fill-code">${esc(c.displayCode || c.raw)}</span>${c.displayCode && c.title && c.title !== c.raw ? ` ${esc(c.title)}` : ''} <span class="muted">· ${esc(c.term.label)}</span></div>`;
  const canFind = !slot.manual && (!c || c.status === 'slot');
  const term = S.programs.registrationTerm;
  const canAdd = c && c.displayCode && c.status === 'planned' && !getList().some((x) => x.code === c.displayCode);
  return `
  <li class="req req-${STATUS[status][1]}">
    <div class="req-row">
      <span class="req-icon">${status === 'done' ? '✓' : status === 'needed' ? '' : '◐'}</span>
      <div class="req-body">
        <div class="req-label">${esc(label)}</div>
        ${fill}
        ${r.req.note && i === 0 && status !== 'done' ? `<div class="small muted">${esc(r.req.note)}</div>` : ''}
      </div>
      <div class="req-actions">
        ${status === 'done' ? '' : pill(status)}
        ${canAdd ? `<button class="btn btn-small btn-secondary" data-action="add" data-code="${esc(c.displayCode)}" data-title="${esc(c.cat?.title || c.title)}" data-label="${esc(label)}">+ Add to ${esc(term)}</button>` : ''}
        ${canFind ? `<button class="btn btn-small ${open ? 'btn-secondary' : 'btn-primary'}" data-action="toggle" data-key="${esc(key)}">${open ? 'Hide' : 'Find courses'}</button>` : ''}
      </div>
    </div>
    ${open && canFind ? renderOptions(pkey, r, key) : ''}
  </li>`;
}

function optionRows(list, label) {
  const inList = new Set(getList().map((i) => i.code));
  const term = S.programs.registrationTerm;
  return list.map(({ e, offered, notOffered }) => {
    const v = S.votes.status(e.code);
    return `<tr>
      <td class="opt-code"><code>${esc(e.code)}</code></td>
      <td>${e.title ? esc(e.title) : '<span class="muted">Title in Albert</span>'}${notOffered ? `<div class="small warn-text">${esc(notOffered)}</div>` : ''}</td>
      <td>${offered ? `<span class="tag tag-offered">Offered ${esc(term)}</span>` : '<span class="tag">Check Albert</span>'}${voteBadge(v)}</td>
      <td class="opt-act">${inList.has(e.code) ? '<span class="small muted">On your list</span>' : `<button class="btn btn-small btn-secondary" data-action="add" data-code="${esc(e.code)}" data-title="${esc(e.title)}" data-label="${esc(label)}">+ Add</button>`}</td>
    </tr>`;
  }).join('');
}

function renderOptions(pkey, r, key) {
  const opts = eligibleCourses(r.req, S.catalog)
    .map((e) => ({ e, offered: S.offeredKeys.has(normKey(e.code)), notOffered: S.offerings.notOffered[normKey(e.code)] }))
    .sort((a, b) => b.offered - a.offered || a.e.code.localeCompare(b.e.code));
  const manualBtn = `<button class="btn btn-ghost btn-small" data-action="manual" data-p="${pkey}" data-r="${r.req.id}">I've already done this</button>`;
  if (!opts.length) {
    return `<div class="options"><p class="small">Search Albert for this requirement, then add the course by code.</p>
      <form class="row add-custom" data-label="${esc(r.req.label)}"><input name="code" placeholder="e.g. PHIL-UH 2614" required><button class="btn btn-secondary btn-small">Add to list</button></form>
      <div class="options-foot"><span></span>${manualBtn}</div></div>`;
  }
  const showAll = S.open.has(`${key}|all`);
  const shown = showAll ? opts : opts.slice(0, 8);
  return `
  <div class="options">
    <table class="opt-table">${optionRows(shown, r.req.label)}</table>
    <div class="options-foot">
      ${opts.length > 8 ? `<button class="link small" data-action="toggle" data-key="${esc(`${key}|all`)}">${showAll ? 'Show fewer' : `Show all ${opts.length}`}</button>` : '<span></span>'}
      ${manualBtn}
    </div>
  </div>`;
}

// Courses that fill an open major requirement AND an open minor requirement
function renderBoth(A) {
  const openReqs = (res) => res.reqs.filter((r) => r.slots.some((s) => !s.manual && (!s.course || s.course.status === 'slot'))).map((r) => r.req);
  const majOpen = openReqs(A.major.result), minOpen = openReqs(A.minor);
  const current = S.courses.filter((c) => A.major.result.used.has(c.id) && A.minor.used.has(c.id));
  const cands = [];
  for (const e of S.catalog.values()) {
    if (e.alias_of) continue;
    const mj = majOpen.filter((r) => eligibleCourses(r, new Map([[e.key, e]])).length);
    const mi = minOpen.filter((r) => eligibleCourses(r, new Map([[e.key, e]])).length);
    if (mj.length && mi.length) cands.push({ e, offered: S.offeredKeys.has(normKey(e.code)), notOffered: S.offerings.notOffered[normKey(e.code)], mj, mi });
  }
  let general = false;
  if (!cands.length) {
    // Nothing fills an open slot in both: show courses that count toward both programs at all
    general = true;
    for (const e of S.catalog.values()) {
      if (e.alias_of) continue;
      const one = new Map([[e.key, e]]);
      if (A.major.track.requirements.some((r) => eligibleCourses(r, one).length) && A.minorDef.requirements.some((r) => eligibleCourses(r, one).length))
        cands.push({ e, offered: S.offeredKeys.has(normKey(e.code)), notOffered: S.offerings.notOffered[normKey(e.code)] });
    }
  }
  cands.sort((a, b) => b.offered - a.offered || a.e.code.localeCompare(b.e.code));
  const uniq = uniqueCount(A.minor, A.major.result.used);
  const need = S.programs.policy.minorUnique;
  const open = S.open.has('both');
  return `
  <div class="card program">
    <div class="program-head"><h3>Counts for both: ${esc(A.M.tracks.length > 1 ? `${shortMajor(A.M)} (${A.major.track.short})` : shortMajor(A.M))} major + ${esc(A.minorDef.name.replace(' (Minor)', ''))} minor</h3>
      <button class="btn btn-small btn-secondary" data-action="toggle" data-key="both">${open ? 'Hide' : 'Show'}</button></div>
    ${open ? `<div class="both-body">
      <p class="small">Already double-counting: ${current.length ? current.map((c) => `<b>${esc(c.displayCode || c.raw)}</b>`).join(', ') : 'none'}.
      NYUAD lets a course count for a major and a minor, but each minor needs at least ${need} courses of its own. You have <b>${uniq}</b>${uniq < need ? ', so be careful adding more overlap.' : '.'}</p>
      ${cands.length ? `<p class="small muted">${general ? 'None of your open requirements overlap. These courses can count toward both programs in general:' : 'Courses that would fill an open requirement in both:'}</p>
      <table class="opt-table">${optionRows(cands.slice(0, 12).map((x) => ({ ...x })), 'Major + minor')}
      </table>${cands.length > 12 ? `<p class="small muted">+${cands.length - 12} more</p>` : ''}` : '<p class="small muted">No catalog course fills an open requirement in both right now.</p>'}
    </div>` : ''}
  </div>`;
}

// Every other minor, ranked by how much of it you've already done
function renderMinorCheck(A) {
  const used = new Set([...A.major.result.used, ...A.minor.used]);
  const free = A.electives.left;
  const ranked = S.programs.minors.filter((m) => m.id !== A.minorDef.id && !S.extraMinors.includes(m.id)).map((m) => {
    const r = solve(m.requirements, S.courses, S.overrides[`minor:${m.id}`] || {}, {}, { exclude: A.coreComp, avoid: used });
    const done = r.summary.done;
    // Courses that would count but are blocked because they fill a Core competency
    const blocked = S.courses.filter((c) => A.coreComp.has(c.id) && m.requirements.some((q) => reqMatches(c, q)))
      .map((c) => ({ c, req: m.requirements.find((q) => reqMatches(c, q)), core: A.core.reqs.find((q) => q.slots.some((sl) => sl.course?.id === c.id))?.req.label }));
    return { m, r, done, total: r.total, needed: r.total - done, uniq: uniqueCount(r, used), blocked };
  }).sort((a, b) => b.done / b.total - a.done / a.total || (b.r.summary.planned) - (a.r.summary.planned) || a.needed - b.needed);
  return `
  <div class="card program">
    <div class="program-head"><h3>Add a minor?</h3><span class="small muted">Ranked by how much you've already completed</span></div>
    <ul class="reqs">${ranked.map((x) => {
      const open = S.checkMinor === x.m.id;
      const fits = x.needed <= free;
      return `<li class="req">
        <div class="req-row minor-row" data-action="checkminor" data-id="${x.m.id}">
          <div class="req-body"><div class="req-label">${esc(x.m.name.replace(' (Minor)', ''))}</div>
            <div class="mini-bar"><span style="width:${(x.done / x.total) * 100}%"></span></div></div>
          <div class="req-actions"><span class="small"><b>${x.done}/${x.total}</b> done</span>${fits ? '<span class="pill pill-ok">Fits</span>' : '<span class="pill pill-need">Overload</span>'}</div>
        </div>
        ${open ? `<div class="options">
          <ul class="small plain">${x.r.reqs.flatMap((q) => q.slots.map((s, i) => {
            const st = s.course ? (s.course.status === 'slot' ? 'planned' : s.course.status) : 'needed';
            return `<li>${st === 'done' ? '✓' : st === 'needed' ? '○' : '◐'} ${esc(q.req.count > 1 ? `${q.req.label} ${i + 1}` : q.req.label)}${s.course && st !== 'planned' ? ` · <span class="muted">${esc(s.course.displayCode || s.course.raw)}</span>` : ''}</li>`;
          })).join('')}</ul>
          <div class="dc-note small">
            <b>Double-counting:</b> a course can count toward this minor and your major (each minor needs ${S.programs.policy.minorUnique} courses of its own), but <b>not</b> toward this minor and a Core competency (CADT, CCEA, CDAD, CSTS), per NYUAD academic policy.
            ${x.blocked.length ? x.blocked.map((b) => `<div>• <b>${esc(b.c.displayCode || b.c.raw)}</b> would count as "${esc(b.req.label)}", but it's filling your ${esc(b.core || 'Core')} requirement, so it can't count here.</div>`).join('') : `<div>• None of your courses match this minor's requirements${x.m.id === 'phil' ? '. Philosophy only takes PHIL-UH courses, and Global Ethics is CSTS-UH 1061, not a PHIL course' : ''}.</div>`}
          </div>
          <div class="verdict ${fits ? 'verdict-ok' : 'verdict-no'}">
            ${fits ? `<b>Fits.</b> ${x.needed} more course${x.needed === 1 ? '' : 's'}, and you have room for ${free} elective${free === 1 ? '' : 's'} after your major, minor and Core.`
                   : `<b>Doesn't fit in 128 credits.</b> ${x.needed} more courses, but you only have room for ${free} elective${free === 1 ? '' : 's'}, so ${x.needed - free} course${x.needed - free === 1 ? '' : 's'} (${(x.needed - free) * 4} credits) would go on top.`}
            ${x.uniq < S.programs.policy.minorUnique ? `<div class="small">It also needs ${S.programs.policy.minorUnique} courses that don't count elsewhere. It has ${x.uniq}.</div>` : ''}
          </div>
          <button class="btn btn-small btn-primary" data-action="addminor" data-id="${x.m.id}">Track this minor too</button>
        </div>` : ''}
      </li>`;
    }).join('')}</ul>
  </div>`;
}

function voteBadge(v) {
  if (v.verdict === 'open') return `<span class="tag tag-open" title="${v.yes} said open, ${v.no} said not running">✓ Open in Albert (${v.yes})</span>`;
  if (v.verdict === 'closed') return `<span class="tag tag-closed" title="${v.yes} said open, ${v.no} said not running">✗ Not running (${v.no})</span>`;
  if (v.verdict === 'split') return `<span class="tag">Reports split ${v.yes}–${v.no}</span>`;
  return '';
}

function renderList() {
  const list = getList();
  const term = S.programs.registrationTerm;
  const done = list.filter((i) => i.registered).length;
  const planned = S.courses.filter((c) => c.term.label === term && c.displayCode && !list.some((i) => i.code === c.displayCode));
  const later = S.courses.filter((c) => c.status === 'planned' && c.term.label !== term && c.displayCode && !list.some((i) => i.code === c.displayCode));
  return `
  <div class="card list-card">
    <h2 class="section-title"><span class="num">3</span> Your ${esc(term)} list</h2>
    <ol class="how small">
      <li>Search each code in <b>Albert</b>.</li>
      <li>Report whether it's running.</li>
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
            ${S.votes.online && v.yes + v.no ? `<div class="small">${voteBadge(v)} <span class="muted">${v.yes} open · ${v.no} not running</span></div>` : ''}
          </div>
        </li>`;
      }).join('') || '<li class="muted small empty">Nothing yet. Use <b>Find courses</b> to add some.</li>'}
    </ul>
    ${planned.length ? `<button class="btn btn-secondary btn-small full" data-action="addplanned">+ Add the ${planned.length} course${planned.length > 1 ? 's' : ''} in your plan for ${esc(term)}</button>` : ''}
    ${later.length ? `<select class="full" data-action="addlater"><option value="">+ Pull a planned course from a later term…</option>
      ${later.map((c) => `<option value="${esc(c.id)}">${esc(c.displayCode)} · ${esc(c.term.label)}</option>`).join('')}</select>` : ''}
    ${S.votes.online ? '' : '<p class="small muted offline">Shared reports are offline, so yours are saved on this device only.</p>'}
  </div>`;
}

// The plan, laid out like the ARC template: one band per academic year, Fall | Spring | J-Term + Summer
function renderPlan(A) {
  const years = new Map();
  for (const c of S.courses) {
    const ay = c.term.season === 'fall' ? c.term.year : c.term.year - 1;
    if (!years.has(ay)) years.set(ay, {});
    (years.get(ay)[c.term.label] ||= []).push(c);
  }
  const majorKey = `major:${A.trackId}`, minorKey = `minor:${A.minorDef.id}`;
  const assigned = (res, c) => res.reqs.find((r) => r.slots.some((s) => s.course?.id === c.id))?.req.label;
  const sel = (key, reqs, c, cur) => {
    const v = (S.overrides[key] || {})[c.id] || '';
    return `<select data-action="override" data-key="${key}" data-id="${esc(c.id)}">
      <option value="">${cur ? `Auto: ${esc(cur)}` : 'Auto: doesn’t count'}</option>
      ${reqs.map((r) => `<option value="${r.id}" ${v === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
      <option value="none" ${v === 'none' ? 'selected' : ''}>Doesn’t count</option></select>`;
  };
  const block = (label, items) => {
    const rows = (items || []).map((c) => {
      const st = c.status === 'slot' ? 'plan' : STATUS[c.status === 'dropped' ? 'needed' : c.status][1];
      const editing = S.editRow === c.id;
      return `<tr class="prow prow-${st}" data-action="editrow" data-id="${esc(c.id)}" title="Click to change what this counts toward">
          <td>${esc(c.raw)}</td><td>${esc(c.prereq)}</td><td>${esc(c.reqText)}</td><td>${esc(c.grade)}</td><td class="num-cell">${esc(c.creditsRaw)}</td></tr>
        ${editing && c.status !== 'slot' ? `<tr class="prow-edit"><td colspan="5">
          <label class="small">Major ${sel(majorKey, A.major.track.requirements, c, assigned(A.major.result, c))}</label>
          <label class="small">Minor ${sel(minorKey, A.minorDef.requirements, c, assigned(A.minor, c))}</label>
          ${c.displayCode && c.status !== 'done' && !getList().some((x) => x.code === c.displayCode) ? `<button class="btn btn-small btn-secondary" data-action="add" data-code="${esc(c.displayCode)}" data-title="${esc(c.cat?.title || c.title)}" data-label="${esc(c.reqText)}">+ Add to ${esc(S.programs.registrationTerm)} list</button>` : ''}</td></tr>` : ''}`;
    }).join('');
    return `<div class="tblock"><div class="tblock-head">${esc(label)}</div>
      <table class="tmpl"><thead><tr><th>Course</th><th>Prerequisite</th><th>Requirement</th><th>Grade</th><th>Credit Hr</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div>`;
  };
  const bands = [...years.keys()].sort().map((ay) => {
    const t = years.get(ay);
    return `<div class="year">
      ${block(`Fall ${ay}`, t[`Fall ${ay}`])}
      ${block(`Spring ${ay + 1}`, t[`Spring ${ay + 1}`])}
      <div class="tstack">${block(`J-Term ${ay + 1}`, t[`J-Term ${ay + 1}`])}${t[`Summer ${ay + 1}`] ? block(`Summer ${ay + 1}`, t[`Summer ${ay + 1}`]) : ''}</div>
    </div>`;
  }).join('');
  return `
  <details class="card plan" ${S.open.has('plan') ? 'open' : ''}>
    <summary data-action="plantoggle"><h3>Your plan, as I read it</h3><span class="small muted">Click a row to change what it counts toward.</span></summary>
    <div class="plan-legend small"><span><i class="dot dot-ok"></i>Done</span><span><i class="dot dot-prog"></i>In progress</span><span><i class="dot dot-plan"></i>Planned</span></div>
    ${bands}
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
  if (!el || el.tagName === 'SELECT' || ev.target.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'checkbox')) return;
  const a = el.dataset.action;
  if (a === 'plantoggle') { ev.preventDefault(); S.open.has('plan') ? S.open.delete('plan') : S.open.add('plan'); return render(); }
  if (a === 'sample') return withLoad(() => readSample(), 'the sample plan');
  if (a === 'default') return withLoad(() => readSample(DEFAULT_PLAN), DEFAULT_PLAN_LABEL);
  if (a === 'reset') { S.plan = null; LS.set('lastPlan', null); LS.set('skipDefault', true); return render(); }
  if (a === 'track') { S.track = el.dataset.id; S.trackOpen = false; save(); return render(); }
  if (a === 'trackopen') { S.trackOpen = true; return render(); }
  if (a === 'toggle') { const k = el.dataset.key; S.open.has(k) ? S.open.delete(k) : S.open.add(k); return render(); }
  if (a === 'editrow') { S.editRow = S.editRow === el.dataset.id ? null : el.dataset.id; return render(); }
  if (a === 'add') { addToList(el.dataset.code, el.dataset.title, el.dataset.label); return render(); }
  if (a === 'checkminor') { S.checkMinor = S.checkMinor === el.dataset.id ? null : el.dataset.id; return render(); }
  if (a === 'addminor') { S.extraMinors.push(el.dataset.id); S.checkMinor = null; save(); return render(); }
  if (a === 'dropminor') { S.extraMinors = S.extraMinors.filter((x) => x !== el.dataset.id); save(); return render(); }
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

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.id === 'file' && el.files[0]) { const f = el.files[0]; return withLoad(() => readFile(f), f.name); }
  if (el.dataset.action === 'major') { S.majorId = el.value || null; S.track = null; S.trackOpen = false; save(); return render(); }
  if (el.dataset.action === 'addlater' && el.value) {
    const c = S.courses.find((x) => x.id === el.value);
    if (c) addToList(c.displayCode, c.cat?.title || c.title, c.reqText);
    return render();
  }
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
