# NYUAD Course Planner

Load your ARC 4-year plan (Google Sheets link, .xlsx or .csv). The planner shows:

- what's left for the **Political Science major** on each of the four tracks: new bulletin, IAFP, Data & Politics, old bulletin
- what's left for the **Economics minor**, the **Core**, gen-ed (X/E/Q/PE) and **128 credits**
- which courses fill each gap, with the ones on the department's Spring 2027 list shown first
- a **registration list** to work through in Albert: copy the code, report whether the course is running, then tick it off once you're registered. Reports from all students are pooled, and the majority answer is shown.

No AI is involved. Requirements are plain rules in `data/`, so the results are deterministic and you can check them. Your plan is read in the browser and is never uploaded.

## Updating requirements

| File | What's in it |
|---|---|
| `data/programs.json` | Requirement rules for the major tracks, minor, Core and gen ed. Also sets `registrationTerm`. |
| `data/catalog.json` | Course codes, titles and tags (`spet`, `methods`, `iafp`, `area-old`, …). Rebuilt by `scripts/build_catalog.py`, or edited by hand. |
| `data/offerings.json` | Courses offered each term, from the department guides. |

A rule clause can match on `tags`, `codes`, `subject` + `campus` + `minLevel`/`maxLevel`, `coreCat`, `attr` (X/E/Q), `ccol`, `fyws` or `pe`. A requirement uses `any` (OR), `all` (AND) and `not`.

When next term's guide comes out: add a new key to `offerings.json`, change `registrationTerm`, and tag any new courses in `catalog.json`.

## Hosting

- **Site:** GitHub Pages serves it from the `main` branch root. There's no build step.
- **Worker (optional, free):** Cloudflare Worker + D1 for shared availability reports. It also reads Google Sheets with every tab, where the no-server fallback only gets the first tab. To set it up once, run `bash worker/setup.sh`. It logs you in, creates the database, deploys, and writes the URL into `config.js`. Commit and push afterwards.

The live site opens on `data/my-plan.csv` (set `DEFAULT_PLAN` in `config.js` to change or remove it).

Unofficial: confirm with your advisor and in Albert.
