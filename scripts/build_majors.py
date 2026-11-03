"""Builds the non-PS majors + Art History minor into data/programs.json, and writes
scripts/majors_courses.json (code -> title) for build_catalog.py.

Source: NYU Abu Dhabi Bulletin 2026-27 (bulletins.nyu.edu/undergraduate/abu-dhabi/programs/<program>/),
read 3 Nov 2026. Theater: NYUAD Theater major "Courses" page (the Bulletin page has no table).
Where the Bulletin lists no course codes for a category, the rule matches by subject/level and says so in a note.

Run from the repo root:  python3 scripts/build_majors.py && python3 scripts/build_catalog.py scripts/crossover.json data/catalog.json
"""
import json, re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROG = os.path.join(ROOT, 'data', 'programs.json')
TITLES = {}  # code -> title, for the catalog


def norm(code):
    m = re.match(r'([A-Z]+)-([A-Z]+)\s*(\d{4})([A-Z]*)$', code.strip().upper())
    return f"{m[1]}-{m[2]} {m[3]}{m[4]}" if m else code


def codes(*cs):
    out = []
    for c in cs:
        if isinstance(c, tuple):
            c, t = c
            TITLES.setdefault(norm(c), t)
        else:
            TITLES.setdefault(norm(c), TITLES.get(norm(c), ''))
        out.append(norm(c))
    return out


def lst(prefix, nums):
    """lst('ENGR-UH', '2011 2012') -> codes"""
    return codes(*[f'{prefix} {n}' for n in nums.split()])


def R(id, group, label, *, count=1, any=None, all=None, not_=None, note=None, credits=None):
    r = {'id': id, 'group': group, 'label': label, 'count': count}
    if any: r['any'] = any
    if all: r['all'] = all
    if not_: r['not'] = not_
    if note: r['note'] = note
    if credits is not None: r['credits'] = credits
    return r


def one(id, group, code, title, **kw):
    """A single named course."""
    return R(id, group, f'{norm(code)} {title}'.strip(), any=[{'codes': codes((code, title))}], **kw)


def either(id, group, pairs, **kw):
    """One of several named courses: pairs = [(code, title), ...]"""
    label = ' or '.join(f'{norm(c)} {t}' for c, t in pairs)
    return R(id, group, label, any=[{'codes': codes(*pairs)}], **kw)


def C(*cs): return {'codes': codes(*cs)}
def SUBJ(*s, **kw): return {'subject': list(s), **kw}


# ---------- shared blocks ----------
SPET = C(('CSTS-UH 1015', 'Legitimacy'), ('CSTS-UH 1097', 'Justice'), ('PHIL-UH 2614', 'Political Philosophy'),
         ('SOCSC-UH 1310', 'Foundations of Modern Social Thought'), ('SOCSC-UH 1311', 'Introduction to Political Theory'),
         ('SOCSC-UH 1312', 'Modern Social Theory in Comparative Perspective'), ('SOCSC-UH 1313', 'Perspectives on Democracy'),
         ('SOCSC-UH 1314', 'Sociological Theory'))
SPEH = C(('CSTS-UH 1012', 'Wealth of Nations'), ('CSTS-UH 1021', 'Boundaries'), ('CSTS-UH 1043', 'Great Divergence'),
         ('CSTS-UH 1125X', 'Law and Empire'), ('ECON-UH 1112', 'Introduction to Macroeconomics'),
         ('HIST-UH 2010', 'History and Globalization'), ('SOCSC-UH 1011', 'Global Economic, Political and Social Development'))


def socsc_foundations(markets=True):
    out = [one('stats', 'Foundation', 'SOCSC-UH 1010Q', 'Statistics for the Social and Behavioral Sciences')]
    if markets:
        out.append(one('markets', 'Foundation', 'SOCSC-UH 1111', 'Markets', note='Placed out of Markets? Take one extra major elective instead.'))
    out += [R('spet', 'Foundation', 'SPET (Social, Political & Economic Thought)', any=[SPET]),
            R('speh', 'Foundation', 'SPEH (Social, Political & Economic History)', any=[SPEH])]
    return out


def fos(levels, counts=None, credits=1.9):
    """Foundations of Science components by SCIEN-UH number range."""
    rng = {'1-2': (1100, 1299, 5), '3-4': (1300, 1499, 5), '5-6': (1500, 1699, 4)}
    out = []
    for i, lv in enumerate(levels):
        lo, hi, n = rng[lv]
        if counts: n = counts[i]
        out.append(R(f'fos{lv.replace("-", "")}', 'Foundations of Science', f'Foundations of Science {lv} component', count=n,
                     any=[{'subject': ['SCIEN'], 'minNum': lo, 'maxNum': hi}], credits=credits,
                     note='Lectures and labs count separately. If your plan lists Foundations of Science as one row, use "I\'ve already done this" for the rest.' if i == 0 else None))
    return out


def eng_common():
    return [
        one('e1000', 'Engineering Common', 'ENGR-UH 1000', 'Computer Programming for Engineers'),
        one('e1010', 'Engineering Common', 'ENGR-UH 1010', 'Engineering Ethics', credits=1),
        one('e1021', 'Engineering Common', 'ENGR-UH 1021', 'Design and Innovation', credits=2),
        one('e2011', 'Engineering Common', 'ENGR-UH 2011', 'Engineering Statics', credits=2),
        one('e2012', 'Engineering Common', 'ENGR-UH 2012', 'Conservation Laws in Engineering', credits=2),
        one('e2013', 'Engineering Common', 'ENGR-UH 2013', 'Digital Logic', credits=2),
        one('e2017', 'Engineering Common', 'ENGR-UH 2017', 'Numerical Methods', credits=2),
        one('e2019', 'Engineering Common', 'ENGR-UH 2019', 'Circuits Fundamentals', credits=2),
    ]


def eng_capstone():
    return [one('cap1', 'Capstone', 'ENGR-UH 4011', 'Senior Design Capstone Project I', credits=2),
            one('cap2', 'Capstone', 'ENGR-UH 4020', 'Senior Design Capstone Project II')]


def capstone(subj, a, b, ta='Capstone Seminar', tb='Capstone Project'):
    return [one('cap1', 'Capstone', f'{subj} {a}', ta), one('cap2', 'Capstone', f'{subj} {b}', tb)]


CALC = ('MATH-UH 1012Q', 'Calculus with Applications to Science and Engineering')
MVC = ('MATH-UH 1020Q', 'Multivariable Calculus with Applications to Science and Engineering')
LINALG = ('MATH-UH 1022Q', 'Linear Algebra')
ODE = ('MATH-UH 2010Q', 'Ordinary Differential Equations')
EM_ENG = ('PHYS-UH 2115', 'Electricity and Magnetism for Engineers')
PROB_ENG = ('ENGR-UH 2010Q', 'Probability and Statistics for Engineers')
DIFFEQ_ENG = ('ENGR-UH 2710', 'Differential Equations for Engineers')


def math_core(*which):
    m = {'calc': CALC, 'mvc': MVC, 'la': LINALG, 'ode': ODE}
    return [one(k, 'Science & Math', *m[k]) for k in which]


def track(id, short, reqs, name='2026–27 Bulletin', blurb=''):
    return {'id': id, 'name': name, 'short': short, 'blurb': blurb, 'requirements': reqs}


def major(id, name, match, tracks, contact='', note='', source=''):
    return {'id': id, 'name': name, 'match': match, 'contact': contact, 'trackNote': note, 'source': source, 'tracks': tracks}


B = 'NYUAD Bulletin 2026–27'
M = []

# ---------- Economics ----------
ECON_ELEC = C(*lst('BUSOR-UH', '1004 1007 1501 2003'), 'CDAD-UH 1078', 'CS-UH 2219',
              *lst('ECON-UH', '1112 1701 2310 2320 2410 2411 2451X 2510 2512 2514 2610 2710 2711 2922 3210 3300 3320 3400 3511X 3513 3520 3521 3600 3630 3900 3910 3912 3913 3940 3950 4210'),
              'HIST-UH 3110', *lst('POLSC-UH', '2311 2312 2326 3510'), *lst('SOCSC-UH', '2212 2213 2214 3210'), 'SRPP-UH 3214')
