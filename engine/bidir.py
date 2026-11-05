"""Bidirectional synchronous half-bridge converter between a DC bus and storage.

One inductor on the LOW-voltage side, a half-bridge (S1 upper, S2 lower) on
the HIGH-voltage side.

  position 'above' : V_st > V_bus  -> low side = bus,     high side = storage
  position 'below' : V_st < V_bus  -> low side = storage, high side = bus

Conventions (kept identical everywhere, including the simulator and the
PLECS guide):
  D      duty ratio of the LOWER switch S2 (S1 gets 1-D, complementary).
  i_L    positive from the low-side port into the half-bridge midpoint
         (i.e. positive = power flowing low -> high, the boost direction).
  P_bus  positive = power delivered to the bus = storage discharging
         (sign convention of Table 2 of the assignment).
Ideal elements, efficiency 1, CCM (synchronous switches conduct both ways).
"""
import math
import sympy as sp
from .core import InputError, number, math_record, step, note, equation, held, n

VB, VS, VLO, VHI, D, P, IL, DI, L, FS, R, TS = sp.symbols(
    'V_bus V_st V_lo V_hi D P I_L Δi_L L f_s r T_s', positive=True)
ILR = sp.Symbol('I_L', real=True)
VL_AVG, DELTA, ISRC, PSRC, PLOAD, RSRC, VSRC, C, ESR = sp.symbols(
    'v_L_avg delta I_src P_src P_load R_src V_src C_bus ESR', real=True)

DEFAULTS = {
    'position': 'above', 'vbus_nom': 50.0, 'vbus_min': 49.0, 'vbus_max': 51.0,
    'vst_min': 60.0, 'vst_mid': 80.0, 'vst_max': 100.0,
    'p_nom': 40e3, 'p_over': 60e3, 't_over': 0.5, 'fs': 20e3, 'L': 5.6e-6,
    'ripple_ratio': 0.30, 'C_bus': 0.1, 'ESR': 0.2e-3, 'R_src': 1e-3, 'V_src': 50.0,
    'load_min': 30e3, 'load_max': 60e3, 'fc_ratio': 0.05, 'pm_deg': 60.0,
    # Load cycle (t [s], P [kW]); from the student's notes, average 38.75 kW.
    # Vertical steps are repeated times. Check against the general assignment.
    'profile': [[0, 30], [10, 30], [10, 60], [30, 60], [30, 30], [60, 30],
                [90, 60], [90, 30], [120, 30]],
}
BELOW_EXAMPLE = {'vst_min': 25.0, 'vst_mid': 32.5, 'vst_max': 40.0}   # μπαταρία 25–40 V
E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]


def config(data):
    data = data or {}
    pos = data.get('position', DEFAULTS['position'])
    if pos not in ('above', 'below'):
        raise InputError('position: «above» ή «below».')
    base = {**DEFAULTS, **(BELOW_EXAMPLE if pos == 'below' and 'vst_min' not in data else {})}
    c = {'position': pos}
    for key in ('vbus_nom', 'vbus_min', 'vbus_max', 'vst_min', 'vst_mid', 'vst_max', 'V_src'):
        c[key] = number(data, key, base[key], low=0, high=1000)
    for key in ('p_nom', 'p_over'):
        c[key] = number(data, key, base[key], low=0, high=1e7)
    c['t_over'] = number(data, 't_over', base['t_over'], low=0, high=1e4)
    c['fs'] = number(data, 'fs', base['fs'], low=1, high=1e7)
    c['L'] = number(data, 'L', base['L'], low=1e-12, high=10)
    c['ripple_ratio'] = number(data, 'ripple_ratio', base['ripple_ratio'], low=0, high=2)
    c['C_bus'] = number(data, 'C_bus', base['C_bus'], low=0, high=100)
    c['ESR'] = number(data, 'ESR', base['ESR'], low=0, high=10, strict_low=False)
    c['R_src'] = number(data, 'R_src', base['R_src'], low=0, high=10)
    c['load_min'] = number(data, 'load_min', base['load_min'], low=0, high=1e7, strict_low=False)
    c['load_max'] = number(data, 'load_max', base['load_max'], low=0, high=1e7)
    c['fc_ratio'] = number(data, 'fc_ratio', base['fc_ratio'], low=0, high=0.3)
    c['pm_deg'] = number(data, 'pm_deg', base['pm_deg'], low=10, high=85)
    if not c['vbus_min'] <= c['vbus_nom'] <= c['vbus_max']:
        raise InputError('Απαιτείται Vbus,min ≤ Vbus,nom ≤ Vbus,max.')
    if not c['vst_min'] < c['vst_mid'] < c['vst_max']:
        raise InputError('Απαιτείται Vst,min < Vst,mid < Vst,max.')
    if c['vst_min'] < 10 or c['vst_max'] > 100:
        raise InputError('Η εκφώνηση επιτρέπει παράθυρο αποθήκευσης εντός 10–100 V.')
    if pos == 'above' and c['vst_min'] <= c['vbus_max']:
        raise InputError(f"Για αποθήκευση «πάνω από τον ζυγό» όλο το παράθυρο πρέπει να είναι > {c['vbus_max']:g} V. Αλλιώς η ίδια διάταξη θα χρειαζόταν και buck και boost προς την ίδια κατεύθυνση.")
    if pos == 'below' and c['vst_max'] >= c['vbus_min']:
        raise InputError(f"Για αποθήκευση «κάτω από τον ζυγό» όλο το παράθυρο πρέπει να είναι < {c['vbus_min']:g} V.")
    if c['p_over'] < c['p_nom']:
        raise InputError('Η ισχύς υπερφόρτισης πρέπει να είναι ≥ της ονομαστικής.')
    prof = data.get('profile', base['profile'])
    if not isinstance(prof, list) or len(prof) < 2 or len(prof) > 200:
        raise InputError('Μη έγκυρο προφίλ φορτίου.')
    pts = []
    for p in prof:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise InputError('Κάθε σημείο του προφίλ: [t (s), P (kW)].')
        t, pk = float(p[0]), float(p[1])
        if not (math.isfinite(t) and math.isfinite(pk)) or pk < 0:
            raise InputError('Μη έγκυρη τιμή στο προφίλ φορτίου.')
        if pts and t < pts[-1][0]:
            raise InputError('Οι χρόνοι του προφίλ πρέπει να είναι αύξοντες.')
        pts.append([t, pk])
    if pts[0][0] != 0 or pts[-1][0] <= 0:
        raise InputError('Το προφίλ ξεκινά από t = 0 και τελειώνει στο τέλος του κύκλου.')
    c['profile'] = pts
    return c


