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

# Core Curriculum & Gen Ed tables (bulletin)
import os
CORE_TAG = {'ccol': 'ccol-term', 'field': 'ccol-field', 'fyws': 'fyws', 'CADT': 'core-CADT', 'CCEA': 'core-CCEA', 'CDAD': 'core-CDAD', 'CSTS': 'core-CSTS', 'gened': None}
for line in open(os.path.join(os.path.dirname(__file__), 'core.txt')):
    if not line.strip() or line.startswith('#'): continue
    h, code, title = line.rstrip('\n').split('|')
    tag = CORE_TAG[h]
    add(code, title, *( [tag] if tag else [] ))
    e = cat[norm(code)]
    sfx = re.match(r'.*\d{4}([A-Z]*)$', norm(code))[1]
    if len(sfx) > len(e['code'].split(' ')[-1].lstrip('0123456789')):
        e['code'] = norm(code)  # keep the attribute-bearing suffix (e.g. 1000AQ)

# Other minors (bulletin)
for c, t in [('IM-UH 1010', 'Introduction to Interactive Media'), ('IM-UH 1011', 'Communications Lab')]: add(c, t, 'im-req')
for c, t in [('ACS-UH 1010X', 'Anthropology and the Arab World'), ('ACS-UH 1011X', 'Introduction to Modern Arabic Literature'), ('ACS-UH 1012X', 'Emergence of the Modern Middle East')]: add(c, t, 'acs-req')
add('HIST-UH 2010', 'History and Globalization', 'hist-req')
add('PHIL-UH 1101', 'Central Problems in Philosophy', 'phil-intro')
add('PHIL-UH 1110', 'The Meaning of Life', 'phil-intro')
add('PHIL-UH 1115', 'Fear of Knowledge', 'phil-intro')
add('PHIL-UH 2614', 'Political Philosophy', 'law-elec')
for c, t in [('LAW-UH 1010', 'What is Law? Comparative Global Jurisprudence'), ('LAW-UH 1011', 'Legal Writing and Research'), ('LAW-UH 1012', 'Legal System and Method'),
             ('LAW-UH 1013', 'Business Law'), ('LAW-UH 1014', 'Commercial Law'), ('LAW-UH 2010', 'Legal Institutions'), ('LAW-UH 2011', 'Constitutional and Administrative Law'),
             ('LAW-UH 2123', 'Public International Law'), ('LAW-UH 3010', 'Legal Ethics and Professional Responsibility')]:
    add(c, t, 'law-req')
for c, t in [('CCEA-UH 1011', 'Law and the Imagination'), ('CSTS-UH 1061', 'Global Ethics'), ('CSTS-UH 1074', 'Refugees, Law and Crises'), ('CSTS-UH 1076', "What's Property (For?)"),
             ('CSTS-UH 1077', 'Law and Politics'), ('CSTS-UH 1097', 'Justice'), ('CSTS-UH 1125X', 'Law and Empire'), ('CSTS-UH 1149', 'International Business, Law, and Sustainability'),
             ('ECON-UH 2512', 'FinTech Innovation: Finance, Technology, Regulation'), ('ECON-UH 3511X', 'Islamic Economics and Finance'), ('ENVR-UH 1312', 'Global Debate on Green Growth'),
             ('HERST-UH 1502', 'Judging Heritage'), ('HIST-UH 2121', 'Genocide in a Global Perspective'), ('LAW-UH 1110', 'Contracts'), ('LAW-UH 1114', 'Alternative Dispute Resolution'),
             ('LAW-UH 2112', 'Gender in Law'), ('LAW-UH 2114', 'Climate Change Law and Policy'), ('LAW-UH 2122X', 'Introduction to Islamic Law'), ('LAW-UH 2124', 'Human Rights Law'),
             ('LAW-UH 2126X', 'International Commercial Arbitration'), ('LAW-UH 2127', 'International Business and Sustainability'), ('LAW-UH 2128', 'Theory of Property Law'),
             ('LAW-UH 2129', 'Mooting'), ('LAW-UH 2131', 'Law and the Arts'), ('LAW-UH 2134', 'Animal Law & Policy'), ('LAW-UH 2135', 'Disability Law and Policy'),
             ('LAW-UH 2136', 'Refugee Protection in International Law'), ('LAW-UH 2137', 'Environmental Rights & Access to Justice in the Global South'),
             ('LAW-UH 2138', 'International Law and Israel-Palestine'), ('LAW-UH 2500', 'Criminal Law'), ('LAW-UH 2501', 'Torts'), ('LAW-UH 3103', 'Constitutional Courts'),
             ('LAW-UH 3500', 'Property - Land Law'), ('LAW-UH 3501', 'Equity and Trusts'), ('LAW-UH 3503', 'European Union Law'), ('MUSIC-UH 2662', 'Music and Copyright'),
             ('SRPP-UH 2414', 'Global Family Policies and Laws')]:
    add(c, t, 'law-elec')

json.dump({"_source": "NYUAD Bulletin (most recent) + Political Science Courses — Spring 2027 (J. Jensen, 26 Oct 2026)",
           "courses": sorted(cat.values(), key=lambda e: e['code'])},
          open(out_path, 'w'), indent=1)
print(len(cat), 'courses')