econ_base = socsc_foundations() + [
    one('micro', 'Economics', 'ECON-UH 2010', 'Intermediate Microeconomics'),
    one('data', 'Economics', 'ECON-UH 2020', 'Data Analysis: Economics'),
    one('macro', 'Economics', 'ECON-UH 2030', 'Intermediate Macroeconomics', note='Needs SOCSC-UH 1011 (GEPS) or ECON-UH 1112 first, at any site.'),
    one('imperfect', 'Economics', 'ECON-UH 3010', 'Economics of Imperfect Markets'),
    either('policy', 'Economics', [('ECON-UH 4000', 'Economic Policy'), ('ECON-UH 3030', 'Economic Growth')]),
    one('calc', 'Economics', 'MATH-UH 1013Q', 'Calculus with Applications to Economics'),
    one('mvc', 'Economics', 'MATH-UH 1021', 'Multivariable Calculus with Applications to Economics'),
    one('metrics', 'Economics', 'SOCSC-UH 3220', 'Econometrics'),
    R('econ3000', 'Electives', '3000/4000-level ECON-UH elective', all=[SUBJ('ECON', campus=['UH'], minLevel=3000, maxLevel=4999)]),
]
econ_cap = capstone('ECON-UH', 4020, 4099)
ECON_E = lambda n, note: R('econelec', 'Electives', 'Economics elective', count=n, any=[SUBJ('ECON', 'FINC'), ECON_ELEC], note=note)
conc = {
    'qea': ('Quantitative Economic Analysis', [
        one('c1', 'Concentration', 'ECON-UH 3940', 'Advanced Macroeconomics'), one('c2', 'Concentration', 'ECON-UH 3910', 'Advanced Microeconomics'),
        one('c3', 'Concentration', 'ECON-UH 4210', 'Advanced Econometrics'),
        R('c4', 'Concentration', 'Concentration elective', any=[C(*lst('ECON-UH', '3210 3300 3400 3600 3900 3912 3913'), ('ECON-UH 4005', 'Advanced Mathematics for Economists'), 'SOCSC-UH 3210')])]),
    'fms': ('Finance and Market Studies', [
        one('c1', 'Concentration', 'ECON-UH 2510', 'Foundations of Financial Markets'), one('c2', 'Concentration', 'ECON-UH 3520', 'Corporate Finance'),
        one('c3', 'Concentration', 'ECON-UH 3521', 'Asset Pricing and Derivatives'),
        R('c4', 'Concentration', 'Concentration elective', any=[C(*lst('ECON-UH', '2512 3320 3511X 3513 3950'))])]),
    'aep': ('Applied Economics and Economic Policy', [
        R('c1', 'Concentration', 'Applied field course', count=3, any=[C(*lst('ECON-UH', '2310 2320 2410 2610 2710 2711'))]),
        R('c4', 'Concentration', 'Concentration elective', any=[C(*lst('ECON-UH', '1701 2411 3210 3300 3320 3400 3600 3630'))])]),
}
M.append(major('econ', 'Economics (BA)', 'economics', [
    track('econ', 'No concentration', econ_base + [ECON_E(3, 'At least two must be ECON or FINC courses; the rest can come from the Bulletin\'s Economics electives list.')] + econ_cap)
] + [track(f'econ-{k}', f'{v[0]}', econ_base + [ECON_E(1, 'With a concentration, two concentration courses stand in for two major electives (80 credits total).')] + v[1] + econ_cap)
     for k, v in conc.items()], note='Concentrations are optional and add 8 credits (80 instead of 72).', source=B))

# ---------- Computer Science ----------
CS_REQ = [('CS-UH 1001', 'Introduction to Computer Science'), ('CS-UH 1002', 'Discrete Mathematics'), ('CS-UH 1050', 'Data Structures'),
          ('CS-UH 1052', 'Algorithms'), ('CS-UH 2010', 'Computer Systems Organization'), ('CS-UH 2012', 'Software Engineering'),
          ('CS-UH 3010', 'Operating Systems'), ('CS-UH 3012', 'Computer Networks')]
M.append(major('cs', 'Computer Science (BS)', 'computer science', [track('cs', 'Standard', [
    *[one(f'r{i}', 'Required', c, t) for i, (c, t) in enumerate(CS_REQ)],
    one('calc', 'Required', *CALC),
    R('elec', 'Electives', 'Computer Science elective', count=2, all=[SUBJ('CS', campus=['UH'], minLevel=2000)], not_=[C(*[c for c, _ in CS_REQ])]),
    one('seminar', 'Research', 'CS-UH 3090', 'Research Seminar in Computer Science', credits=2),
    *capstone('CS-UH', 4001, 4002, 'Capstone Project in Computer Science 1', 'Capstone Project in Computer Science 2'),
])], note='CS majors also need a minor: Applied Mathematics, Economics, Engineering, Interactive Media (Computational Media electives), Natural Sciences or Sound and Music Computing. A second major in Biology, Chemistry, Economics, Engineering, Mathematics or Physics covers it.', source=B))

# ---------- Art and Art History ----------
AH_LIST = C(*lst('ARTH-UH', '1116 1120X 1121X 1122X 1123 1717 1718 2118X 2123 2124 2125 2130 2131 2132 2610 3010'), 'ARTMD-GH 5133',
            *lst('AW-UH', '1113X 1115X 1120X'), *lst('CCEA-UH', '1003 1007 1061 1083 1090 1110 1139'), 'HERST-UH 1100', 'HIST-UH 3717',
            *lst('LITCW-UH', '2312X 2332 3501'), 'PHIL-UH 2416')
APD_LIST = C(*lst('ARTH-UH', '1510 1511 1512 1710 1712 1714 1717 2610 2712 2716 2721 2726 2813 2820 2822 2823 3811'),
             *lst('ARTMD-GH', '5001 5051 5510 5720'), *lst('CADT-UH', '1005 1020 1025 1097'), 'CCEA-UH 1138', *lst('FILMM-UH', '1010 3110'),
             *lst('IM-UH', '1010 2113 2315 2513 3118'), 'MUSIC-UH 1271', *lst('THEAT-UH', '1115 1121 1126 1127 1519'), 'PCIX-SHU 201')