# ---------------------------------------------------------------- basics
def above(c):
    return c['position'] == 'above'


def sides(c, vbus, vst):
    return (vbus, vst) if above(c) else (vst, vbus)


def il_from_pbus(c, p_bus, vbus, vst):
    """Signed average inductor current for a bus-port power (ideal, η = 1)."""
    return -p_bus / vbus if above(c) else p_bus / vst


def mode(c, p_bus):
    discharge = p_bus > 0
    if above(c):
        return {'name': 'Buck' if discharge else 'Boost', 'active': 'S1' if discharge else 'S2',
                'rectifier': 'S2' if discharge else 'S1',
                'direction': 'αποθήκευση → ζυγός (εκφόρτιση)' if discharge else 'ζυγός → αποθήκευση (φόρτιση)'}
    return {'name': 'Boost' if discharge else 'Buck', 'active': 'S2' if discharge else 'S1',
            'rectifier': 'S1' if discharge else 'S2',
            'direction': 'αποθήκευση → ζυγός (εκφόρτιση)' if discharge else 'ζυγός → αποθήκευση (φόρτιση)'}


def op(c, vbus, vst, p_bus, L=None):
    """Complete ideal CCM operating point."""
    L = c['L'] if L is None else L
    vlo, vhi = sides(c, vbus, vst)
    d = 1 - vlo / vhi
    i = il_from_pbus(c, p_bus, vbus, vst)
    di = vlo * d / (L * c['fs'])
    rms = math.sqrt(i * i + di * di / 12)
    m = mode(c, p_bus)
    return {'vbus': vbus, 'vst': vst, 'p_bus': p_bus, 'vlo': vlo, 'vhi': vhi, 'D': d, 'D_S1': 1 - d,
            'IL': i, 'dI': di, 'imin': i - di / 2, 'imax': i + di / 2, 'ipk_abs': abs(i) + di / 2,
            'ratio': di / abs(i) if i else float('inf'), 'IL_rms': rms,
            'IS2_avg': d * i, 'IS1_avg': (1 - d) * i, 'IS2_rms': math.sqrt(d) * rms, 'IS1_rms': math.sqrt(1 - d) * rms,
            'I_bus': p_bus / vbus, 'I_st': p_bus / vst, 'vL_S2': vlo, 'vL_S1': vlo - vhi,
            'v_block': vhi, 'mode': m['name'], 'active': m['active'], 'rectifier': m['rectifier'],
            'direction': m['direction'],
            'iL0_symmetric': i, 'iL0_S2_first': i - di / 2, 'iL0_S1_first': i + di / 2}


def vst_points(c):
    return [('min', c['vst_min']), ('mid', c['vst_mid']), ('max', c['vst_max'])]


def labels(c):
    lo, hi = ('V_bus', 'V_st') if above(c) else ('V_st', 'V_bus')
    return {'lo': lo, 'hi': hi, 'lo_name': 'ζυγός' if above(c) else 'αποθήκευση',
            'hi_name': 'αποθήκευση' if above(c) else 'ζυγός'}


def maximize_on_window(expr, var, lo, hi):
    """Maximum of a smooth f(var) on [lo, hi]: endpoints + stationary points."""
    f = sp.lambdify(var, expr, 'math')
    cands = [(lo, 'άκρο'), (hi, 'άκρο')]
    deriv = sp.factor(sp.diff(expr, var))
    for root in sp.solve(sp.Eq(sp.numer(sp.together(deriv)), 0), var):
        val = complex(root.evalf())
        if abs(val.imag) < 1e-9 and lo < val.real < hi:
            cands.append((val.real, 'στάσιμο σημείο'))
    best = max(cands, key=lambda x: f(x[0]))
    return {'arg': best[0], 'kind': best[1], 'value': f(best[0]), 'derivative': deriv,
            'candidates': [{'x': x, 'kind': k, 'f': f(x)} for x, k in cands]}


# ---------------------------------------------------------------- Q2
def load_average(profile, steps_out):
    T = profile[-1][0]
    terms, total = [], 0.0
    for (t0, p0), (t1, p1) in zip(profile, profile[1:]):
        dt = t1 - t0
        if dt <= 0:
            continue
        area = (p0 + p1) / 2 * dt
        total += area
        if abs(p0 - p1) < 1e-12:
            terms.append(sp.Mul(n(p0), n(dt), evaluate=False))
        else:
            terms.append(sp.Mul(sp.Mul(sp.Add(n(p0), n(p1), evaluate=False), sp.Pow(sp.Integer(2), -1, evaluate=False), evaluate=False), n(dt), evaluate=False))
    avg = total / T
    pbar = sp.Symbol('Pbar_load')
    t = sp.Symbol('t')
    steps_out.append({'title': 'Μέση ισχύς φορτίου στον κύκλο',
                      'explanation': f'Ορισμός μέσης τιμής στον κύκλο T = {T:g} s. Το προφίλ είναι τμηματικά γραμμικό, άρα κάθε τμήμα δίνει εμβαδόν τραπεζίου (P_a + P_b)/2·Δt· για σταθερό τμήμα απλώς P·Δt.',
                      'math': equation(pbar, sp.Integral(sp.Function('P_load')(t), (t, 0, sp.Symbol('T'))) / sp.Symbol('T')),
                      'numeric': equation(pbar, sp.Mul(sp.Pow(n(T), -1, evaluate=False), sp.Add(*terms, evaluate=False), evaluate=False)),
                      'result': equation(pbar, n(avg)), 'value': avg, 'unit': 'kW'})
    return avg, total


def q2(c):
    steps = []
    avg, energy = load_average(c['profile'], steps)
    lab = labels(c)
    steps.append(note('Παράθυρο τάσης αποθήκευσης',
                      f"Επιλογή: Vst,min = {c['vst_min']:g} V, Vst,mid = {c['vst_mid']:g} V, Vst,max = {c['vst_max']:g} V, "
                      f"{'πάνω' if above(c) else 'κάτω'} από τον ζυγό {c['vbus_min']:g}–{c['vbus_max']:g} V. "
                      f"Άρα το πηνίο μπαίνει στην πλευρά χαμηλής τάσης ({lab['lo_name']}) και ο half-bridge στην πλευρά υψηλής ({lab['hi_name']})."))
    steps.append(step('Ρεύμα θύρας ζυγού', 'Ιδανικός μετατροπέας, η = 1: η ισχύς στη θύρα του ζυγού είναι ίδια με της αποθήκευσης.',
                      sp.Symbol('I_bus'), P / VB, {P: c['p_nom'], VB: c['vbus_nom']}, c['p_nom'] / c['vbus_nom'], 'A'))
    steps.append(step('Ρεύμα θύρας αποθήκευσης', 'Το ίδιο P στην άλλη θύρα· μεγαλύτερο ρεύμα στη χαμηλότερη τάση.',
                      sp.Symbol('I_st'), P / VS, {P: c['p_nom'], VS: c['vst_min']}, c['p_nom'] / c['vst_min'], 'A'))
    rows = []
    for p, pname in ((c['p_nom'], 'ονομαστική'), (c['p_over'], 'υπερφόρτιση')):
        for sign in (+1, -1):
            m = mode(c, sign * p)
            row = {'P_kW': sign * p / 1e3, 'which': pname, 'mode': m['name'], 'direction': m['direction'],
                   'bus': [{'V': v, 'I': p / v} for v in (c['vbus_min'], c['vbus_nom'], c['vbus_max'])],
                   'st': [{'V': v, 'I': p / v} for _, v in vst_points(c)]}
            rows.append(row)
    return {'steps': steps, 'load_avg_kW': avg, 'energy_kJ': energy, 'ports': rows}


