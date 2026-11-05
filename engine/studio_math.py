"""Complete analytic bundle for a circuit drawn in the studio.

The studio sends its connectivity translated to the registered-family graph
format (source, switch, diode, inductor, capacitor, resistor, transformer) and
the component values. The topology is recognised from the wiring, not from the
tutorial name, so a converter redrawn by hand gets the same analysis.
"""
from .analysis import steady, number, InputError
from .circuit import recognize
from .curves import operating_curves
from .derivation import derive
from .dynamics import linearize
from .proof import model_proof
import sympy as sp
from .core import step as cstep


def region_steps(topology, D, vin, L, fs, R, n):
    """CCM/DCM/BCM test with K = 2Lf_s/R and the conversion ratio of each region, with substitution."""
    d, Vin, l, f, r, N, K = sp.symbols('D V_in L f_s R n K', positive=True)
    Ke = 2 * l * f / r
    if topology == 'buck':
        kc, mc, md, lc = 1 - d, d, 2 / (1 + sp.sqrt(1 + 4 * K / d**2)), (1 - d) * r / (2 * f)
    elif topology == 'boost':
        kc, mc, md, lc = d * (1 - d)**2, 1 / (1 - d), (1 + sp.sqrt(1 + 4 * d**2 / K)) / 2, d * (1 - d)**2 * r / (2 * f)
    elif topology == 'buck_boost':
        kc, mc, md, lc = (1 - d)**2, d / (1 - d), d / sp.sqrt(K), (1 - d)**2 * r / (2 * f)
    else:  # flyback, L = magnetising inductance referred to the primary, n = N2/N1
        kc, mc, md, lc = (1 - d)**2 / N**2, N * d / (1 - d), d / sp.sqrt(K), (1 - d)**2 * r / (2 * f * N**2)
    k = 2 * L * fs / R
    vals = {d: D, l: L, f: fs, r: R, N: n, K: k, Vin: vin}
    ev = lambda e: float(e.subs(vals))
    kcv, mcv, mdv, lcv = ev(kc), ev(mc), ev(md), ev(lc)
    mode = 'BCM' if abs(k - kcv) <= 1e-9 * max(k, kcv) else ('CCM' if k > kcv else 'DCM')
    m = mcv if mode != 'DCM' else mdv
    sign = -1 if topology == 'buck_boost' else 1
    out = [
        cstep('Αδιάστατη σταθερά φορτίου', 'Συγκρίνει την αυτεπαγωγή με το φορτίο και την περίοδο.', sp.Symbol('K'), Ke, vals, k),
        cstep('Κρίσιμη τιμή K_crit(D)', 'Συνεχής αγωγή όταν K > K_crit, ασυνεχής όταν K < K_crit, οριακή όταν ίσα.', sp.Symbol('K_crit'), kc, vals, kcv),
        cstep('Κρίσιμη αυτεπαγωγή για το D της οδήγησης', 'Ισοδύναμα: CCM όταν L > L_crit.', sp.Symbol('L_crit'), lc, vals, lcv, 'H'),
        cstep('Λόγος μετατροπής σε CCM', 'Από το ισοζύγιο volt-second του πηνίου.', sp.Symbol('M_CCM'), mc, vals, mcv),
        cstep('Λόγος μετατροπής σε DCM (ωμικό φορτίο)', 'Από το ισοζύγιο volt-second με τρίτο διάστημα i_L = 0. Ισχύει μόνο όταν K < K_crit.', sp.Symbol('M_DCM'), md, vals, mdv),
        cstep('Περιοχή που ισχύει τώρα', f'K = {k:.4g} {">" if mode == "CCM" else "<" if mode == "DCM" else "="} K_crit = {kcv:.4g} → {mode}.'
              + (' Η έξοδος είναι αρνητική ως προς τη γείωση.' if sign < 0 else ''),
              sp.Symbol('|V_o|'), (mc if mode != 'DCM' else md) * Vin, vals, m * vin, 'V')]
    return {'mode': mode, 'K': k, 'Kcrit': kcv, 'Lcrit': lcv, 'M_ccm': mcv, 'M_dcm': mdv, 'M': m, 'steps': out}


def studio_math(data):
    circuit = data.get('circuit')
    params = data.get('params') or {}
    if not isinstance(circuit, dict) or not isinstance(params, dict):
        raise InputError('Λείπει το κύκλωμα ή οι τιμές του.')
    notes = []
    try:
        rec = recognize({'circuit': circuit})
    except InputError:
        # an ideal capacitor has no polarity: try the drawing with it reversed
        caps = [c['id'] for c in circuit.get('components', []) if c.get('type') == 'capacitor']
        swap = {f'{c}:p': f'{c}:n' for c in caps} | {f'{c}:n': f'{c}:p' for c in caps}
        flipped = {'components': circuit['components'],
                   'wires': [{'from': swap.get(w.get('from'), w.get('from')), 'to': swap.get(w.get('to'), w.get('to'))} for w in circuit.get('wires', [])]}
        rec = recognize({'circuit': flipped})
        notes.append('Ο πυκνωτής είναι σχεδιασμένος με αντίθετη πολικότητα· για ιδανικό C δεν αλλάζει τίποτα.')
    topology = rec['topology']
    req = {'topology': topology,
           'vin': number(params, 'vin', None),
           'fs': number(params, 'fs', None, high=1e8),
           'L': number(params, 'L', None, low=1e-12, high=100),
           'C': number(params, 'C', None, low=1e-12, high=100),
           'n': number(params, 'n', .5, low=1e-6, high=1e6) if topology == 'flyback' else .5,
           'drive': 'fixed_duty', 'duty_set': number(params, 'D', None, high=.999999),
           'resistance': number(params, 'R', None), 'load': 'resistive'}
    out = {'recognized': rec, 'request': req, 'notes': notes, 'steady': steady(dict(req))}
    out['region'] = region_steps(topology, req['duty_set'], req['vin'], req['L'], req['fs'], req['resistance'], req['n'])
    for key, fn in (('derivation', derive), ('curves', operating_curves), ('linearize', linearize), ('proof', model_proof)):
        try:
            out[key] = fn(dict(req))
        except (InputError, ValueError, ZeroDivisionError, OverflowError) as exc:
            out[key] = {'error': str(exc) or 'Δεν υπολογίστηκε.'}
    return out