for c, t in [('ARTH-UH 1116', 'South Asian Art'), ('ARTH-UH 1121X', 'Gulf and Indian Ocean World Art and Architecture'), ('ARTH-UH 1122X', 'Global Art and Science: Geometries, Ecologies, Technologies'),
             ('ARTH-UH 1123', 'East Asian Art'), ('ARTH-UH 1510', 'Photography I'), ('ARTH-UH 1511', 'Drawing and Painting I'), ('ARTH-UH 1512', 'Sculpture I'),
             ('ARTH-UH 1710', 'Types of Art: From Calligraphy and Stone Carving to Digital Type'), ('ARTH-UH 1712', 'Graphic Design'), ('ARTH-UH 1714', 'Yes Logo'),
             ('ARTH-UH 1717', 'Still (Moving) Images: Interventions and Experiments in Photography and Film'), ('ARTH-UH 2118X', 'Contemporary Art and Politics in the Arab World'),
             ('ARTH-UH 2120', 'Curatorial Practice'), ('ARTH-UH 2123', 'Museums, Art and Society'), ('ARTH-UH 2124', 'Art of the Sixties'),
             ('ARTH-UH 2125', 'Art of the 1970s and 80s: Postminimalism to Postmodernism & Beyond'), ('ARTH-UH 2130', 'International Surrealisms'),
             ('ARTH-UH 2131', 'Silk Roads, Sea Routes and Shared Heritage'), ('ARTH-UH 2132', 'Zen Art: Between History and Imagination'), ('ARTH-UH 2610', 'Global Renaissance'),
             ('ARTH-UH 2612', 'Abstraction: Painting Methods'), ('ARTH-UH 2712', 'Interventions: Three-Dimensional Thinking'), ('ARTH-UH 2716', 'Print Studio 1'),
             ('ARTH-UH 2721', 'Art and Architecture: Reinventing the City'), ('ARTH-UH 2726', 'City to Studio: Transforming Urban Research'), ('ARTH-UH 2820', 'Photography II'),
             ('ARTH-UH 2822', 'Projects in Mixed Media'), ('ARTH-UH 3811', 'Drawing and Painting II'), ('ARTH-UH 3010', 'Thinking Art'), ('ARTH-UH 3011', 'Making Art'),
             ('AW-UH 1113X', 'Alexander and the East'), ('AW-UH 1115X', 'The Politics of Archaeology'), ('AW-UH 1120X', 'Archaeology of the Gulf'),
             ('HERST-UH 1100', 'World Heritage Sites & Universal Collections'), ('PHIL-UH 2416', 'Images'), ('FILMM-UH 1010', 'Sound, Image, and Story'),
             ('FILMM-UH 3110', 'Archives, Methods, Screens'), ('IM-UH 1010', 'Introduction to Interactive Media'), ('IM-UH 2315', 'Software Art: Image'),
             ('IM-UH 2513', 'Future Punk'), ('IM-UH 3118', 'Machine Lab'), ('THEAT-UH 1115', 'Scenography: Performance, Production Design, Installation'),
             ('THEAT-UH 1121', 'Design for Performance'), ('THEAT-UH 1126', 'Costuming Performance'), ('THEAT-UH 1127', 'Ugly'), ('THEAT-UH 1519', 'Installation Art'),
             ('CADT-UH 1005', 'Creativity and Innovation'), ('CADT-UH 1020', 'Wayfinding: Graphic Design in the Built Environment'), ('CADT-UH 1025', 'Re-Design'),
             ('CCEA-UH 1003', 'Collecting'), ('CCEA-UH 1007', 'Abstraction'), ('CCEA-UH 1061', 'Memory'), ('CCEA-UH 1083', 'Cultural History of Falconry'),
             ('CCEA-UH 1090', 'Un/Making History'), ('CCEA-UH 1110', 'Faith and Finance'), ('CCEA-UH 1138', 'Eco-Art and Ecomedia'), ('CCEA-UH 1139', 'The Image in Question'),
             ('HIST-UH 3717', 'Art and Politics in Europe from the French Revolution to WWII')]:
    TITLES[norm(c)] = t
M.append(major('arth', 'Art and Art History (BA)', 'art and art history', [track('arth', 'Standard', [
    one('look', 'Required', 'ARTH-UH 1010', 'Ways of Looking'), one('make', 'Required', 'ARTH-UH 1718', 'Ways of Making'),
    either('think', 'Required', [('ARTH-UH 3010', 'Thinking Art'), ('ARTH-UH 3011', 'Making Art')]),
    R('ah', 'Electives', 'Art History elective', count=2, any=[AH_LIST]),
    R('apd', 'Electives', 'Arts Practice/Design elective', count=2, any=[APD_LIST]),
    R('any', 'Electives', 'Additional Art History or Arts Practice/Design elective', count=3, any=[AH_LIST, APD_LIST],
      note='Only two Core courses cross-listed with Art and Art History can count toward the electives.'),
    *capstone('ARTH-UH', 4000, 4001, 'Senior Seminar in Research and Practice', 'Capstone Project'),
])], source=B))

# ---------- Arab Crossroads Studies ----------
ACS_ELEC = C(*lst('ACS-UH', '1214X 1410X 1412X 1610X 1612X 2212X 2213X 2410X 2417 2419X 2613X 2614X 2615X'), *lst('ARTH-UH', '1121X 1122X 2118X 2131'),
             *lst('AW-UH', '1113X 1114 1115X 1118 1119X 1120X'), *lst('CCEA-UH', '1077X 1078X 1080X 1114X'), *lst('CSTS-UH', '1052X 1059X'),
             *lst('ECON-UH', '2451X 3511X'), 'FILMM-UH 1013X', *lst('HERST-UH', '1100 1101X 1501'), *lst('HIST-UH', '1126X 3513X'), *lst('LAW-UH', '2122X 2126X'),
             *lst('LITCW-UH', '1506 2312X 2340 2341 3350X'), *lst('MUSIC-UH', '1611X 1617X 1618X'), 'PHIL-UH 2211X', *lst('POLSC-UH', '1114 2421X 2422X 3212'),
             *lst('SRPP-UH', '1413X 1810X 2211 2412X 2416X 2612X 2614X 2801X'))
M.append(major('acs', 'Arab Crossroads Studies (BA)', 'arab crossroads', [track('acs', 'Standard', [
    either('a', 'Required', [('ACS-UH 1010X', 'Anthropology and the Arab World'), ('SRPP-UH 2416X', 'Gulf Urban Societies')]),
    either('b', 'Required', [('ACS-UH 1011X', 'Introduction to Modern Arabic Literature'), ('LITCW-UH 2312X', 'Masterpieces of Pre-Modern Arabic Literature in Translation')]),
    either('c', 'Required', [('ACS-UH 1012X', 'Emergence of the Modern Middle East'), ('ACS-UH 1410X', 'Making of the Muslim Middle East')]),
    either('d', 'Required', [('ACS-UH 3010', 'Problems and Methods in Arab Crossroads Studies'), ('POLSC-UH 3212', 'Qualitative Methods in Middle East Politics')]),
    R('elec', 'Electives', 'Arab Crossroads elective', count=4, any=[ACS_ELEC]),
    R('arabic', 'Arabic', 'Arabic proficiency (Intermediate Arabic 2 or above)', any=[C('ACS-UH 2213X', *lst('ARABL-UH', '2120 2211 2212 2213 3110 3120 3211'))], credits=0,
      note='A non-credit requirement. Placed out? Use "I\'ve already done this".'),
    *capstone('ACS-UH', 4000, 4001, 'Senior Capstone Seminar', 'Senior Capstone Project'),
])], source=B))

# ---------- Business, Organizations and Society ----------
M.append(major('bos', 'Business, Organizations and Society (BA)', 'business', [track('bos', 'Standard', socsc_foundations() + [
    either('micro', 'Required', [('BUSOR-UH 2006', 'Managerial Economics'), ('ECON-UH 2010', 'Intermediate Microeconomics')]),
    one('calc', 'Required', 'MATH-UH 1013Q', 'Calculus with Applications to Economics'),
    R('ethics', 'Electives', 'Business Ethics elective', any=[C('BUSOR-UH 1301')]),
    R('impact', 'Electives', 'Social Impact elective', any=[C(*lst('BUSOR-UH', '1011 1302 2301 2302'), ('POLSC-UH 2910', 'Business, Politics, and Society'))]),
    R('found', 'Electives', 'Business Foundations elective', count=3, any=[C(('BUSOR-UH 1003', 'Management & Organizations'), ('BUSOR-UH 1004', 'Strategic Management'),
                                                                               ('BUSOR-UH 1501', 'Introduction to Accounting'), ('ECON-UH 2510', 'Foundations of Financial Markets'))]),
    R('methods', 'Electives', 'Methods and Analytics elective', any=[C('BUSOR-UH 2004', 'CDAD-UH 1078EQ', 'ECON-UH 2020', 'POLSC-UH 2211', *lst('SOCSC-UH', '2211 2212 2214'), 'SRPP-UH 3215')]),
    R('general', 'Electives', 'General Business elective', any=[C(*lst('BUSOR-UH', '1007 1011 1016 1101 1103 1104 1105 1107 2003 2005 2101 2102 2105 2106 2107 2108 2109 2110 2111 3101'),
                                                                  'CDAD-UH 1064', 'CSTS-UH 1149', *lst('ECON-UH', '2310EQ 2411 2451X 2512 2610 2922 3511X 3520 3913'), 'ENGR-UH 4423',
                                                                  'LAW-UH 1013', *lst('POLSC-UH', '2326 2421X 3413 3510'), *lst('SRPP-UH', '1617 2627 2630'))]),
    *capstone('BUSOR-UH', 4000, 4001),
])], note='BOS also needs any approved minor except Economics or Business Studies (or a second major other than Economics).', source=B))

