// Reads the NYUAD ARC 4-year planning template (or a close variant) from a 2D grid.
// Works on whatever SheetJS / CSV gives us: an array of rows, each an array of cell values.

const SEASONS = { 'j-term': 1, spring: 2, summer: 3, fall: 4 };
const KNOWN_SUBJECTS = new Set(('ACS AW ANTH ARABL ARTH ARTS BIOL BUSOR CADT CAMS CCEA CCOL CDAD CENG CHEM CHINL CORE CS CSTS DS ECON ' +
  'ENGR FILMM FREN HERST HIST IM JOUR LAW LITCW MATH MEIS MUSIC PEACE PHIL PHYS POL POLSC PSYCH RELST SOCSC SPAN SRPP ' +
  'THEAT UNIST WRIT FYWS FYSEM BEPEP SOC ECON').split(' '));
const NOT_SUBJECTS = new Set(['FALL', 'SPRING', 'SUMMER', 'YEAR', 'TERM', 'CLASS', 'OF', 'IN', 'TO']);

const str = (v) => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

export function termOrder(t) { return t.year * 10 + SEASONS[t.season]; }

export function currentTerm(date = new Date()) {
  const m = date.getMonth() + 1, y = date.getFullYear();
  if (m === 1) return { season: 'j-term', year: y };
  if (m <= 5) return { season: 'spring', year: y };
  if (m <= 8) return { season: 'summer', year: y };
  return { season: 'fall', year: y };
}

export function termLabel(t) {
  const s = t.season === 'j-term' ? 'J-Term' : t.season[0].toUpperCase() + t.season.slice(1);
  return `${s} ${t.year}`;
}

function parseAnchor(text) {
  const t = str(text);
  let m = t.match(/^(fall|spring|summer)\s*(20\d\d)$/i);
  if (m) return { season: m[1].toLowerCase(), year: +m[2] };
  m = t.match(/^j[\s-]?term\s*(20\d\d)?$/i);
  if (m) return { season: 'j-term', year: m[1] ? +m[1] : null };
  return null;
}

export function parseCode(text) {
  const re = /\b([A-Za-z]{2,6})(?:[\s-]?(UH|UA|UB|SHU|GA))?[\s-]?(\d{4})([A-Z]{0,3})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1], subject = raw.toUpperCase();
    if (NOT_SUBJECTS.has(subject)) continue;
    const isCaps = raw === subject;
    if (!KNOWN_SUBJECTS.has(subject) && !(isCaps && m[2])) continue;
    const campus = (m[2] || 'UH').toUpperCase();
    const number = +m[3];
    const suffix = m[4] || '';
    const title = str(text.replace(m[0], ' ').replace(/^[\s\-–—:;,]+|[\s\-–—:;,]+$/g, '').replace(/\s[-–—]\s/g, ' '));
    return { subject, campus, number, suffix, key: `${subject}-${campus} ${number}`, code: `${subject}-${campus} ${number}${suffix}`, title };
  }
  return null;
}

const ALIASES = [
  [/\bGEPS\b/i, 'SOCSC-UH 1011'],
  [/^markets?\b/i, 'SOCSC-UH 1111'],
  [/intro(duction)? to pol(itical|\.)? thinking|\bIPT\b/i, 'SOCSC-UH 1112'],
  [/statistics for the social/i, 'SOCSC-UH 1010'],
  [/political thinking in practice|\bPTP\b/i, 'POLSC-UH 1115'],
  [/research design (&|and) causality/i, 'POLSC-UH 2212'],
];

const PLACEHOLDER_HINTS = [
  [/\bSPET\b/i, { tags: ['spet'] }],
  [/capstone/i, { tags: ['capstone'] }],
  [/method/i, { tags: ['methods'] }],
  [/econ(omics)? elective/i, { subject: 'ECON', number: 2000 }],
  [/3000/i, { subject: 'POLSC', number: 3000 }],
  [/poli(tical)? ?sci(ence)? (elective|course)|\bpolsc\b/i, { subject: 'POLSC', number: 2000 }],
];