# ---------------------------------------------------------------- Q3
def grid(c, powers, vbus_list=None):
    vbus_list = vbus_list or (c['vbus_min'], c['vbus_nom'], c['vbus_max'])
    return [op(c, vb, vs, s * p) for vb in vbus_list for _, vs in vst_points(c) for p in powers for s in (1, -1)]


def worst(points, key, absval=True):
    f = (lambda p: abs(p[key])) if absval else (lambda p: p[key])
    return max(points, key=f)


def q3(c):
    lab = labels(c)
    steps = []
    vlo_s, vhi_s = (VB, VS) if above(c) else (VS, VB)
    steps.append(note('Διάταξη', f"Συγχρονισμένος αμφίδρομος half-bridge: ένα πηνίο L στην πλευρά {lab['lo_name']} ({lab['lo']}), "
                      f"S1 (πάνω) και S2 (κάτω) με αντιπαράλληλες διόδους στην πλευρά {lab['hi_name']} ({lab['hi']}). "
                      "Οι S1, S2 οδηγούνται συμπληρωματικά, οπότε το ρεύμα του πηνίου μπορεί να είναι θετικό ή αρνητικό χωρίς να μηδενίζεται: "
                      "η λειτουργία είναι πάντα CCM και η ίδια διάταξη κάνει και τις δύο κατευθύνσεις."))
    steps.append(step('S2 ON (0 < t < DT)', 'Το μέσο του κλάδου βραχυκυκλώνεται στην επιστροφή: όλη η τάση της χαμηλής πλευράς πέφτει στο πηνίο.',
                      sp.Symbol('v_L,S2'), vlo_s))
    steps.append(step('S1 ON (DT < t < T)', 'Το μέσο του κλάδου συνδέεται στην υψηλή πλευρά.',
                      sp.Symbol('v_L,S1'), vlo_s - vhi_s))
    steps.append(step('Ισορροπία volt-seconds', 'Στη μόνιμη κατάσταση η μέση τάση του πηνίου είναι μηδέν.',
                      VL_AVG, D * vlo_s + (1 - D) * (vlo_s - vhi_s)))
    steps.append(step('Σχέση μόνιμης κατάστασης', 'Λύση της ⟨v_L⟩ = 0 ως προς D (duty του κάτω διακόπτη S2).',
                      sp.Symbol('D_0'), 1 - vlo_s / vhi_s))
    steps.append(step('Λόγος μετατροπής', 'Ισοδύναμα: η υψηλή πλευρά είναι η χαμηλή διαιρεμένη με 1 − D, σε οποιαδήποτε φορά ισχύος.',
                      vhi_s / vlo_s, 1 / (1 - D)))
    modes = [mode(c, +1), mode(c, -1)]
    steps.append(note('Λειτουργίες', f"Εκφόρτιση (P_bus > 0): {modes[0]['name']}, ενεργός διακόπτης {modes[0]['active']}, "
                      f"ο {modes[0]['rectifier']} λειτουργεί ως σύγχρονος ανορθωτής (θέση διόδου). "
                      f"Φόρτιση (P_bus < 0): {modes[1]['name']}, ενεργός {modes[1]['active']}, ανορθωτής {modes[1]['rectifier']}. "
                      "Το ίδιο D₀ ισχύει και στις δύο: το πρόσημο του i_L, όχι το D₀, καθορίζει τη φορά της ισχύος."))
    pts = grid(c, (c['p_nom'], c['p_over']))
    nom = [p for p in pts if abs(abs(p['p_bus']) - c['p_nom']) < 1e-6]
    stresses = []

    def add(name, key, unit, formula_lhs, formula_rhs, src, values_fn, note_text=''):
        for group, gname in ((nom, 'ονομαστική'), (pts, 'με υπερφόρτιση')):
            w = worst(group, key)
            stresses.append({'name': name, 'which': gname, 'value': abs(w[key]), 'unit': unit,
                             'at': f"Vbus = {w['vbus']:g} V, Vst = {w['vst']:g} V, |P| = {abs(w['p_bus'])/1e3:g} kW"})
        w = worst(pts, key)
        steps.append(step(name, note_text or src, formula_lhs, formula_rhs, values_fn(w), abs(w[key]), unit))

    add('Τάση αποκοπής S1, S2', 'v_block', 'V', sp.Symbol('V_S,max'), vhi_s,
        'Ο ανοικτός διακόπτης βλέπει όλη την τάση της υψηλής πλευράς.', lambda w: {vhi_s: w['vhi']})
    stresses.append({'name': 'Μέγιστη |v_L|', 'which': 'όλο το εύρος',
                     'value': max(max(p['vlo'], p['vhi'] - p['vlo']) for p in pts), 'unit': 'V', 'at': 'max(V_lo, V_hi − V_lo)'})
    add('Μέσο ρεύμα πηνίου (= μέγιστο, Δi ≈ 0)', 'IL', 'A', sp.Abs(ILR), P / vlo_s,
        'Με Δi_L ≈ 0 το ρεύμα είναι σταθερό: μέσο = μέγιστο = ρεύμα θύρας της χαμηλής πλευράς. Χειρότερο στη χαμηλότερη τάση της χαμηλής πλευράς.',
        lambda w: {P: abs(w['p_bus']), vlo_s: w['vlo']})
    add('Μέσο ρεύμα S2', 'IS2_avg', 'A', sp.Symbol('I_S2,avg'), D * P / vlo_s,
        'Ο S2 άγει το i_L για χρόνο DT.', lambda w: {D: w['D'], P: abs(w['p_bus']), vlo_s: w['vlo']})
    add('Μέσο ρεύμα S1', 'IS1_avg', 'A', sp.Symbol('I_S1,avg'), (1 - D) * P / vlo_s,
        'Ο S1 άγει το i_L για χρόνο (1 − D)T. Ισούται με το μέσο ρεύμα της υψηλής πλευράς P/V_hi.',
        lambda w: {D: w['D'], P: abs(w['p_bus']), vlo_s: w['vlo']})
    add('RMS ρεύμα S2', 'IS2_rms', 'A', sp.Symbol('I_S2,rms'), sp.sqrt(D) * P / vlo_s,
        'RMS παλμού πλάτους |I_L| και διάρκειας D.', lambda w: {D: w['D'], P: abs(w['p_bus']), vlo_s: w['vlo']})
    add('RMS ρεύμα S1', 'IS1_rms', 'A', sp.Symbol('I_S1,rms'), sp.sqrt(1 - D) * P / vlo_s,
        'RMS παλμού πλάτους |I_L| και διάρκειας 1 − D.', lambda w: {D: w['D'], P: abs(w['p_bus']), vlo_s: w['vlo']})
    add('Ρεύμα θύρας ζυγού', 'I_bus', 'A', sp.Symbol('I_bus'), P / VB, 'P/V_bus, χειρότερο στα 49 V.',
        lambda w: {P: abs(w['p_bus']), VB: w['vbus']})
    add('Ρεύμα θύρας αποθήκευσης', 'I_st', 'A', sp.Symbol('I_st'), P / VS, 'P/V_st, χειρότερο στη μικρότερη τάση αποθήκευσης.',
        lambda w: {P: abs(w['p_bus']), VS: w['vst']})
    steps.append(note('Παρατήρηση για την υψηλή πλευρά',
                      'Το ρεύμα που μπαίνει στην υψηλή πλευρά είναι παλμικό (0 ή |i_L|): η θύρα αυτή χρειάζεται πυκνωτή ή η πηγή που τη μοντελοποιεί πρέπει να δέχεται παλμικό ρεύμα. '
                      'Στο PLECS η ιδανική πηγή τάσης το δέχεται χωρίς πρόβλημα.'))
    return {'steps': steps, 'stresses': stresses, 'modes': modes}


