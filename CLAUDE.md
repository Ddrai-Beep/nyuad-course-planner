# NYUAD Course Planner: notes for Claude

Static web app (GitHub Pages, no build step) that reads an NYUAD ARC 4-year plan and checks it against the Political Science major (4 tracks), the minor, the Core, gen ed and 128 credits. No AI is used in the checks. The rules are plain data.

- `src/parser.js`: reads the ARC template grid (term anchors → "Course" header → rows). Hidden rows are skipped.
- `src/engine.js`: requirement matching (bipartite) and policy rules: Pass/Fail exclusion with a Spring 2026 exception, minimum grade C, and Core competency courses not double-counting with the major or minor.
- `src/app.js`: UI. Sections: tracks → what you still need (one row per course slot) → counts for both → add-a-minor (ranked) → registration list (sidebar) → plan table laid out like the template.
- `data/programs.json`: requirements and policy. `data/catalog.json` is built by `scripts/build_catalog.py` from `scripts/crossover.json` and `scripts/core.txt`. `data/offerings.json` lists courses offered per term (Jensen's PS guide).
- `data/my-plan.csv`: the owner's plan, loaded by default (`DEFAULT_PLAN` in `config.js`).
- `worker/`: optional Cloudflare Worker + D1 for shared "is it running in Albert?" votes and Google Sheets proxying. Set it up with `bash worker/setup.sh`.

Sources: NYUAD Bulletin; "Political Science Courses — Spring 2027" (J. Jensen, 26 Oct 2026); NYUAD Student Portal (Revised Requirements for Graduation; Spring 2026 Grading Policies + FAQs).

Owner preferences: concise, direct; minimal visual clutter (neutral palette, dark grey header, light yellow background, 2px borders, no purple). Ask before changing anything outside this repo.

Test locally: `python3 -m http.server` from the repo root, then open http://localhost:8000.