# ---------- Film and New Media ----------
FILM_ELEC = C('ARTH-UH 1510', 'CADT-UH 1052', *lst('CCEA-UH', '1062 1078X 1085 1090 1092 1113 1138 1139'), 'CSTS-UH 1099',
              *lst('FILMM-UH', '1012 1513 1514 1517 1910 1911 1912 2510 2513 3110 3511 3512'), 'IM-UH 1010', *lst('LITCW-UH', '1506 2315X 3317 3501'),
              'MUSIC-UH 2418', *lst('THEAT-UH', '1011 1110 1129 2115'))
M.append(major('film', 'Film and New Media (BA)', 'film', [track('film', 'Standard', [
    one('a', 'Required', 'FILMM-UH 1010', 'Sound, Image, and Story'), one('b', 'Required', 'FILMM-UH 1011', 'Concepts of Film and New Media'),
    one('c', 'Required', 'FILMM-UH 1013X', 'Understanding MENASA Film and New Media'),
    one('d', 'Required', 'FILMM-UH 1510', 'Techniques for Safety and Production', credits=2),
    either('e', 'Required', [('FILMM-UH 3110', 'Archives, Methods, Screens'), ('FILMM-UH 3511', 'Cinematic Expression: Methods, Sketches')]),
    R('elec', 'Electives', 'Film and New Media elective', count=6, any=[FILM_ELEC]),
    R('breadth', 'Electives', 'Breadth elective from another arts major', any=[SUBJ('ARTH', 'IM', 'MUSIC', 'THEAT')],
      note='From another arts program: Art and Art History, Interactive Media, Music or Theater.'),
    *capstone('FILMM-UH', 4000, 4001),
])], note='The program recommends counting no more than two courses taken away from Abu Dhabi toward the major.', source=B))

# ---------- History ----------
M.append(major('hist', 'History (BA)', 'history', [track('hist', 'Standard', [
    one('glob', 'Required', 'HIST-UH 2010', 'History and Globalization'), one('writing', 'Required', 'HIST-UH 3010', 'Writing History'),
    R('h1', 'Electives', '1000-level Regional Perspectives on World History', count=2, all=[SUBJ('HIST', maxLevel=1999)]),
    R('h2', 'Electives', '2000-level Global Thematic course', all=[SUBJ('HIST', minLevel=2000, maxLevel=2999)]),
    R('h3', 'Electives', '3000-level Major Topics course', count=4, all=[SUBJ('HIST', minLevel=3000, maxLevel=3999)],
      note='The four 3000-level courses must cover at least three of: Asia-Pacific; Atlantic World; Indian Ocean; Mediterranean, Black & Caspian Sea Worlds. At least one of the seven electives must be pre-1800.'),
    *capstone('HIST-UH', 4000, 4001),
])], note='The Bulletin doesn\'t list elective codes, so I match HIST courses by level. Cross-listed courses: set "Counts toward" under "Your plan".', source=B))

# ---------- Psychology ----------
PS_CP = ['PSYCH-UH 2216', 'PSYCH-UH 2217', 'PSYCH-UH 2218', 'PSYCH-UH 2410', 'PSYCH-UH 2411', 'PSYCH-UH 2412']
PS_SD = lst('PSYCH-UH', '2210 2211 2215 2216 2217 2219')
PS_ADV = ['POLSC-UH 2310', *lst('PSYCH-UH', '3512 3613 3614 3616 3617 3618 3619 3620 3621 3720')]
psych_base = [
    one('intro', 'Required', 'PSYCH-UH 1001', 'Introduction to Psychology'), one('methods', 'Required', 'PSYCH-UH 1002', 'Research Methods in Psychology'),
    one('bio', 'Required', 'PSYCH-UH 1003', 'Biopsychology'), one('stats', 'Required', 'PSYCH-UH 1004', 'Statistics for Psychology'),
    one('seminar', 'Required', 'PSYCH-UH 3090', 'Research Seminar in Psychology', credits=2),
]
psych_cap = capstone('PSYCH-UH', 4001, 4002, 'Capstone Project in Psychology 1', 'Capstone Project in Psychology 2')
M.append(major('psych', 'Psychology (BS)', 'psychology', [
    track('psych', 'Standard', psych_base + [
        R('cp', 'Electives', 'Cognition and Perception elective', count=2, any=[C(*PS_CP)]),
        R('sd', 'Electives', 'Social and Developmental elective', count=2, any=[C(*PS_SD)]),
        R('adv', 'Electives', 'Advanced Psychology elective', count=2, any=[C(*PS_ADV)], note='At least one must have a lab component. Advanced electives can\'t replace the other categories.'),
    ] + psych_cap),
    track('psych-bcs', 'Brain and Cognitive Science', psych_base + [
        one('n1', 'Specialization', 'BIOL-UH 3101', 'Behavioral and Integrative Neuroscience'), one('n2', 'Specialization', 'BIOL-UH 3211', 'Experimental Neurobiology'),
        one('cp1', 'Electives', 'PSYCH-UH 2412', 'Cognition and Perception elective (required for BCS)'),
        R('cp', 'Electives', 'Cognition and Perception elective', any=[C(*PS_CP)]),
        R('sd', 'Electives', 'Social and Developmental elective', count=2, any=[C(*PS_SD)]),
        R('adv', 'Electives', 'BCS Advanced elective', count=2, any=[C(*lst('PSYCH-UH', '3512 3614 3617 3620 3621 3720'))]),
    ] + psych_cap)], note='PSYCN-UH (non-majors) courses don\'t count.', source=B))

# ---------- Legal Studies ----------
M.append(major('law', 'Legal Studies (BA)', 'legal', [track('law', 'Standard', [
    one('a', 'Required', 'LAW-UH 1010', 'What is Law? Comparative Global Jurisprudence'), one('b', 'Required', 'LAW-UH 1011', 'Legal Writing and Research'),
    one('c', 'Required', 'LAW-UH 1012', 'Legal System and Method'),
    either('d', 'Required', [('LAW-UH 1013', 'Business Law'), ('LAW-UH 1014', 'Commercial Law')]),
    one('e', 'Required', 'LAW-UH 3010', 'Legal Ethics and Professional Responsibility'),
    either('f', 'Required', [('LAW-UH 2010', 'Legal Institutions'), ('LAW-UH 2011', 'Constitutional and Administrative Law'), ('LAW-UH 2123', 'Public International Law')]),
    R('elec', 'Electives', 'Legal Studies elective', count=4, any=[{'tags': ['law-req', 'law-elec']}, SUBJ('LAW')]),
    *capstone('LAW-UH', 4000, 4001),
])], note='Optional London track: the Bulletin recommends LAW-UH 1014, 2011, 1110, 2500, 2501, 3500, 3501 and 3503.', source=B))

# ---------- Philosophy ----------
PHIL_NOTE = 'The Bulletin doesn\'t publish the category lists. Check the course\'s attributes in Albert, then set "Counts toward" under "Your plan".'
M.append(major('phil', 'Philosophy (BA)', 'philosophy', [track('phil', 'Standard', [
    R('intro', 'Required', 'Introductory elective', any=[{'tags': ['phil-intro']}, SUBJ('PHIL', maxLevel=1999)], not_=[C('PHIL-UH 1810')]),
    one('logic', 'Required', 'PHIL-UH 1810', 'Introduction to Logic'),
    R('history', 'Required', 'History of Philosophy elective', all=[SUBJ('PHIL', minLevel=2000)], note=PHIL_NOTE),
    R('theory', 'Required', 'Theoretical Philosophy elective', all=[SUBJ('PHIL', minLevel=2000)]),
    R('practical', 'Required', 'Practical Philosophy elective', all=[SUBJ('PHIL', minLevel=2000)]),
    R('seminar', 'Required', 'Advanced Seminar', all=[SUBJ('PHIL', minLevel=3000, maxLevel=3999)]),
    R('more', 'Electives', 'Additional Philosophy course', count=2, all=[SUBJ('PHIL')], note='No more than two introductory electives count toward the major.'),
    *capstone('PHIL-UH', 4000, 4001, 'Capstone Project', 'Capstone Project'),
])], source=B))