# ---------------------------------------------------------------- Q4
def q4(c):
    steps, lab = [], labels(c)
    vlo_s, vhi_s = (VB, VS) if above(c) else (VS, VB)
    vb, r, fs, Lsel = c['vbus_nom'], c['ripple_ratio'], c['fs'], c['L']
    duty_rows = [{'which': k, 'vst': v, **{x: op(c, vb, v, c['p_nom'])[x] for x in ('D', 'D_S1')}} for k, v in vst_points(c)]
    corners = [op(c, b, s, c['p_nom']) for b in (c['vbus_min'], c['vbus_max']) for s in (c['vst_min'], c['vst_max'])]
    steps.append(step('Σχέση μόνιμης κατάστασης (ονομαστική τάση ζυγού)', 'Από την ισορροπία volt-seconds του ερωτήματος 3.',
                      sp.Symbol('D_0'), 1 - vlo_s / vhi_s, {VB: vb, VS: c['vst_min']}, duty_rows[0]['D']))
    steps.append(note('Εύρος duty', f"Με V_bus = 50 V: D₀ από {min(r_['D'] for r_ in duty_rows):.4f} έως {max(r_['D'] for r_ in duty_rows):.4f}. "
                      f"Αν αφήσεις και τον ζυγό 49–51 V: D₀ από {min(p['D'] for p in corners):.4f} έως {max(p['D'] for p in corners):.4f}."))
    il_rows = []
    for k, v in vst_points(c):
        for sign in (+1, -1):
            o = op(c, vb, v, sign * c['p_nom'])
            il_rows.append({'which': k, 'vst': v, 'P_kW': sign * c['p_nom'] / 1e3, 'IL': o['IL'], 'mode': o['mode']})
    steps.append(step('Μέσο ρεύμα πηνίου', f"Το πηνίο είναι σε σειρά με τη θύρα χαμηλής τάσης ({lab['lo']}), άρα το μέσο του ρεύμα είναι το ρεύμα αυτής της θύρας. "
                      "Πρόσημο: θετικό χαμηλή → υψηλή πλευρά."
                      + (' Εδώ η χαμηλή πλευρά είναι ο ζυγός στα 50 V, οπότε |I_L| = P/50 ανεξάρτητα από το V_st.' if above(c) else ' Εδώ η χαμηλή πλευρά είναι η αποθήκευση, οπότε |I_L| = P/V_st αλλάζει με την τάση αποθήκευσης.'),
                      sp.Abs(ILR), P / vlo_s, {P: c['p_nom'], vlo_s: vb if above(c) else c['vst_min']},
                      c['p_nom'] / (vb if above(c) else c['vst_min']), 'A'))
    steps.append(step('Κυμάτωση από το διάστημα S2', 'v_L = V_lo σταθερή για χρόνο DT = D/f_s: η κλίση είναι V_lo/L.', DI, vlo_s * D / (L * FS)))
    steps.append(step('Ίδια κυμάτωση από το διάστημα S1', 'Έλεγχος: στο D = D₀ η πτώση στο S1 είναι ίση με την άνοδο στο S2.', DI, (vhi_s - vlo_s) * (1 - D) / (L * FS)))
    di_expr = sp.simplify((vlo_s * (1 - vlo_s / vhi_s) / (L * FS)))
    steps.append(step('Κυμάτωση συναρτήσει των τάσεων', 'Αντικατάσταση D₀ = 1 − V_lo/V_hi.', DI, di_expr))
    # Requirement Δi ≤ r |I_L| at 40 kW, for every operating point of the window.
    var = VS
    il_abs = P / vlo_s
    Lreq_expr = sp.simplify((vlo_s * (1 - vlo_s / vhi_s) / FS) / (R * il_abs))
    Lreq_num = Lreq_expr.subs({VB: vb, FS: fs, R: r, P: c['p_nom']})
    mx = maximize_on_window(Lreq_num, var, c['vst_min'], c['vst_max'])
    steps.append(step('Απαίτηση αυτεπαγωγής', f"Δi_L,pp ≤ r·|I_L,avg| με r = {r:g} στα {c['p_nom']/1e3:g} kW. Λύνουμε ως προς L για κάθε σημείο λειτουργίας. Ίδια απαίτηση και στις δύο φορές (ίδιο |I_L|).",
                      sp.Symbol('L_req'), Lreq_expr))
    steps.append(step('Πού χρειάζεται το μεγαλύτερο L;', 'Μηδενίζουμε την παράγωγο ως προς V_st και ελέγχουμε και τα άκρα του παραθύρου.',
                      sp.Derivative(sp.Symbol('L_req'), VS), mx['derivative']))
    Lmin = mx['value']
    steps.append(step('Ελάχιστη αυτεπαγωγή', f"Μέγιστο στο V_st = {mx['arg']:.4g} V ({mx['kind']}).",
                      sp.Symbol('L_min'), Lreq_expr, {VB: vb, VS: mx['arg'], FS: fs, R: r, P: c['p_nom']}, Lmin, 'H'))
    std = None
    for dec in (1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3):
        for e in E12:
            if e * dec >= Lmin * (1 - 1e-12):
                std = e * dec
                break
        if std:
            break
    di_num = di_expr.subs({VB: vb, L: Lsel, FS: fs})
    dmx = maximize_on_window(di_num, VS, c['vst_min'], c['vst_max'])
    rel_expr = sp.simplify(di_num / (c['p_nom'] / vlo_s.subs(VB, vb)))
    rmx = maximize_on_window(rel_expr, VS, c['vst_min'], c['vst_max'])
    ok = Lsel >= Lmin * (1 - 1e-9)
    steps.append(note('Επιλογή L', f"L_min = {Lmin*1e6:.4g} μH· επόμενη τυποποιημένη τιμή E12: {std*1e6:.3g} μH. "
                      f"Επιλεγμένο L = {Lsel*1e6:.4g} μH → {'ικανοποιεί' if ok else 'ΔΕΝ ικανοποιεί'} την απαίτηση."))
    steps.append(step('Σημείο μέγιστης απόλυτης κυμάτωσης', 'Με το επιλεγμένο L. Παράγωγος ως προς V_st και άκρα.' +
                      (' Για τη θέση «πάνω» η Δi αυξάνει μονότονα με το V_st, άρα μέγιστο στο Vst,max. Αν αφήσεις και το V_bus να κινείται, ∂Δi/∂V_bus = 0 στο V_bus = V_st/2: στα 100 V αυτό είναι ακριβώς τα 50 V.' if above(c)
                       else ' Για τη θέση «κάτω» η Δi = V_st(1 − V_st/V_bus)/(L f_s) έχει μέγιστο στο V_st = V_bus/2.'),
                      sp.Symbol('Δi_L,max'), di_expr, {VB: vb, VS: dmx['arg'], L: Lsel, FS: fs}, dmx['value'], 'A'))
    steps.append(step('Σημείο μέγιστης σχετικής κυμάτωσης (40 kW)', 'Δi/|I_L|: εδώ ελέγχεται ο περιορισμός του 30 %.',
                      sp.Symbol('(Δi_L/|I_L|)_max'), sp.simplify(di_expr / il_abs),
                      {VB: vb, VS: rmx['arg'], L: Lsel, FS: fs, P: c['p_nom']}, rmx['value']))
    table = []
    for k, v in vst_points(c):
        for p in (c['p_nom'], c['p_over']):
            for sign in (+1, -1):
                o = op(c, vb, v, sign * p)
                table.append({'which': k, **{x: o[x] for x in ('vst', 'p_bus', 'mode', 'D', 'IL', 'dI', 'imin', 'imax', 'ipk_abs', 'ratio', 'IL_rms', 'IS1_rms', 'IS2_rms', 'v_block')}})
    # stresses including ripple, V_bus nominal, search continuous window too
    def peak_over(p):
        m = maximize_on_window((p / vlo_s + di_expr / 2).subs({VB: vb, L: Lsel, FS: fs}), VS, c['vst_min'], c['vst_max'])
        return m
    pk40, pk60 = peak_over(c['p_nom']), peak_over(c['p_over'])
    for pk, p, name in ((pk40, c['p_nom'], 'ονομαστική'), (pk60, c['p_over'], 'υπερφόρτιση')):
        steps.append(step(f'Μέγιστο ρεύμα πηνίου και διακοπτών με κυμάτωση ({name})',
                          'Το μέγιστο στιγμιαίο ρεύμα είναι |I_L| + Δi_L/2· το ίδιο φέρουν οι S1, S2 στη μετάβαση.',
                          sp.Symbol('I_L,peak'), P / vlo_s + di_expr / 2, {P: p, VB: vb, VS: pk['arg'], L: Lsel, FS: fs}, pk['value'], 'A'))
    w = max(table, key=lambda x: x['IL_rms'])
    steps.append(step('RMS ρεύμα πηνίου με κυμάτωση', 'Τριγωνική κυμάτωση γύρω από το μέσο: I_rms² = I² + Δi²/12.',
                      sp.Symbol('I_L,rms'), sp.sqrt(IL ** 2 + DI ** 2 / 12), {IL: abs(w['IL']), DI: w['dI']}, w['IL_rms'], 'A'))
    steps.append(note('Τάσεις αποκοπής', f"Δεν αλλάζουν με την κυμάτωση στο ιδανικό μοντέλο: V_S,max = {max(t['v_block'] for t in table):g} V (υψηλή πλευρά). "
                      'Σε πραγματικό κύκλωμα προστίθενται υπερτάσεις από παρασιτικές αυτεπαγωγές.'))
    steps.append(note('Υπερφόρτιση 60 kW', f"Το Δi_L δεν εξαρτάται από την ισχύ (μόνο από τάσεις, L, f_s), άρα στην υπερφόρτιση μεγαλώνει μόνο το μέσο ρεύμα. "
                      f"Ο λόγος Δi/|I| γίνεται μικρότερος, η CCM διατηρείται."))
    return {'steps': steps, 'duty': duty_rows, 'duty_range_bus': [min(p['D'] for p in corners), max(p['D'] for p in corners)],
            'il': il_rows, 'L_min': Lmin, 'L_std': std, 'L': Lsel, 'L_ok': ok, 'Lreq_candidates': mx['candidates'],
            'ripple_max': {'vst': dmx['arg'], 'dI': dmx['value'], 'kind': dmx['kind']},
            'relative_max': {'vst': rmx['arg'], 'ratio': rmx['value'], 'kind': rmx['kind']},
            'peak': {'nom': {'vst': pk40['arg'], 'I': pk40['value']}, 'over': {'vst': pk60['arg'], 'I': pk60['value']}},
            'table': table}


