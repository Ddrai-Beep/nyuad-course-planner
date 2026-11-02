// Requirement matching: deterministic rules, no AI.

export function normKey(code) {
  const m = String(code).toUpperCase().match(/^([A-Z]+)-([A-Z]+)\s*(\d{4}|NEW-[A-Z]+)/);
  return m ? `${m[1]}-${m[2]} ${m[3]}` : String(code).toUpperCase();
}

export function buildCatalog(json) {
  const byKey = new Map();
  for (const e of json.courses) {
    const k = normKey(e.code);
    const m = e.code.match(/^([A-Z]+)-([A-Z]+)\s*(\d{4})?/);
    const entry = { ...e, key: k, subject: m?.[1], campus: m?.[2], number: m?.[3] ? +m[3] : (e.level || 0) };
    byKey.set(k, entry);
  }
  // cross-listed aliases share tags both ways
  for (const e of byKey.values()) {
    if (e.alias_of) {
      const t = byKey.get(normKey(e.alias_of));
      if (t) { const tags = [...new Set([...t.tags, ...e.tags])]; t.tags = tags; e.tags = tags; }
    }
  }
  return byKey;
}

// Attach catalog info + derived fields to a parsed plan course
// Study-away sections are numbered 9xxx (e.g. POL-UA 9700 = POL-UA 700)
export function levelOf(number, campus) {
  if (!number) return 0;
  const n = campus && campus !== 'UH' && number >= 9000 ? number - 9000 : number;
  return Math.floor(n / 1000) * 1000;
}

export function enrich(course, catalog) {
  const key = course.key || course.aliasKey;
  const cat = key ? catalog.get(normKey(key)) : null;
  const tags = new Set(cat ? cat.tags : []);
  let subject = course.subject, campus = course.campus, number = course.number;
  if (!subject && cat) { subject = cat.subject; campus = cat.campus; number = cat.number; }
  if (course.hint) {
    for (const t of course.hint.tags || []) tags.add(t);
    if (course.hint.subject) { subject = course.hint.subject; campus = 'UH'; number = course.hint.number; }
  }
  return {
    ...course,
    cat,
    tags,
    subject, campus, number,
    level: levelOf(number, campus),
    title: cat?.title && (!course.title || course.title.length < 4) ? cat.title : (course.title || cat?.title || course.raw),
    displayCode: course.code || cat?.code || '',
  };
}

function clauseMatch(c, cl) {
  if (cl.tags && !cl.tags.some((t) => c.tags.has(t))) return false;
  if (cl.codes && !cl.codes.map(normKey).includes(normKey(c.displayCode))) return false;
  if (cl.subject && !cl.subject.includes(c.subject)) return false;
  if (cl.campus && !cl.campus.includes(c.campus)) return false;
  if (cl.minLevel && !(c.level >= cl.minLevel)) return false;
  if (cl.maxLevel && !(c.level && c.level <= cl.maxLevel)) return false;
  if (cl.coreCat && c.coreCat !== cl.coreCat) return false;
  if (cl.attr && !c.attrs?.has(cl.attr)) return false;
  if (cl.ccol && c.ccolType !== cl.ccol) return false;
  if (cl.fyws && !c.fyws) return false;
  if (cl.pe && !c.pe) return false;
  return true;
}

export function reqMatches(c, req) {
  if (req.any && !req.any.some((cl) => clauseMatch(c, cl))) return false;
  if (req.all && !req.all.every((cl) => clauseMatch(c, cl))) return false;
  if (req.not && req.not.some((cl) => clauseMatch(c, cl))) return false;
  return !!(req.any || req.all);
}

const RANK = { done: 0, inprogress: 1, planned: 2, slot: 3 };