# ---------- Social Research and Public Policy ----------
SRPP_METH = C('BUSOR-UH 2004', 'CDAD-UH 1067', 'CDAD-UH 1078', 'CS-UH 2219', *lst('ECON-UH', '2020 3210 3912'), 'POLSC-UH 2211',
              *lst('SOCSC-UH', '2211 2212 2213 2214 3210 3220'), *lst('SRPP-UH', '2211 2214 3210 3214 3215 3610'))
SRPP_IPP = C('ANTH-UH 2124', *lst('BUSOR-UH', '1011 1302'), *lst('CSTS-UH', '1074 1087 1102'), 'ECON-UH 1701', 'ENVR-UH 1312', 'HERST-UH 1502',
             *lst('LAW-UH', '1013 2124 3503'), *lst('POLSC-UH', '2311 2326 2411 2423 2511 3213 3313 3413'), 'SOCSC-UH 1112',
             *lst('SRPP-UH', '1617 1816 1818 2414 2419 2420 2610 2611 2612X 2614X 2616 2618 2619 2620 2627 2629 2630 2801X 3610'))
SRPP_SSGP = C(*lst('ACS-UH', '1612X 2614X'), 'CDAD-UH 1046', *lst('CSTS-UH', '1017 1053 1074 1099 1102'), 'ECON-UH 1701', 'ENVR-UH 1312',
              *lst('HIST-UH', '1125X 3110'), 'IM-UH 3511', *lst('POLSC-UH', '2411 3514'),
              *lst('SRPP-UH', '1413X 1701 2410 2412X 2414 2418 2420 2421 2422 2612X 2614X 2616 2618 2620 2629 2630 3412'))
SRPP_SC = C(*lst('ACS-UH', '1010X 1612X 2613X 2614X'), *lst('ANTH-UH', '1010 1104 2111 2113 2124'), 'BUSOR-UH 2110', *lst('CCEA-UH', '1112 1114X'),
            'CDAD-UH 1046', *lst('CSTS-UH', '1017 1053 1074 1099 1102 1131'), 'ECON-UH 1701', 'ENVR-UH 1312',
            *lst('HIST-UH', '1125X 2117X 2121 2710 3110 3315'), 'IM-UH 3511', 'MUSIC-UH 2668', *lst('POLSC-UH', '2411 3514'), *lst('PSYCH-UH', '2211 2215'), 'PSYCN-UH 1002',
            *lst('SRPP-UH', '1413X 1701 1810X 1816 1818 2410 2412X 2414 2416X 2418 2420 2421 2422 2612X 2614X 2616 2618 2620 2627 2629 2630 2801X 3412 3810'))
srpp_base = [s for s in socsc_foundations(markets=False)] + [
    one('society', 'Foundation', 'SOCSC-UH 1113', 'Introduction to the Study of Society'),
    R('methods', 'SRPP', 'SRPP Methods elective', count=2, any=[SRPP_METH]),
]
srpp_rest = [
    R('ssgp', 'SRPP', 'Social Structure and Global Processes elective', count=2, any=[SRPP_SSGP]),
    R('sc', 'SRPP', 'Society and Culture elective', count=2, any=[SRPP_SC]),
    *capstone('SRPP-UH', 4000, 4001),
]
M.append(major('srpp', 'Social Research and Public Policy (BA)', 'social research', [
    track('srpp', 'No concentration', srpp_base + [R('ipp', 'SRPP', 'Institutions and Public Policy elective', count=2, any=[SRPP_IPP])] + srpp_rest),
    track('srpp-pa', 'Policy Analysis', srpp_base + [
        one('pa1', 'Concentration', 'SRPP-UH 2610', 'Introduction to Public Policy'), one('pa2', 'Concentration', 'SRPP-UH 3610', 'Methods of Public Policy Analysis'),
        R('ipp', 'SRPP', 'Institutions and Public Policy elective', count=4, any=[SRPP_IPP], note='Policy Analysis adds two IPP electives (four in total).')] + srpp_rest),
], source=B))

# ---------- Interactive Media ----------
IM_CM = C('CDAD-UH 1034', 'CS-UH 1001', *lst('ENGR-UH', '1000 3331 3720'), *lst('IM-UH', '2110 2314 2315 2316 2318 2320 2322 2324 3115 3311 3312 3315 3325'),
          'INTM-SHU 258', *lst('MUSIC-UH', '2419 3417'))
IM_MDT = C('ANTH-UH 1102X', *lst('ARTH-UH', '1712 1714'), *lst('CADT-UH', '1001 1005 1020 1074'), *lst('CCEA-UH', '1098 1138'), *lst('CDAD-UH', '1001 1024'),
           'CSTS-UH 1099', 'ENGR-UH 1021', *lst('FILMM-UH', '2513 3110'), 'HIST-UH 1126X', *lst('IM-UH', '1511 2111 2513 2514 2515 2516 2517 3510 3511'),
           'INTM-SHU 193', *lst('MUSIC-UH', '1002 2416'), *lst('THEAT-UH', '1519 1522'))
IM_PC = C('ENGR-UH 4330', *lst('IM-UH', '2314 3116 3117 3118 3315'))
IM_2K = C('CADT-UH 1005', 'CCEA-UH 1138', 'CDAD-UH 1034', 'CSTS-UH 1099', *lst('ENGR-UH', '3331 4330'), *lst('FILMM-UH', '2513 3110'),
          *lst('IM-UH', '2110 2111 2315 2316 2318 2320 2322 2324 2513 2514 2515 2516 2517'), 'INTM-SHU 258', *lst('MUSIC-UH', '2416 2419 3417'), 'THEAT-UH 1522')
IM_3K = C('ENGR-UH 3720', *lst('IM-UH', '3115 3116 3117 3118 3311 3312 3315 3325 3510'))
M.append(major('im', 'Interactive Media (BA)', 'interactive media', [track('im', 'Standard', [
    one('a', 'Foundation', 'IM-UH 1010', 'Introduction to Interactive Media'), one('b', 'Foundation', 'IM-UH 1011', 'Communications Lab'),
    one('c', 'Foundation', 'IM-UH 1012', 'Communication and Technology'), one('d', 'Foundation', 'IM-UH 1013', 'Understanding Interactive Media'),
    R('cm', 'Clusters', 'Computational Media elective', any=[IM_CM]), R('mdt', 'Clusters', 'Media and Design Thinking elective', any=[IM_MDT]),
    R('pc', 'Clusters', 'Physical Computing elective', any=[IM_PC]),
    R('e2', 'Electives', 'IM 2000-level category elective', count=2, any=[IM_2K]), R('e3', 'Electives', 'IM 3000-level category elective', any=[IM_3K]),
    *capstone('IM-UH', 4000, 4001),
])], source=B))

# ---------- Literature and Creative Writing ----------
LIT_H = C(*lst('ACS-UH', '1214X 2212X'), *lst('CCEA-UH', '1009X 1055 1056 1074 1082 1102 1125'), 'CSTS-UH 1101', *lst('LITCW-UH', '1102 1508 2312X 2332 2340'))
LIT_G = C('CCEA-UH 1082', 'CSTS-UH 1101', 'ENGL-UA 9164', *lst('LITCW-UH', '1004 1102 1106 1509 1510G 2312X 2332 2333 2340 2341 3317 3350X'))
LIT_T = C(*lst('ACS-UH', '1011X 1214X 2212X 2213X'), 'ANTH-UH 2113', *lst('CADT-UH', '1021 1027'), *lst('CCEA-UH', '1009X 1011 1063 1074 1092 1107 1123 1136'),
          *lst('FILMM-UH', '1012 3110'), 'IM-UH 2316', *lst('LITCW-UH', '1101 1102 1105 1160X 1501 1503 1506 1508 2101 2315X 2503 2504 2510 3319 3501 3502 3504'),
          *lst('THEAT-UH', '1112 1129 1521'))
LIT_CW = C('CADT-UH 1092', 'FILMM-UH 1012', 'IM-UH 2316', *lst('LITCW-UH', '1004 1501 1503 1503G 1506 1508 1509 1510G 2341 2503 2504 2510 3319 3501 3502 3504'),
           *lst('THEAT-UH', '1112 1129 1523'))