# ---------------------------------------------------------------- Q5
def q5(c, q4r):
    vb, P0 = c['vbus_nom'], c['p_nom']
    spec = [('Α', c['vst_min'], +P0, 'ελάχιστη, εκφόρτιση'), ('Β', c['vst_max'], +P0, 'μέγιστη, εκφόρτιση'),
            ('Γ', c['vst_mid'], +P0, 'ενδιάμεση, εκφόρτιση'), ('Δ', c['vst_min'], -P0, 'ελάχιστη, φόρτιση'),
            ('Ε', c['vst_max'], -P0, 'μέγιστη, φόρτιση'), ('ΣΤ', c['vst_mid'], -P0, 'ενδιάμεση, φόρτιση')]
    tests = []
    for name, vst, p, txt in spec:
        tests.append({'id': name, 'desc': txt, 'covered_by': None, **op(c, vb, vst, p)})
    for name, point, txt in (('Ζ', q4r['ripple_max']['vst'], 'μέγιστη απόλυτη κυμάτωση'), ('Η', q4r['relative_max']['vst'], 'μέγιστη σχετική κυμάτωση στα 40 kW')):
        same = [t['id'] for t in tests[:6] if abs(t['vst'] - point) < 1e-6 * max(1, point)]
        tests.append({'id': name, 'desc': txt, 'covered_by': same or None, **op(c, vb, point, +P0)})
    steps = [
        step('Duty στη δοκιμή', 'Σταθερό σε κάθε πείραμα, από την ισορροπία volt-seconds.', sp.Symbol('D_0'),
             1 - (VB / VS if above(c) else VS / VB)),
        note('Γιατί χρειάζεται αρχικό ρεύμα', 'Με ιδανικές πηγές τάσης και στις δύο θύρες, στο D = D₀ ισχύει ⟨v_L⟩ = 0 για ΟΠΟΙΟΔΗΠΟΤΕ μέσο ρεύμα. '
             'Το D καθορίζει τη μεταβολή του ρεύματος, όχι την τιμή του. Η τιμή «θυμάται» την αρχική συνθήκη: όποιο i_L(0) δώσεις, εκεί μένει ο μέσος όρος. '
             'Γι’ αυτό η εκφώνηση λέει «κατάλληλες αρχικές τιμές ρευμάτων».'),
        step('Αρχικό ρεύμα, συμμετρικός (τριγωνικός) φορέας', 'Αν το t = 0 είναι στο μέσο του διαστήματος S1 (ή S2), το i_L(0) ισούται με τη μέση τιμή: σε γραμμικό τμήμα, η τιμή στο μέσο = μέση τιμή.',
             sp.Symbol('i_L(0)'), IL),
        step('Αρχικό ρεύμα, πριονωτός φορέας με S2 πρώτα ON', 'Στο S2 ON το ρεύμα ανεβαίνει (v_L = V_lo > 0), άρα ξεκινά από το ελάχιστο.',
             sp.Symbol('i_L(0)'), IL - DI / 2),
        step('Αρχικό ρεύμα, πριονωτός φορέας με S1 πρώτα ON', 'Στο S1 ON το ρεύμα κατεβαίνει, άρα ξεκινά από το μέγιστο.',
             sp.Symbol('i_L(0)'), IL + DI / 2),
        step('Μέση ισχύς στη θύρα ζυγού (μέτρηση)', 'Στο PLECS: γινόμενο τάσης–ρεύματος θύρας και μέση τιμή σε ακέραιο αριθμό περιόδων (π.χ. Periodic Average με T = 1/f_s).',
             sp.Symbol('P_bus'), sp.Integral(sp.Symbol('v_bus') * sp.Symbol('i_bus'), (sp.Symbol('t'), 0, TS)) / TS),
    ]
    return {'tests': tests, 'steps': steps}