// Bipartite matching (Kuhn) of courses → requirement slots.
// overrides: { [courseId]: reqId | 'none' }, manual: { [reqId]: n } slots marked done by hand
export function solve(requirements, courses, overrides = {}, manual = {}) {
  const slots = [];
  for (const req of requirements) for (let i = 0; i < req.count; i++) slots.push({ req, i, course: null, manual: false });
  // manual completions take the last slots of a requirement
  for (const req of requirements) {
    const n = Math.min(manual[req.id] || 0, req.count);
    const rs = slots.filter((s) => s.req === req);
    for (let k = 0; k < n; k++) rs[rs.length - 1 - k].manual = true;
  }
  const pool = courses
    .filter((c) => c.status !== 'dropped' && !c.audit && overrides[c.id] !== 'none')
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.term.order - b.term.order);

  // forced assignments
  const forced = new Set();
  for (const c of pool) {
    const rid = overrides[c.id];
    if (!rid) continue;
    const s = slots.find((s) => s.req.id === rid && !s.course && !s.manual);
    if (s) { s.course = c; s.forced = true; forced.add(c.id); }
  }
  const free = slots.filter((s) => !s.manual && !s.forced);
  const edges = new Map();
  for (const c of pool) {
    if (forced.has(c.id)) continue;
    edges.set(c.id, free.filter((s) => reqMatches(c, s.req)));
  }
  const tryAssign = (c, seen) => {
    const es = edges.get(c.id) || [];
    const open = es.find((s) => !s.course && !seen.has(s));
    if (open) { open.course = c; return true; }
    for (const s of es) {
      if (seen.has(s)) continue;
      seen.add(s);
      if (tryAssign(s.course, seen)) { s.course = c; return true; }
    }
    return false;
  };
  for (const c of pool) if (!forced.has(c.id)) tryAssign(c, new Set());

  const used = new Set(slots.filter((s) => s.course).map((s) => s.course.id));
  const reqs = requirements.map((req) => {
    const rs = slots.filter((s) => s.req === req);
    const state = (s) => (s.manual ? 'done' : s.course ? s.course.status : 'needed');
    const states = rs.map(state);
    const order = ['needed', 'slot', 'planned', 'inprogress', 'done'];
    const worst = states.reduce((w, x) => (order.indexOf(x) < order.indexOf(w) ? x : w), 'done');
    return { req, slots: rs, status: worst, filled: states.filter((x) => x !== 'needed' && x !== 'slot').length };
  });
  const summary = { done: 0, inprogress: 0, planned: 0, needed: 0 };
  for (const s of slots) {
    const st = s.manual ? 'done' : s.course ? s.course.status : 'needed';
    summary[st === 'slot' ? 'needed' : st]++;
  }
  return { reqs, used, summary, total: slots.length };
}

export function eligibleCourses(req, catalog) {
  const out = [];
  for (const e of catalog.values()) {
    if (e.alias_of) continue;
    const c = { tags: new Set(e.tags), subject: e.subject, campus: e.campus, number: e.number, level: e.number ? Math.floor(e.number / 1000) * 1000 : 0, displayCode: e.code, attrs: new Set() };
    if (reqMatches(c, req)) out.push(e);
  }
  return out;
}

const POINTS = { 'A': 4, 'A-': 3.667, 'B+': 3.333, 'B': 3, 'B-': 2.667, 'C+': 2.333, 'C': 2, 'C-': 1.667, 'D+': 1.333, 'D': 1, 'F': 0 };

export function stats(courses, gradCredits) {
  let earned = 0, inprog = 0, planned = 0, slots = 0, qp = 0, gc = 0;
  for (const c of courses) {
    if (c.status === 'dropped' || c.audit) continue;
    if (c.status === 'done') earned += c.credits;
    else if (c.status === 'inprogress') inprog += c.credits;
    else if (c.status === 'planned') planned += c.credits;
    else if (c.status === 'slot') slots += c.credits;
    const gs = String(c.grade || '').split('/').map((g) => POINTS[g.trim().toUpperCase()]).filter((x) => x !== undefined);
    if (gs.length && c.credits) { qp += (gs.reduce((a, b) => a + b, 0) / gs.length) * c.credits; gc += c.credits; }
  }
  return { earned, inprog, planned, slots, gpa: gc ? qp / gc : null, gradCredits };
}