litcw_req = [one('interp', 'Required', 'LITCW-UH 1000', 'Literary Interpretation'), one('cw', 'Required', 'LITCW-UH 1003', 'Introduction to Creative Writing'),
             one('methods', 'Required', 'LITCW-UH 3000', 'Problems and Methods of Literary Studies')]
LIT_NOTE = 'At least two of the five track electives must be LITCW-UH courses.'
M.append(major('litcw', 'Literature and Creative Writing (BA)', 'literature', [
    track('litcw-lit', 'Literary Studies', litcw_req + [
        R('hist', 'Track', 'Literature: Histories elective', any=[LIT_H], note=LIT_NOTE), R('geo', 'Track', 'Literature: Geographies elective', any=[LIT_G]),
        R('topics', 'Track', 'Literature: Topics elective', any=[LIT_T]), R('more', 'Track', 'Additional literature or creative writing elective', count=2, any=[LIT_H, LIT_G, LIT_T, LIT_CW]),
    ] + capstone('LITCW-UH', 4000, 4001)),
    track('litcw-cw', 'Creative Writing', litcw_req + [
        R('cw3', 'Track', 'Creative Writing elective (LITCW-UH)', count=3, all=[LIT_CW, SUBJ('LITCW')], note=LIT_NOTE),
        R('lit2', 'Track', 'Literature elective', count=2, any=[LIT_H, LIT_G, LIT_T]),
    ] + capstone('LITCW-UH', 4000, 4001)),
], source=B))

# ---------- Mathematics ----------
MATH_A = lst('CS-UH', '3211') + ['ECON-UH 4005'] + lst('MATH-UH', '2410Q 3410 3411 3413 3414 3415Q 3612') + ['PHYS-UH 3010', 'SOCSC-UH 3210']
MATH_P = lst('MATH-UH', '3210 3212 3213 3410 3411 3414 3415Q 3610 3612 4610')
MATH_BR = C(*lst('CS-UH', '1001 1002 1050 1052 2010 2218 2220'), *lst('ECON-UH', '2010 2020 2030 4210'),
            *lst('ENGR-UH', '1000 2011 2012 2013 2017 2019 2026 2027 2210 2211 2212 2811 3130 3230 3610 3710 3730 3751 4230'), 'IM-UH 2318',
            *lst('PHIL-UH', '1810 2414 2415 2417 2810 2910'),
            *lst('SCIEN-UH', '1121EQ 1122EQ 1123EQ 1124C 1124P 1341Q 1342Q 1343 1344BE 1344CE 1561Q 1563 1564BE 1564EP'), 'SOCSC-UH 1111', 'SOCSC-UH 2214', 'SOCSC-UH 3220')
M.append(major('math', 'Mathematics (BS)', 'math', [track('math', 'Standard', [
    one('found', 'Required', 'MATH-UH 1010Q', 'Foundations of Mathematics'),
    one('calc', 'Required', *CALC, note='Placed out of Calculus? Take an extra Math elective instead.'), one('mvc', 'Required', *MVC), one('la', 'Required', *LINALG),
    one('ode', 'Required', *ODE), one('prob', 'Required', 'MATH-UH 2011Q', 'Probability and Statistics'),
    one('alg', 'Required', 'MATH-UH 2012Q', 'Abstract Algebra 1'), one('an', 'Required', 'MATH-UH 2013Q', 'Analysis 1'),
    one('seminar', 'Required', 'MATH-UH 3090', 'Research Seminar in Mathematics', credits=2),
    R('a', 'Math electives', 'Math elective, Category A (Applied)', any=[C(*MATH_A)]),
    R('p', 'Math electives', 'Math elective, Category P (Pure)', any=[C(*MATH_P)]),
    R('ap', 'Math electives', 'Math elective (A or P)', any=[C(*MATH_A, *MATH_P)]),
    R('breadth', 'Breadth', 'Breadth elective', count=3, any=[MATH_BR], note='12 credits from the Bulletin\'s breadth list (CS, Economics, Engineering, Philosophy, Science).'),
    *capstone('MATH-UH', 4001, 4002, 'Capstone Project in Mathematics 1', 'Capstone Project in Mathematics 2'),
])], source=B))

# ---------- Physics ----------
phys_base = fos(['1-2', '3-4', '5-6']) + math_core('calc', 'mvc', 'la', 'ode') + [
    one('em', 'Physics', 'PHYS-UH 2010', 'Electromagnetism and Special Relativity'), one('mech', 'Physics', 'PHYS-UH 3010', 'Mechanics'),
    one('eandm', 'Physics', 'PHYS-UH 3011', 'Electricity and Magnetism'), one('qm', 'Physics', 'PHYS-UH 3012', 'Quantum Mechanics 1'),
    one('lab', 'Physics', 'PHYS-UH 3013', 'Advanced Physics Laboratory'), one('stat', 'Physics', 'PHYS-UH 3014', 'Statistical Mechanics and Thermodynamics'),
    one('seminar', 'Physics', 'PHYS-UH 3090', 'Research Seminar in Physics', credits=2),
]
phys_cap = capstone('PHYS-UH', 4001, 4002, 'Capstone Project in Physics 1', 'Capstone Project in Physics 2')
PHYS_EL = C('ENGR-UH 3611', *lst('MATH-UH', '2011 3411 3413 3414 3610'), 'PHYS-GA 9007', *lst('PHYS-UH', '3211 3213 3214 3217 3219 3220 3223 3260 4212 4215'))
M.append(major('phys', 'Physics (BS)', 'physics', [
    track('phys', 'Standard', phys_base + [R('elec', 'Electives', 'Physics elective', any=[PHYS_EL])] + phys_cap),
    track('phys-astro', 'Astrophysics', phys_base + [
        R('astro', 'Specialization', 'Astrophysics elective', count=3, any=[C(*lst('PHYS-UH', '3211 3213 3214 3217'))]),
        R('astrolab', 'Specialization', 'Astrophysics lab elective', any=[C(*lst('PHYS-UH', '3215 3220 3222 3223'))])] + phys_cap),
    track('phys-bio', 'Biophysics', phys_base + [
        one('bp1', 'Specialization', 'BIOL-UH 3130', 'Biophysics'), one('bp2', 'Specialization', 'PHYS-UH 3219', 'Biological Physics'),
        R('bpe', 'Specialization', 'Biophysics elective', count=2, any=[C(*lst('BIOL-UH', '2010 2114 3116 3123 3218 3220'), *lst('CHEM-UH', '3011 3016 3020 3022 3201'))])] + phys_cap),
], note='Grades of C or better are required in the physics components of Foundations of Science.', source=B))

# ---------- Biology ----------
BIO_REQ = [('BIOL-UH 2010', 'Human Physiology'), ('CHEM-UH 2010', 'Organic Chemistry 1'), ('BIOL-UH 3120', 'Biostatistics')]
M.append(major('bio', 'Biology (BS)', 'biology', [track('bio', 'Standard', fos(['1-2', '3-4', '5-6']) + math_core('calc', 'mvc') + [
    *[one(f'r{i}', 'Required', c, t, **({'credits': 5} if c.startswith('CHEM') else {})) for i, (c, t) in enumerate(BIO_REQ)],
    R('elec', 'Electives', 'Biology elective', count=4, all=[SUBJ('BIOL', minLevel=2000)], not_=[C(*[c for c, _ in BIO_REQ]), C('BIOL-UH 3090', 'BIOL-UH 4001', 'BIOL-UH 4002')]),
    one('seminar', 'Required', 'BIOL-UH 3090', 'Research Seminar in Biology', credits=2),
    *capstone('BIOL-UH', 4001, 4002, 'Capstone Project in Biology 1', 'Capstone Project in Biology 2'),
])], note='Grades of C or better are required in the biology components of Foundations of Science. Specializations (Brain and Cognitive Science, Biophysics) aren\'t modelled yet.', source=B))