# ---------------------------------------------------------------- control
def control(c, test=None):
    test = test or op(c, c['vbus_nom'], c['vst_max'] if above(c) else c['vst_min'], c['p_nom'])
    vlo, vhi, Lv, fs = test['vlo'], test['vhi'], c['L'], c['fs']
    i_sym = sp.Symbol('ī_L')
    t = sp.Symbol('t')
    steps = []
    steps.append(step('Μέσο μοντέλο του πηνίου', 'Μέση τιμή ανά περίοδο: v_mid = 0 για DT και V_hi για (1 − D)T.',
                      L * sp.Derivative(i_sym, t), VLO - (1 - D) * VHI))
    steps.append(step('Ιδιοτιμή (Jacobian ως προς το ρεύμα)', 'Το δεξί μέλος δεν εξαρτάται από το ρεύμα όταν και οι δύο θύρες είναι ιδανικές πηγές τάσης. '
                      'Ιδιοτιμή 0: οριακή ευστάθεια, συνεχές από σημεία ισορροπίας. Δεν υπάρχει «επαναφέρουσα» δύναμη προς κάποιο ρεύμα.',
                      sp.Symbol('lambda'), sp.Integer(0)))
    delta = 0.001
    rate = vhi * delta / Lv
    steps.append(step('Ολίσθηση όταν D = D₀ + δ', 'Μικρό σφάλμα duty → σταθερή μέση τάση στο πηνίο → το ρεύμα αλλάζει γραμμικά χωρίς όριο (στο ιδανικό μοντέλο).',
                      sp.Derivative(i_sym, t), VHI * DELTA / L, {VHI: vhi, DELTA: delta, L: Lv}, rate, 'A/s'))
    steps.append(note('Πόσο γρήγορα;', f"Για δ = {delta:g}: {rate/1e3:.4g} A/ms. Το 10 % του |I_L| = {0.1*abs(test['IL']):.4g} A χάνεται σε {0.1*abs(test['IL'])/rate*1e3:.3g} ms. "
                      'Σε πραγματικό κύκλωμα οι απώλειες δίνουν ισορροπία, αλλά πολύ ευαίσθητη: δες το επόμενο βήμα.'))
    rpar = 1e-3
    steps.append(step('Με μικρή σειριακή αντίσταση r', 'Ισορροπία I = (V_lo − (1 − D)V_hi)/r. Η ευαισθησία ως προς το D είναι V_hi/r.',
                      sp.Derivative(sp.Symbol('I'), D), VHI / sp.Symbol('r_s'), {VHI: vhi, sp.Symbol('r_s'): rpar}, vhi / rpar, 'A ανά μονάδα D'))
    steps.append(note('Συμπέρασμα', f"Για να ορίσεις ρεύμα με ακρίβεια 1 A μέσω του D χρειάζεσαι ακρίβεια duty {rpar/vhi:.1e}. Άρα: είτε αρχική συνθήκη "
                      '(ερώτημα 5), είτε έλεγχος ρεύματος (κλειστός βρόχος).'))
    # ΔD transition
    dd = 0.05
    dI = 2 * abs(test['IL'])
    t_tr = Lv * dI / (vhi * dd)
    steps.append(step('Μετάβαση με προσωρινό ΔD (ανοικτός βρόχος)', 'Π.χ. από φόρτιση σε εκφόρτιση: για χρόνο t βάζεις D = D₀ ± ΔD και μετά επιστρέφεις στο D₀. '
                      'Το πρόσημο: +ΔD ανεβάζει το i_L, −ΔD το κατεβάζει.',
                      sp.Symbol('t_tr'), L * sp.Symbol('ΔI') / (VHI * sp.Symbol('ΔD')),
                      {L: Lv, sp.Symbol('ΔI'): dI, VHI: vhi, sp.Symbol('ΔD'): dd}, t_tr, 's'))
    steps.append(note('Περίοδοι', f"{t_tr*fs:.4g} περίοδοι → στρογγυλοποίηση σε ακέραιο, άρα μένει μικρό σφάλμα· γι’ αυτό στην πράξη χρησιμοποιείται κλειστός βρόχος."))
    # PI design
    s = sp.Symbol('s')
    fc = c['fc_ratio'] * fs
    wc = 2 * math.pi * fc
    Td = 1 / fs
    phid = wc * Td
    pm = math.radians(c['pm_deg'])
    zeta_angle = math.pi / 2 - pm - phid
    if zeta_angle <= 0:
        zeta_angle = math.radians(5)
    wz = wc * math.tan(zeta_angle)
    kp = wc * Lv * math.cos(zeta_angle) / vhi
    ki = kp * wz
    steps.append(step('Συνάρτηση μεταφοράς duty → ρεύμα', 'Γραμμικοποίηση του μέσου μοντέλου: ολοκληρωτής.', sp.Function('G_id')(s), VHI / (s * L)))
    steps.append(step('Καθυστέρηση δειγματοληψίας και PWM', 'Μέτρηση στην κορυφή του τριγωνικού φορέα, ενημέρωση μία φορά ανά περίοδο: ενεργός καθυστέρηση ≈ T_s.',
                      sp.Symbol('phi_d'), sp.Symbol('omega_c') * TS, {sp.Symbol('omega_c'): wc, TS: Td}, math.degrees(phid), '°'))
    steps.append(step('Μηδενικό του PI', f"PM = 90° − atan(ω_z/ω_c) − φ_d· στόχος PM = {c['pm_deg']:g}° στη συχνότητα διέλευσης f_c = {fc:g} Hz.",
                      sp.Symbol('omega_z'), sp.Symbol('omega_c') * sp.tan(sp.pi / 2 - sp.Symbol('PM') - sp.Symbol('phi_d')),
                      None, wz, 'rad/s'))
    steps.append(step('Αναλογικό κέρδος', '|C(jω_c) G_id(jω_c)| = 1.', sp.Symbol('K_p'), sp.Symbol('omega_c') * L * sp.cos(sp.Symbol('theta')) / VHI,
                      {sp.Symbol('omega_c'): wc, L: Lv, sp.Symbol('theta'): zeta_angle, VHI: vhi}, kp, '1/A'))
    steps.append(step('Ολοκληρωτικό κέρδος', 'K_i = K_p·ω_z.', sp.Symbol('K_i'), sp.Symbol('K_p') * sp.Symbol('omega_z'),
                      {sp.Symbol('K_p'): kp, sp.Symbol('omega_z'): wz}, ki, '1/(A·s)'))
    steps.append(step('Νόμος ελέγχου (με feedforward)', 'Το D₀ υπολογίζεται από τις μετρούμενες τάσεις. Ο PI διορθώνει μόνο το σφάλμα, άρα δεν «φορτώνεται» ο ολοκληρωτής.',
                      sp.Symbol('d[k]'), sp.Symbol('D_0') + sp.Symbol('K_p') * sp.Symbol('e[k]') + sp.Symbol('K_i') * TS * sp.Sum(sp.Symbol('e[j]'), (sp.Symbol('j'), 0, sp.Symbol('k')))))
    return {'steps': steps, 'point': test, 'pi': {'fc': fc, 'wc': wc, 'wz': wz, 'kp': kp, 'ki': ki, 'Td': Td, 'phi_d_deg': math.degrees(phid),
                                                  'pm_deg': c['pm_deg'], 'vhi': vhi},
            'drift_A_per_s': rate, 'transition': {'dD': dd, 'dI': dI, 't': t_tr, 'periods': t_tr * fs}}


