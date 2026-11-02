// NYUAD Course Planner: tiny API on Cloudflare Workers (free tier) + D1.
//   GET  /votes?term=Spring%202027      → { counts: { "POLSC-UH 3413": { yes, no } } }
//   POST /vote  {term, course, available, voter}
//   GET  /sheet?id=<google sheet id>    → the sheet as .xlsx (sheet must be "Anyone with the link")

const CODE_RE = /^[A-Z]{2,6}-[A-Z]{2,3} (\d{4}[A-Z]{0,3}|NEW-[A-Z]{2,5})$/;
const TERM_RE = /^(Spring|Summer|Fall|J-Term) 20\d\d$/;

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function counts(env, term, course) {
  const q = course
    ? env.DB.prepare('SELECT course, SUM(available) AS yes, SUM(1 - available) AS no FROM votes WHERE term = ? AND course = ? GROUP BY course').bind(term, course)
    : env.DB.prepare('SELECT course, SUM(available) AS yes, SUM(1 - available) AS no FROM votes WHERE term = ? GROUP BY course').bind(term);
  const { results } = await q.all();
  const out = {};
  for (const r of results) out[r.course] = { yes: r.yes || 0, no: r.no || 0 };
  return out;
}

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);

    try {
      if (url.pathname === '/votes' && req.method === 'GET') {
        const term = url.searchParams.get('term') || '';
        if (!TERM_RE.test(term)) return json({ error: 'bad term' }, 400, h);
        return json({ counts: await counts(env, term) }, 200, { ...h, 'cache-control': 'public, max-age=30' });
      }

      if (url.pathname === '/vote' && req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const course = String(b.course || '').toUpperCase().trim();
        const term = String(b.term || '');
        const voter = String(b.voter || '');
        if (!TERM_RE.test(term) || !CODE_RE.test(course) || !/^[0-9a-f-]{36}$/.test(voter) || typeof b.available !== 'boolean')
          return json({ error: 'bad request' }, 400, h);
        const ip = await sha((req.headers.get('cf-connecting-ip') || '') + (env.SALT || 'nyuad'));
        // one vote per browser per course, and at most 3 browsers per IP per course
        const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE term = ? AND course = ? AND ip = ? AND voter != ?')
          .bind(term, course, ip, voter).first();
        if (n >= 3) return json({ error: 'Too many reports from your network for this course.' }, 429, h);
        await env.DB.prepare(`INSERT INTO votes (term, course, voter, ip, available, ts) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(term, course, voter) DO UPDATE SET available = excluded.available, ts = excluded.ts`)
          .bind(term, course, voter, ip, b.available ? 1 : 0, Date.now()).run();
        return json({ ok: true, counts: (await counts(env, term, course))[course] || { yes: 0, no: 0 } }, 200, h);
      }

      if (url.pathname === '/sheet' && req.method === 'GET') {
        const id = url.searchParams.get('id') || '';
        if (!/^[a-zA-Z0-9_-]{20,80}$/.test(id)) return json({ error: 'bad id' }, 400, h);
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: 'follow' });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || type.includes('text/html'))
          return new Response('Couldn\'t open the sheet. Set sharing to "Anyone with the link → Viewer" and try again.', { status: 403, headers: h });
        return new Response(r.body, { status: 200, headers: { ...h, 'content-type': type, 'cache-control': 'no-store' } });
      }

      return json({ ok: true, service: 'nyuad-course-planner' }, url.pathname === '/' ? 200 : 404, h);
    } catch (e) {
      return json({ error: 'server error' }, 500, h);
    }
  },
};
