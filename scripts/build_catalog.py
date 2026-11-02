"""Builds app/data/catalog.json from bulletin lists + Jensen's Spring 2027 guide.
Sources:
- crossover.json: Econ minor electives, PS methods/area/breadth lists (copied from the NYUAD bulletin)
- Political Science Courses — Spring 2027 (J. Jensen, Oct 26 2026)
- NYUAD Bulletin: Economics minor, Core Curriculum
"""
import json, re, sys

src = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
cat = {}

def norm(code):
    code = code.strip().upper().replace('–', '-')
    m = re.match(r'([A-Z]+)-([A-Z]+)\s*(\d{4})([A-Z]*)$', code)
    if not m:
        return code
    return f"{m[1]}-{m[2]} {m[3]}{m[4]}"

def add(code, title, *tags, **extra):
    c = norm(code)
    e = cat.setdefault(c, {"code": c, "title": title, "tags": []})
    if title and not e["title"]:
        e["title"] = title
    for t in tags:
        if t not in e["tags"]:
            e["tags"].append(t)
    e.update(extra)

# Foundations (Jensen + bulletin)
add('SOCSC-UH 1010Q', 'Statistics for the Social and Behavioral Sciences', 'stats')
add('SOCSC-UH 1011', 'Global Economic, Political and Social Development (GEPS)', 'speh', 'geps')
add('HIST-UH 2010', 'History and Globalization', 'speh')
add('SOCSC-UH 1310', 'Foundations of Modern Social Thought', 'spet')
add('SOCSC-UH 1314', 'Sociological Theory', 'spet')
add('SOCSC-UH 1111', 'Markets', 'markets')
add('ECON-UH 1112', 'Introduction to Macroeconomics', 'macro')
add('MATH-UH 1013Q', 'Calculus with Applications to Economics', 'calc')

# Intro courses
add('SOCSC-UH 1112', 'Introduction to Political Thinking (IPT)', 'ipt')
add('POLSC-UH 1115', 'Political Thinking in Practice (PTP)', 'ptp', 'intro-old')
add('POLSC-UH 1111', 'Introduction to Comparative Politics (ICP)', 'icp', 'ptp-sub', 'intro-old')
add('POLSC-UH 1112', 'Introduction to International Politics (IIP)', 'iip', 'ptp-sub', 'intro-old')
add('POLSC-UH 1113', 'Introduction to Political Theory', 'intro-old')
# Study-away equivalent (NYU NY / London International Politics = IIP equivalent; confirm via pathway)
add('POL-UA 9700', 'International Politics (study away)', 'iip', 'ptp-sub', 'intro-old', 'study-away-equiv',
    note='Study-away equivalent of Intro to International Politics. Confirm on the PS study-away pathway.')
add('POL-UA 700', 'International Politics (NYU New York)', 'iip', 'ptp-sub', 'intro-old', 'study-away-equiv')

# Methods (Jensen spring list + bulletin list)
for code, title in [
    ('POLSC-UH 2211', 'Data Analysis'),
    ('POLSC-UH 2212', 'Research Design and Causality'),
    ('CDAD-UH 1078EQ', 'Inclusive Data Literacy'),
    ('ECON-UH 2020', 'Data Analysis: Economics'),
    ('SOCSC-UH 2211', 'Survey Research'),
    ('SOCSC-UH 2214', 'Applied Data Science'),
    ('SOCSC-UH 3220', 'Econometrics'),
    ('SRPP-UH 2211', 'Ethnographic Field Research'),
    ('SRPP-UH 2214', 'Interview Methods'),
]:
    add(code, title, 'methods')
for code, title in src['methods']:
    add(code, title, 'methods')
# Cross-listing: RDC appears as SOCSC-UH 2212 on many plans
add('SOCSC-UH 2212', 'Research Design & Causality in Social Science', 'methods', alias_of='POLSC-UH 2212')
cat[norm('POLSC-UH 2212')]['tags'].append('rdc')
cat[norm('SOCSC-UH 2212')]['tags'].append('rdc')
cat[norm('POLSC-UH 2211')]['tags'].append('data-analysis')

# Area / breadth (old bulletin)
for code, title in src['area']:
    add(code, title, 'area-old')
for code, title in src['breadth']:
    add(code, title, 'breadth-old')

# Econ electives (bulletin)
for code, title in src['econ']:
    add(code, title, 'econ-elective')

# Capstone
add('POLSC-UH 4000', 'Capstone Seminar', 'capstone')
add('POLSC-UH 4001', 'Capstone Project', 'capstone')

# New Spring 2027 courses (no numbers yet) — Jensen
add('POLSC-UH NEW-IRT', 'International Relations Theories (NEW, 3000-level)', 'area-old', 'iafp', 'new', level=3000)
add('POLSC-UH NEW-PWP', 'The Psychology of War and Peace (NEW, 3000-level)', 'area-old', 'iafp', 'new', level=3000)
add('POLSC-UH NEW-GDO', 'Global Dis(order) (NEW, 2000-level)', 'area-old', 'iafp', 'new', level=2000)
add('POLSC-UH NEW-FOD', 'The Future of Diplomacy (in the Gulf) (NEW, 2000-level)', 'area-old', 'iafp', 'new', level=2000)
add('POLSC-UH NEW-CHP', 'Chinese Politics (NEW, 2000-level)', 'area-old', 'new', level=2000)

# IAFP designations known from Jensen's Spring 2027 table
for c in ['POLSC-UH 3413', 'POLSC-UH 3510', 'CSTS-UH 1094', 'CSTS-UH 1129', 'PEACE-UH 1011']:
    add(c, '', 'iafp')

json.dump({"_source": "NYUAD Bulletin (most recent) + Political Science Courses — Spring 2027 (J. Jensen, 26 Oct 2026)",
           "courses": sorted(cat.values(), key=lambda e: e['code'])},
          open(out_path, 'w'), indent=1)
print(len(cat), 'courses')