# ---------- Chemistry ----------
M.append(major('chem', 'Chemistry (BS)', 'chemistry', [track('chem', 'Standard', fos(['1-2', '3-4', '5-6']) + math_core('calc', 'mvc') + [
    one('oc1', 'Required', 'CHEM-UH 2010', 'Organic Chemistry 1', credits=5), one('oc2', 'Required', 'CHEM-UH 3010', 'Organic Chemistry 2'),
    one('oc2l', 'Required', 'CHEM-UH 3050', 'Organic Chemistry 2 Lab', credits=1),
    one('pc1', 'Required', 'CHEM-UH 3011', 'Physical Chemistry: Thermodynamics and Kinetics'),
    one('pc1l', 'Required', 'CHEM-UH 3012', 'Physical Chemistry Laboratory: Thermodynamics and Kinetics', credits=2),
    one('pc2', 'Required', 'CHEM-UH 3013', 'Physical Chemistry: Quantum Mechanics and Spectroscopy'),
    one('pc2l', 'Required', 'CHEM-UH 3014', 'Physical Chemistry Laboratory: Quantum Mechanics and Spectroscopy', credits=2),
    one('inorg', 'Required', 'CHEM-UH 3015', 'Inorganic Chemistry'), one('anal', 'Required', 'CHEM-UH 3016', 'Analytical Chemistry'),
    R('biochem', 'Required', 'Biochemistry: Molecular Structure and Function, or Biochemistry: Metabolism', all=[SUBJ('CHEM', minLevel=3000)],
      note='The Bulletin page doesn\'t give these course numbers. Set "Counts toward" under "Your plan" once you know the code.'),
    R('elec', 'Electives', 'Chemistry elective', all=[SUBJ('CHEM', minLevel=3000)], note='Enough to reach 56 major credits. Check the track (Chemical Sciences or Medical Sciences) with your mentor.'),
    one('seminar', 'Required', 'CHEM-UH 3090', 'Research Seminar in Chemistry', credits=2),
    *capstone('CHEM-UH', 4001, 4002, 'Capstone Project in Chemistry 1', 'Capstone Project in Chemistry 2'),
])], note='The Bulletin page for Chemistry is incomplete (no elective list or track tables). Treat this one as a rough guide.', source=B))

# ---------- Engineering ----------
def eng_major(id, name, match, designated, required, electives, note=''):
    return major(id, name, match, [track(id, 'Standard', fos(['1-2'], credits=1.6) + designated + eng_common() + required + electives + eng_capstone())],
                 note=('All engineering majors need at least 16 science credits. ' + note).strip(), source=B)


def ones(group, prefix, pairs, **kw):
    return [one(f'{group[:3].lower()}{n}', group, f'{prefix} {n}', t, **kw) for n, t in pairs]


DES = 'Science & Math'
M.append(eng_major('civil', 'Civil Engineering (BS)', 'civil', [
    one('prob', DES, *PROB_ENG, credits=2), one('data', DES, 'ENGR-UH 2027', 'Introduction to Data Analysis for Engineers', credits=2),
    either('chem', DES, [('ENGR-UH 2410', 'Chemistry for Engineers'), ('ENGR-UH 3130', 'Quantitative Synthetic Biology')], credits=2),
    *math_core('calc', 'mvc', 'la'), either('ode', DES, [ODE, DIFFEQ_ENG])],
    ones('Civil', 'ENGR-UH', [(2211, 'Solid Mechanics'), (2212, 'Fluid Mechanics'), (3120, 'Engineering Materials'), (3210, 'Advanced Solid Mechanics'),
                              (3410, 'Structural Systems'), (3411, 'Environmental Engineering'), (3412, 'Geotechnical Engineering'),
                              (3413, 'Transportation and Traffic Engineering'), (3420, 'Project Management'), (4433, 'Structure and Properties of Civil Engineering Materials')]),
    [R('design', 'Civil electives', 'Civil Engineering design elective', any=[C(('ENGR-UH 3430', 'Steel Structures Design'), ('ENGR-UH 3431', 'Concrete Structures Design'),
                                                                                  ('ENGR-UH 3432', 'Water and Wastewater Systems Design'), ('ENGR-UH 4431', 'Foundation Engineering Design'),
                                                                                  ('ENGR-UH 4434', 'Water Desalination Engineering'))]),
     R('elec', 'Civil electives', 'Civil Engineering elective', any=[C(*lst('ENGR-UH', '3430 3431 3432 4431 4434 3111 3230 3332 3414 4112 4230 4231 4423 4424 4436 4460 4712 4765'))],
       note='Enough to reach 41 discipline credits. Some courses are 2 credits.')]))
M.append(eng_major('mech', 'Mechanical Engineering (BS)', 'mechanical', [
    one('em', DES, *EM_ENG), *math_core('calc', 'mvc', 'la'), one('prob', DES, *PROB_ENG, credits=2), one('de', DES, *DIFFEQ_ENG)],
    ones('Mechanical', 'ENGR-UH', [(2210, 'Engineering Dynamics'), (2211, 'Solid Mechanics'), (2212, 'Fluid Mechanics'), (3120, 'Engineering Materials'),
                                   (3210, 'Advanced Solid Mechanics'), (3710, 'Thermodynamics'), (3720, 'Computer-Aided Design'),
                                   (3730, 'Modeling and Analysis of Dynamical Systems'), (3751, 'Heat Transport'), (3752, 'Thermofluids Lab'),
                                   (4140, 'Mechatronics'), (4145, 'Mechatronics Lab')]),
    [R('elec', 'Mechanical electives', 'Mechanical Engineering elective', count=2,
       any=[C(*lst('ENGR-UH', '2028 2113 2350 2610 2810 2812 3111 3230 3332 3410 3411 3414 3420 3714 3810 3812 3813 4112 4141 4142 4143 4230 4231 4330 4423 4610 4620 4701 4712 4713 4714 4760 4810'), 'PHYS-UH 3213')],
       note='Enough to reach 41 discipline credits. Many of these are 2 credits, so you may need more than two.')]))
M.append(eng_major('comp', 'Computer Engineering (BS)', 'computer engineering', [
    one('em', DES, *EM_ENG), one('disc', DES, 'CS-UH 1002', 'Discrete Mathematics'), one('prob', DES, *PROB_ENG, credits=2), *math_core('calc', 'mvc', 'la')],
    ones('Computer Eng', 'ENGR-UH', [(2350, 'Hardware Design'), (2510, ''), (3510, ''), (3511, ''),
                                     (3512, 'Computer Networks'), (3520, 'Operating Systems'), (3530, 'Embedded Systems')]),
    [R('elec', 'Computer Eng electives', 'Computer Engineering elective', count=3, credits=4.3,
       any=[C(*lst('CS-UH', '2012 2214 2216 2221 3210 3211 3212'), *lst('ENGR-UH', '2410 2812 3331 3332 3610 3611 3714 4112 4142 4143 4230 4321 4322 4323 4330 4560 4620 4701'),
              *lst('MUSIC-UH', '2419 3417'))], note='13 credits in total.')]))
M.append(eng_major('elec', 'Electrical Engineering (BS)', 'electrical', [
    one('em', DES, *EM_ENG), *math_core('calc', 'mvc', 'la', 'ode'), one('prob', DES, *PROB_ENG, credits=2), one('e2025', DES, 'ENGR-UH 2025', '', credits=2)],
    ones('Electrical', 'ENGR-UH', [(2310, ''), (2311, ''), (2610, 'Fundamentals of Complex Variables')], credits=2) +
    ones('Electrical', 'ENGR-UH', [(3110, ''), (3610, ''), (3611, ''), (3613, ''),
                                   (3620, ''), (4610, 'Control Systems Engineering')]),
    [R('elec', 'Electrical electives', 'Electrical Engineering elective', count=3, credits=3.3,
       any=[C(*lst('ENGR-UH', '1801 2510 2812 3331 3332 3510 3511 3512 3520 3530 4112 4141 4142 4230 4320 4330 4560 4620 4660 4701 4770'),
              *lst('CS-UH', '1050 1052 2010 2220'), 'IM-UH 2310', 'MUSIC-UH 2419', 'PHYS-UH 3220')], note='10 credits in total.')]))