function classify(name, reqText) {
  const c = { attrs: new Set() };
  const code = parseCode(name);
  if (code) Object.assign(c, code);
  else c.title = name;
  const first = name.trim().split(/[\s-]/)[0].toUpperCase();
  const coreSubj = code?.subject || first;
  if (['CADT', 'CCEA', 'CDAD', 'CSTS'].includes(coreSubj)) c.coreCat = coreSubj;
  if (coreSubj === 'CCOL') c.ccol = true;
  if (/\bFYWS\b|first[- ]year writing|\bFYSEM\b/i.test(name)) c.fyws = true;
  if (/\bPE\b|physical education/i.test(name)) c.pe = true;
  if (/\baudit\b/i.test(name)) c.audit = true;
  for (const a of ['X', 'E', 'Q']) if (new RegExp(`\\(${a}\\)`).test(name)) c.attrs.add(a);
  if (code) for (const ch of code.suffix) if ('XEQ'.includes(ch)) c.attrs.add(ch);
  if (!code) for (const [re, k] of ALIASES) if (re.test(name)) { c.aliasKey = k; break; }
  const recognised = code || c.coreCat || c.ccol || c.fyws || c.pe || c.aliasKey;
  if (!recognised && (/elective|\bcourse\b|\[|space|tbd|placeholder|capstone|\bSPET\b|method/i.test(name))) {
    c.placeholder = true;
    for (const [re, hint] of PLACEHOLDER_HINTS) if (re.test(name)) { c.hint = hint; break; }
  }
  return c;
}

export function parsePlan(grid, today = new Date()) {
  const rows = grid.map((r) => (r || []).map(str));
  const cell = (r, c) => (rows[r] && rows[r][c]) || '';
  const meta = {}, courses = [], warnings = [];

  // Summary info
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const v = cell(r, c).toLowerCase();
      const right = () => { for (let k = 1; k < 4; k++) if (cell(r, c + k)) return cell(r, c + k); return ''; };
      if (v.startsWith('admitted in')) meta.admitted = `${cell(r, c).replace(/admitted in/i, '').trim()} ${right()}`.trim();
      else if (v.startsWith('major(s)')) meta.majors = right();
      else if (v.startsWith('minor(s)')) meta.minors = right();
      else if (v.startsWith('year | standing')) meta.standing = right();
    }
  }

  // Term anchors
  const anchors = [];
  rows.forEach((row, r) => row.forEach((v, c) => { const t = parseAnchor(v); if (t) anchors.push({ r, c, t }); }));
  for (const a of anchors) {
    if (a.t.year) continue;
    const sameRow = anchors.filter((b) => b.r === a.r && b.t.year);
    const spring = sameRow.find((b) => b.t.season === 'spring');
    const fall = sameRow.find((b) => b.t.season === 'fall');
    a.t.year = spring ? spring.t.year : fall ? fall.t.year + 1 : null;
    if (!a.t.year) warnings.push({ level: 'warn', text: `Couldn't work out the year for a J-Term block (row ${a.r + 1}). Skipped it.` });
  }
  const now = currentTerm(today);
  const anchorAt = new Set(anchors.map((a) => `${a.r}:${a.c}`));

  for (const a of anchors) {
    if (!a.t.year) continue;
    let h = -1;
    for (let r = a.r + 1; r <= a.r + 3; r++) if (/^course/i.test(cell(r, a.c))) { h = r; break; }
    if (h < 0) continue;
    const cols = { name: a.c };
    for (let c = a.c + 1; c <= a.c + 6; c++) {
      const v = cell(h, c).toLowerCase();
      if (v.startsWith('course')) break;
      if (v.startsWith('prereq')) cols.prereq = c;
      else if (v.startsWith('requirement')) cols.req = c;
      else if (v.startsWith('grade')) cols.grade = c;
      else if (v.startsWith('credit')) cols.credits = c;
    }
    const order = termOrder(a.t), nowOrder = termOrder(now);
    const timing = order < nowOrder ? 'past' : order === nowOrder ? 'current' : 'future';
    let blank = 0;
    for (let r = h + 1; r <= h + 15 && r < rows.length; r++) {
      const name = cell(r, a.c);
      if (anchorAt.has(`${r}:${a.c}`) || /^course\s*$/i.test(name)) break;
      if (!name) { if (++blank >= 3) break; continue; }
      blank = 0;
      const reqText = cols.req != null ? cell(r, cols.req) : '';
      const grade = cols.grade != null ? cell(r, cols.grade) : '';
      const credRaw = cols.credits != null ? cell(r, cols.credits) : '';
      const c = classify(name, reqText);
      if (c.audit) continue;
      c.raw = name;
      c.reqText = reqText;
      c.grade = grade;
      c.term = { ...a.t, label: termLabel(a.t), order };
      c.id = `${c.term.label}|${name}`;
      let credits = parseFloat(credRaw);
      if (isNaN(credits)) {
        credits = c.pe ? 0 : a.t.season === 'j-term' ? 3 : 4;
        c.creditsAssumed = !c.pe;
      }
      c.credits = credits;
      if (/^(F|W|WF|NR)$/i.test(grade)) c.status = 'dropped';
      else if (grade) c.status = 'done';
      else if (timing === 'past') { c.status = 'done'; c.noGrade = !c.pe; }
      else if (timing === 'current') c.status = 'inprogress';
      else c.status = c.placeholder ? 'slot' : 'planned';
      if (c.placeholder && c.status === 'done') c.status = 'slot';
      if (c.ccol) c.ccolType = (a.t.season === 'j-term' || a.t.season === 'summer' || /J$/.test(c.suffix || '')) ? 'field' : 'term';
      courses.push(c);
    }
  }
  if (!courses.length) warnings.push({ level: 'error', text: "Couldn't find any term blocks (like 'Fall 2025' above a 'Course' header). Is this the ARC 4-year planning template?" });
  courses.sort((x, y) => x.term.order - y.term.order);
  return { meta, courses, warnings };
}

export function pickPlanSheet(sheets) {
  // sheets: [{name, grid}] → the one with the most term anchors
  let best = null, bestN = -1;
  for (const s of sheets) {
    let n = 0;
    for (const row of s.grid) for (const v of row || []) if (parseAnchor(str(v))) n++;
    if (n > bestN) { best = s; bestN = n; }
  }
  return best;
}
