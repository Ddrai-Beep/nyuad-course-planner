import { WORKER_URL } from '../config.js';

const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export { LS };

function voterId() {
  let id = LS.get('voterId', null);
  if (!id) { id = crypto.randomUUID(); LS.set('voterId', id); }
  return id;
}

// Availability reports: "is this course actually running in Albert this term?"
// Status = whichever side has more votes.
export class Votes {
  constructor(term) {
    this.term = term;
    this.online = !!WORKER_URL;
    this.counts = {};
    this.mine = LS.get(`myVotes:${term}`, {});
  }
  async load() {
    if (!this.online) return;
    try {
      const res = await fetch(`${WORKER_URL}/votes?term=${encodeURIComponent(this.term)}`);
      if (res.ok) this.counts = (await res.json()).counts || {};
      else this.online = false;
    } catch { this.online = false; }
  }
  status(code) {
    const c = { yes: 0, no: 0, ...(this.counts[code] || {}) };
    if (!this.online && this.mine[code] !== undefined) c[this.mine[code] ? 'yes' : 'no'] = 1;
    const verdict = c.yes > c.no ? 'open' : c.no > c.yes ? 'closed' : c.yes ? 'split' : 'unknown';
    return { ...c, verdict, mine: this.mine[code] };
  }
  async cast(code, available) {
    const prev = this.mine[code];
    if (prev === available) return;
    this.mine[code] = available;
    LS.set(`myVotes:${this.term}`, this.mine);
    if (!this.online) return;
    const c = this.counts[code] || (this.counts[code] = { yes: 0, no: 0 });
    if (prev !== undefined) c[prev ? 'yes' : 'no'] = Math.max(0, c[prev ? 'yes' : 'no'] - 1);
    c[available ? 'yes' : 'no']++;
    try {
      const res = await fetch(`${WORKER_URL}/vote`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ term: this.term, course: code, available, voter: voterId() }),
      });
      if (res.ok) { const j = await res.json(); if (j.counts) this.counts[code] = j.counts; }
    } catch { /* keep optimistic count */ }
  }
}