M.append(eng_major('geng', 'General Engineering (BS)', 'general engineering', [
    one('em', DES, *EM_ENG), *math_core('calc', 'mvc', 'la'), either('ode', DES, [ODE, DIFFEQ_ENG]), one('prob', DES, *PROB_ENG, credits=2),
    either('cs', DES, [('CS-UH 1002', 'Discrete Mathematics'), ('ENGR-UH 2027', 'Introduction to Data Analysis for Engineers')], credits=2)],
    [], [R('elec', 'Engineering electives', 'Engineering elective', count=10, credits=3.9, all=[SUBJ('ENGR', minLevel=2000)],
           not_=[C(*lst('ENGR-UH', '2010 2011 2012 2013 2017 2019 2027 2710 4011 4020'))],
           note='At least 39 credits from the Engineering electives list. Optional themes: Cyber Security, Robotics, Urban Systems, Environmental Sustainability, BioMedical and Health Systems.')]))
M.append(eng_major('bioe', 'Bioengineering (BS)', 'bioengineering',
    [*fos(['3-4'], counts=[5], credits=1.6), one('bchem', DES, 'CHEM-UH 3101', '', credits=2),
     *math_core('calc', 'mvc', 'la'), one('prob', DES, *PROB_ENG, credits=2), one('de', DES, *DIFFEQ_ENG)],
    ones('Bioengineering', 'ENGR-UH', [(1801, ''), (2810, 'Biomechanics'), (2811, ''), (2812, 'Bioimaging'),
                                       (2813, ''), (4810, 'Biomaterials')], credits=2),
    [R('engel', 'Bioengineering electives', 'Engineering elective', count=3, any=[C('BIOL-UH 2010', 'CHEM-UH 3201',
        *lst('ENGR-UH', '2028 2210 2211 2212 2311 3111 3120 3230 3332 3411 3530 3610 3611 3720 3810 3811 3812 3813 4112 4140 4141 4142 4145 4160 4231 4330'))], note='At least 12 of the 22 elective credits.'),
     R('sciel', 'Bioengineering electives', 'Science or Engineering elective', count=3, credits=3.3,
       any=[C(*lst('BIOL-UH', '3116 3121 3122 3123 3124 3130 3215 3220'), *lst('CHEM-UH', '2010 3010 3011 3012 3020 3050'), 'ENGR-UH 3130', 'PHYS-UH 3219', 'PSYCH-UH 3617EQ',
              'BIOL-UH 2010', 'CHEM-UH 3201', *lst('ENGR-UH', '2028 2210 2211 2212 2311 3111 3120 3230 3332 3411 3530 3610 3611 3720 3810 3811 3812 3813 4112 4140 4141 4142 4145 4160 4231 4330'))],
       note='22 elective credits in total. Pre-med: CHEM-UH 2010 and 3010 can count here.')]))

# ---------- Music ----------
music_req = [one('theory', 'Required', 'MUSIC-UH 1001', 'Music Theory & Analysis I'), one('tech', 'Required', 'MUSIC-UH 1002', 'Music Technology Fundamentals'),
             one('making', 'Required', 'MUSIC-UH 1003', 'Making Music'),
             either('h1', 'Required', [('MUSIC-UH 1004', 'Music: Histories and Historiography 1'), ('MUSIC-UH 1005', 'Anthropology of Music 1')],
                    note='Take a matching pair: 1004 + 2005, or 1005 + 2004.'),
             either('h2', 'Required', [('MUSIC-UH 2005', 'Anthropology of Music 2'), ('MUSIC-UH 2004', 'Music Histories and Historiography 2')])]
music_cap = capstone('MUSIC-UH', 4000, 4001, 'Capstone Seminar', 'Capstone Project')
MUS_NOTE = 'The Bulletin doesn\'t list codes for these categories; any MUSIC course is matched. Individual instruction can\'t exceed 8 credits per instrument/composition or 10 in total.'
M.append(major('music', 'Music (BA)', 'music', [
    track('music-ap', 'Artistic Practice', music_req + [
        R('ts', 'Track', 'Music Theory or Music Studies elective', all=[SUBJ('MUSIC')]),
        R('pt', 'Track', 'Music Practice or Music Technology elective', count=5, credits=4, all=[SUBJ('MUSIC')],
          note='20 credits, including at least two 2-credit instruction/ensemble experiences and two 3–4 credit courses. ' + MUS_NOTE)] + music_cap),
    track('music-ms', 'Music Studies', music_req + [
        R('ts', 'Track', 'Music Theory or Music Studies elective', count=8, all=[SUBJ('MUSIC')], note=MUS_NOTE),
        R('more', 'Track', 'Additional Music Studies or Theory elective', count=4, all=[SUBJ('MUSIC')], note='16 credits.')] + music_cap),
], note='Ensembles, individual and group instruction, MUSIC-UH 1410 and 1420 are 2 credits.', source=B))

# ---------- Theater ----------
M.append(major('theat', 'Theater (BA)', 'theat', [track('theat', 'Standard', [
    one('make', 'Required', 'THEAT-UH 1010', 'Making Theater'), one('think', 'Required', 'THEAT-UH 1011', 'Thinking Theater'),
    one('seminar', 'Required', 'THEAT-UH 3090', 'Capstone Seminar'),
    R('ap', 'Electives', 'Arts Practice elective', all=[SUBJ('THEAT')], note='Category lists aren\'t published with codes; check the course attributes in Albert.'),
    R('htc', 'Electives', 'History, Theory, Criticism elective', all=[SUBJ('THEAT')]),
    R('more', 'Electives', 'Additional Theater elective', count=4, all=[SUBJ('THEAT')]),
    R('arts', 'Electives', 'Elective from another arts program', any=[SUBJ('ARTH', 'FILMM', 'IM', 'MUSIC')]),
    one('cap1', 'Capstone', 'THEAT-UH 4001', 'Capstone Project A'), one('cap2', 'Capstone', 'THEAT-UH 4002', 'Capstone Project B'),
])], source='NYUAD Theater major "Courses" page (the Bulletin page has no requirements table)'))

# ---------- Art History minor ----------
ARTH_MINOR = {
    'id': 'arth', 'name': 'Art History (Minor)', 'match': 'art history',
    'requirements': [
        one('look', 'Requirements', 'ARTH-UH 1010', 'Ways of Looking'),
        one('make', 'Requirements', 'ARTH-UH 1718', 'Ways of Making', note='Take both required courses before the electives.'),
        R('elec', 'Requirements', 'Art History or Arts Practice/Design elective', count=2, any=[AH_LIST, APD_LIST, C('ARTH-UH 1120X', 'ARTH-UH 2120', 'ARTH-UH 2612', *lst('CADT-UH', '1097'))]),
    ],
}

# ---------- write ----------
P = json.load(open(PROG))
ps = P.pop('major', None) or next(m for m in P['majors'] if m['id'] == 'ps')
ps.update({'id': 'ps', 'match': 'political', 'trackNote': 'The PS major changed this year. 2nd and 3rd years can graduate under either bulletin.',
           'source': 'NYUAD Bulletin + "Political Science Courses — Spring 2027" (J. Jensen, 26 Oct 2026)'})
new = {'_source': P['_source'], 'registrationTerm': P['registrationTerm'], 'graduation': P['graduation'], 'majors': [ps] + M}
for k, v in P.items():
    if k not in new and k != 'majors': new[k] = v
new['_source'] = ('Political Science: NYUAD Bulletin + Jensen Spring 2027 guide. Other majors and the Art History minor: NYUAD Bulletin 2026–27 '
                  '(read 3 Nov 2026), generated by scripts/build_majors.py. Economics minor + Core: NYUAD Bulletin.')
new['minors'] = [m for m in new['minors'] if m['id'] != 'arth'] + [ARTH_MINOR]
json.dump(new, open(PROG, 'w'), indent=1, ensure_ascii=False)
json.dump(dict(sorted(TITLES.items())), open(os.path.join(ROOT, 'scripts', 'majors_courses.json'), 'w'), indent=0, ensure_ascii=False)
print(len(new['majors']), 'majors,', sum(len(t['requirements']) for m in new['majors'] for t in m['tracks']), 'requirements,', len(TITLES), 'course codes')