# ---------------------------------------------------------------- load and system
def v_bus_from_source(c, p_src):
    disc = c['V_src'] ** 2 - 4 * c['R_src'] * p_src
    if disc < 0:
        return None
    return (c['V_src'] + math.sqrt(disc)) / 2


def profile_at(profile, t):
    for (t0, p0), (t1, p1) in zip(profile, profile[1:]):
        if t0 <= t <= t1 and t1 > t0:
            return p0 + (p1 - p0) * (t - t0) / (t1 - t0)
    return profile[-1][1]


def system(c, load_avg_kW):
    steps = []
    vmin = c['vbus_min']
    steps.append(step('Ισοζύγιο ισχύος στον ζυγό', 'Ό,τι δεν δίνει ο μετατροπέας το δίνει η κύρια πηγή (P_bus > 0: εκφόρτιση αποθήκευσης).',
                      PSRC, PLOAD - sp.Symbol('P_bus')))
    steps.append(note('Μονόδρομη πηγή', 'Η κύρια πηγή μόνο δίνει ισχύ: P_src ≥ 0 ⇒ P_bus ≤ P_load. Αν ο μετατροπέας δώσει περισσότερο από το φορτίο, η πηγή «κλείνει» '
                      '(σαν δίοδος) και το περίσσευμα φορτίζει τον πυκνωτή του ζυγού: η τάση ανεβαίνει.'))
    steps.append(step('Τάση ζυγού από την πηγή με R_src', 'V_bus = V_src − R_src·I_src και I_src = P_src/V_bus ⇒ δευτεροβάθμια.',
                      VB, (VSRC + sp.sqrt(VSRC ** 2 - 4 * RSRC * PSRC)) / 2))
    pmax = vmin * (c['V_src'] - vmin) / c['R_src']
    steps.append(step('Μέγιστη ισχύς πηγής με V_bus ≥ V_bus,min', 'Θέτουμε V_bus = V_bus,min στην V_bus = V_src − R_src·P_src/V_bus.',
                      sp.Symbol('P_src,max'), sp.Symbol('V_bus,min') * (VSRC - sp.Symbol('V_bus,min')) / RSRC,
                      {sp.Symbol('V_bus,min'): vmin, VSRC: c['V_src'], RSRC: c['R_src']}, pmax, 'W'))
    need = c['load_max'] - pmax
    steps.append(note('Το ζήτημα με το φορτίο', f"Χωρίς αποθήκευση, στα {c['load_max']/1e3:g} kW η τάση του ζυγού πέφτει στα {v_bus_from_source(c, c['load_max']):.3f} V "
                      f"(κάτω από {vmin:g} V). Άρα στο μέγιστο φορτίο η αποθήκευση πρέπει να ΕΚΦΟΡΤΙΖΕΤΑΙ με τουλάχιστον {max(0, need)/1e3:.3g} kW, "
                      f"και δεν επιτρέπεται να φορτίζει. Αντίθετα, σε φορτίο {c['load_min']/1e3:g} kW η εκφόρτιση δεν μπορεί να ξεπεράσει τα {c['load_min']/1e3:g} kW (μονόδρομη πηγή)."))
    dv = 1.0
    excess = 10e3
    t_rise = c['C_bus'] * ((c['vbus_nom'] + dv) ** 2 - c['vbus_nom'] ** 2) / (2 * excess)
    steps.append(step('Πόσο γρήγορα ανεβαίνει ο ζυγός με περίσσευμα', 'Ενέργεια πυκνωτή ½CV²: το περίσσευμα ΔP φορτίζει τον πυκνωτή όταν η πηγή είναι κλειστή.',
                      sp.Symbol('t_rise'), C * (sp.Symbol('V_2') ** 2 - sp.Symbol('V_1') ** 2) / (2 * sp.Symbol('ΔP')),
                      {C: c['C_bus'], sp.Symbol('V_2'): c['vbus_nom'] + dv, sp.Symbol('V_1'): c['vbus_nom'], sp.Symbol('ΔP'): excess}, t_rise, 's'))
    steps.append(note('Συμπέρασμα για τον μετατροπέα', 'Η φορά του ρεύματος του μετατροπέα ΔΕΝ την ορίζει το φορτίο: την ορίζει ο έλεγχος (ή η αρχική συνθήκη). '
                      'Το φορτίο ορίζει μόνο τι θα δώσει η κύρια πηγή. Στο πλήρες σύστημα ο έλεγχος του μετατροπέα πρέπει να σέβεται P_load − P_src,max ≤ P_bus ≤ P_load.'))
    steps.append(note('Για το ερώτημα 5 (PLECS)', 'Η δοκιμή είναι test bench: ιδανική πηγή 50 V στον ζυγό και πηγή τάσης στην αποθήκευση. Δεν χρειάζεται φορτίο· '
                      'τα ±40 kW είναι ισχύς του μετατροπέα στη θύρα του ζυγού, όχι ισχύς φορτίου. Η ιδανική πηγή απορροφά ό,τι περισσεύει.'))
    # time series over the cycle for two strategies
    T = c['profile'][-1][0]
    pbar = load_avg_kW * 1e3
    series = {'t': [], 'P_load': [], 'P_bus_none': [], 'V_none': [], 'P_bus_shave': [], 'V_shave': [], 'E_shave_kJ': []}
    e = 0.0
    N = 480
    prev = None
    for k in range(N + 1):
        t = T * k / N
        pl = profile_at(c['profile'], t) * 1e3
        pb = pl - pbar
        if prev is not None:
            e -= (pb + prev[1]) / 2 * (t - prev[0]) / 1e3
        prev = (t, pb)
        series['t'].append(t)
        series['P_load'].append(pl / 1e3)
        series['P_bus_none'].append(0.0)
        series['V_none'].append(v_bus_from_source(c, pl))
        series['P_bus_shave'].append(pb / 1e3)
        series['V_shave'].append(v_bus_from_source(c, pbar))
        series['E_shave_kJ'].append(e)
    swing = max(series['E_shave_kJ']) - min(series['E_shave_kJ'])
    steps.append(step('Στρατηγική εξομάλυνσης (peak shaving)', 'Η πηγή δίνει σταθερά τη μέση ισχύ του κύκλου· η αποθήκευση καλύπτει τη διαφορά.',
                      sp.Symbol('P_bus(t)'), sp.Function('P_load')(sp.Symbol('t')) - sp.Symbol('Pbar_load')))
    steps.append(note('Αποτέλεσμα εξομάλυνσης', f"P_src = {pbar/1e3:.4g} kW → V_bus = {v_bus_from_source(c, pbar):.4f} V (εντός ορίων). "
                      f"P_bus από {min(series['P_bus_shave']):.4g} έως {max(series['P_bus_shave']):.4g} kW (εντός ±{c['p_nom']/1e3:g} kW). "
                      f"Μεταβολή ενέργειας αποθήκευσης στον κύκλο: {swing:.4g} kJ = {swing/3.6:.4g} Wh."))
    # feasibility map
    fmap = []
    for pl in [c['load_min'] + (c['load_max'] - c['load_min']) * i / 12 for i in range(13)]:
        for pb in [-c['p_over'] + 2 * c['p_over'] * j / 24 for j in range(25)]:
            ps = pl - pb
            if ps < 0:
                status = 'absorb'
                v = None
            else:
                v = v_bus_from_source(c, ps)
                status = 'ok' if v is not None and v >= vmin else 'under'
            fmap.append({'P_load': pl / 1e3, 'P_bus': pb / 1e3, 'status': status, 'V_bus': v})
    vtab = [{'P_src_kW': p / 1e3, 'V_bus': v_bus_from_source(c, p)} for p in (0, c['load_min'], pbar, pmax, c['load_max'], c['load_max'] + c['p_nom'])]
    return {'steps': steps, 'P_src_max': pmax, 'min_discharge_at_max_load': max(0, need), 't_rise_10kW': t_rise,
            'series': series, 'swing_kJ': swing, 'map': fmap, 'vtable': vtab, 'load_avg_kW': load_avg_kW}


def solve(data):
    c = config(data)
    r2 = q2(c)
    r3 = q3(c)
    r4 = q4(c)
    r5 = q5(c, r4)
    rc = control(c)
    rs = system(c, r2['load_avg_kW'])
    return {'config': c, 'labels': labels(c), 'q2': r2, 'q3': r3, 'q4': r4, 'q5': r5, 'control': rc, 'system': rs,
            'assumptions': ['Ιδανικοί ημιαγωγοί και πηνίο, απόδοση 1 (όπως ζητά η εκφώνηση στα 3–5).',
                            'D = duty του κάτω διακόπτη S2· ο S1 με 1 − D (συμπληρωματικά, χωρίς dead time).',
                            'i_L θετικό από τη χαμηλή πλευρά προς το μέσο του half-bridge. P_bus θετική = εκφόρτιση (προς τον ζυγό).',
                            'Ερώτημα 4 με την ονομαστική τάση ζυγού 50 V, όπως ζητά η εκφώνηση.']}
