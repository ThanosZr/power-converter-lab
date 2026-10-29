"""Steady-state ideal converter analysis, exact triangular-wave integrals.

Small-ripple approximation: v_o and load current are held constant within a
switching period. Regulated output is specified, and duty is solved.
"""
import math
import numpy as np
import sympy as sp
from .models import MODELS, symbolic_model, VIN, V, I, D, L, C, R, N, FS, P


class InputError(ValueError):
    pass


def number(data, key, default=None, low=0, high=1e12):
    raw = data.get(key, default)
    if isinstance(raw, bool):
        raise InputError(f"{key}: απαιτείται αριθμός.")
    try:
        value = float(raw)
    except (ValueError, TypeError):
        raise InputError(f"{key}: απαιτείται αριθμός.") from None
    if not math.isfinite(value) or not low < value <= high:
        raise InputError(f"{key}: απαιτείται πεπερασμένη τιμή στο ({low}, {high}].")
    return value


def config(data):
    key = data.get("topology", "buck_boost")
    if key not in MODELS:
        raise InputError("Μη υποστηριζόμενη τοπολογία.")
    load = data.get("load", "resistive")
    if load not in ("resistive", "constant_power"):
        raise InputError("Μη υποστηριζόμενο μοντέλο φορτίου.")
    c = {"topology": key, "vin": number(data, "vin", 8),
            "vo": number(data, "vo", 12), "power": number(data, "power", 24),
            "fs": number(data, "fs", 100000, high=1e8),
            "L": number(data, "L", 20e-6, low=1e-12, high=100),
            "C": number(data, "C", 100e-6, low=1e-12, high=100),
            "n": number(data, "n", 0.5, low=1e-6, high=1e6), "load": load}
    drive=data.get('drive','regulated')
    if drive not in ('regulated','fixed_duty'):
        raise InputError('Μη υποστηριζόμενος τρόπος οδήγησης.')
    c['drive']=drive
    c['duty_set']=number(data,'duty_set',.5,high=.999999)
    c['resistance']=number(data,'resistance',c['vo']**2/c['power'])
    if drive=='fixed_duty':
        c=resolve_fixed_duty(c)
    return c


def resolve_fixed_duty(c):
    """Solve output from duty and a *defined load law*, not a second target.

    Fixed Po in ideal buck-boost/flyback DCM is singular: power transferred is
    independent of Vo. Return an actionable error instead of inventing Vo.
    """
    c=c.copy()
    key,vin,d,ll,fs,n=(c[k] for k in ('topology','vin','duty_set','L','fs','n'))
    vccm=vin*d if key=='buck' else vin/(1-d) if key=='boost' else vin*d/(1-d)*(n if key=='flyback' else 1)
    if c['load']=='resistive':
        r=c['resistance']
        c['vo'],c['power']=vccm,vccm*vccm/r
        _,lc=duty_and_boundary(c)
        if ll<lc*(1-1e-7):
            k=2*ll*fs/r
            if key=='buck':
                vo=vin*2/(1+math.sqrt(1+4*k/(d*d)))
            elif key=='boost':
                vo=vin*(1+math.sqrt(1+4*d*d/k))/2
            else:
                vo=vin*d/math.sqrt(k)
            c['vo'],c['power']=vo,vo*vo/r
    else:
        c['vo']=vccm
        energy=vin*vin*d*d/(2*ll*fs)
        if key in ('buck_boost','flyback') and math.isclose(c['power'],energy,rel_tol=1e-8):
            raise InputError('Σταθερό duty και ιδανικό φορτίο σταθερής ισχύος: Po=Vin²D²/(2Lf). Υπάρχει συνεχές λύσεων BCM/DCM, συνεπώς το Vo δεν προσδιορίζεται μοναδικά. Ορίστε R ή ρυθμιζόμενο Vo.')
        _,lc=duty_and_boundary(c)
        if ll<lc*(1-1e-7):
            if key in ('buck_boost','flyback'):
                raise InputError('Σταθερό duty + φορτίο σταθερής ισχύος σε ιδανικό buck–boost/flyback DCM: Po=Vin²D²/(2Lf) ανεξάρτητα του Vo. Αν οι ισχείς διαφέρουν δεν υπάρχει περιοδική ισορροπία, αν συμπίπτουν το Vo δεν προσδιορίζεται μοναδικά. Ορίστε R ή ρυθμιζόμενο Vo.')
            vo=vin-c['power']*vin/energy if key=='buck' else c['power']*vin/(c['power']-energy) if c['power']>energy else -1
            if vo<=0:
                raise InputError('Το σταθερό duty και το συγκεκριμένο φορτίο σταθερής ισχύος δεν δίνουν θετική περιοδική λύση με αυτές τις παραδοχές.')
            c['vo']=vo
    return c


def math_record(expr):
    return {"text": str(expr), "latex": sp.latex(expr),
            "mathml": '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'
                      + sp.printing.mathml(expr, printer="presentation") + '</math>'}


def duty_and_boundary(c):
    vin, vo, power, fs, n = (c[k] for k in ("vin", "vo", "power", "fs", "n"))
    key, r = c["topology"], vo*vo/power
    if key == "buck":
        if vo >= vin:
            raise InputError("Ο ιδανικός buck απαιτεί 0 < Vo < Vin.")
        d = vo/vin
        lc = r*(1-d)/(2*fs)
    elif key == "boost":
        if vo <= vin:
            raise InputError("Ο ιδανικός boost απαιτεί Vo > Vin > 0.")
        d = 1-vin/vo
        lc = r*d*(1-d)**2/(2*fs)
    else:
        d = vo/((n if key == "flyback" else 1)*vin+vo)
        lc = r*(1-d)**2/(2*fs*(n*n if key == "flyback" else 1))
    return d, lc


def steady(data, include_waveforms=True, include_steps=True):
    c = config(data)
    key, vin, vo, po, fs, ll, cap, n = (c[k] for k in
        ("topology", "vin", "vo", "power", "fs", "L", "C", "n"))
    io, r = po/vo, vo*vo/po
    dccm, lc = duty_and_boundary(c)
    ratio = ll/lc
    mode = "BCM" if abs(ratio-1) <= 1e-7 else ("CCM" if ratio > 1 else "DCM")
    if mode != "DCM":
        duty, delta = dccm, 1-dccm
        mean = io if key == "buck" else io*(n if key == "flyback" else 1)/(1-duty)
        ripple = (vin-vo if key == "buck" else vin)*duty/(ll*fs)
        valley, peak = max(0., mean-ripple/2), mean+ripple/2
    else:
        if key == "buck":
            duty = math.sqrt(2*ll*fs*io*vo/(vin*(vin-vo)))
            delta = (vin-vo)*duty/vo
        elif key == "boost":
            duty = math.sqrt(2*ll*fs*io*(vo-vin))/vin
            delta = vin*duty/(vo-vin)
        else:
            duty = math.sqrt(2*ll*fs*po)/vin
            delta = vin*duty*(n if key == "flyback" else 1)/vo
        valley = 0.
        peak = (vin-vo if key == "buck" else vin)*duty/(ll*fs)
        ripple = peak
    if duty <= 0 or duty >= 1 or duty+delta > 1+1e-8:
        raise InputError("Δεν βρέθηκε φυσικά αποδεκτή ακολουθία αγωγής.")
    idle = max(0., 1-duty-delta)
    # Each segment stores endpoint currents; discontinuities occur at switches.
    segments = []
    def segment(a, b, ia, ib, state):
        if b-a < 1e-12:
            return
        oa = ia if key == "buck" else (ia/n if key == "flyback" and state == "OFF" else ia if state == "OFF" else 0.)
        ob = ib if key == "buck" else (ib/n if key == "flyback" and state == "OFF" else ib if state == "OFF" else 0.)
        sw = state == "ON"
        da, db = (0., 0.) if sw or state == "IDLE" else ((ia/n, ib/n) if key == "flyback" else (ia, ib))
        ina, inb = (ia, ib) if sw or key == "boost" else (0., 0.)
        segments.append({"a": a, "b": b, "state": state,
                         "iL": [ia, ib], "iC": [oa-io, ob-io],
                         "iD": [da, db], "iS": [ia, ib] if sw else [0., 0.],
                         "iin": [ina, inb]})
    segment(0, duty, valley, peak, "ON")
    segment(duty, duty+delta, peak, valley if mode != "DCM" else 0, "OFF")
    segment(duty+delta, 1., 0., 0., "IDLE")
    def integral(signal, squared=False):
        total = 0.
        for seg in segments:
            a, b = seg[signal]
            total += (seg["b"]-seg["a"])*((a*a+a*b+b*b)/3 if squared else (a+b)/2)
        return total
    q, candidates = 0., [0.]
    for seg in segments:
        a, b = seg["iC"]
        dt = (seg["b"]-seg["a"])/fs
        seg["q0"] = q
        if a*b < 0:
            z = -a/(b-a)
            candidates.append(q+dt*(a*z+(b-a)*z*z/2))
        q += dt*(a+b)/2
        candidates.append(q)
    charge_pp = max(candidates)-min(candidates)
    stress_s = vin if key == "buck" else vo if key == "boost" else vin+vo/n if key == "flyback" else vin+vo
    stress_d = vo+n*vin if key == "flyback" else stress_s
    metrics = {"duty": duty, "duty_ccm": dccm, "delta": delta, "idle": idle,
               "Lcrit": lc, "L_margin": ratio, "Iout": io, "R": r,
               "Ivalley": valley, "Ipeak": peak, "Iripple_pp": ripple,
               "ILmean": integral("iL"), "ILrms": math.sqrt(integral("iL", True)),
               "ISrms": math.sqrt(integral("iS", True)), "IDrms": math.sqrt(integral("iD", True)),
               "ICrms": math.sqrt(integral("iC", True)), "IDmean": integral("iD"),
               "Iin": integral("iin"), "Vswitch": stress_s, "Vdiode_reverse": stress_d,
               "Vripple_pp": charge_pp/cap, "charge_pp": charge_pp,
               "signed_output": MODELS[key].polarity*vo,
               "charge_balance_A": integral("iC"),
               "power_balance_W": vin*integral("iin")-po}
    warnings = []
    if metrics["Vripple_pp"] > .05*vo:
        warnings.append("Η εκτιμώμενη κυμάτωση υπερβαίνει 5% του Vo: ελέγξτε τη διακοπτική προσομοίωση· η προσέγγιση μικρής κυμάτωσης εξασθενεί.")
    if duty > .95 or duty < .02:
        warnings.append("Ακραίο duty cycle. Δεν περιλαμβάνονται ελάχιστοι χρόνοι παλμού, dead time ή απώλειες.")
    if c["load"] == "constant_power":
        warnings.append("Φορτίο σταθερής ισχύος: αρνητική διαφορική αντίσταση. Χωρίς κλειστό βρόχο το σημείο λειτουργίας μπορεί να είναι ασταθές.")
    result = {"config": c, "mode": mode, "metrics": metrics,
              "intervals": segments, "warnings": warnings,
              "assumptions": ["Ιδανικά στοιχεία και περιοδική μόνιμη κατάσταση.",
              "Μικρή κυμάτωση τάσης: σταθερό Vo και Io μέσα στην περίοδο.",
              "Ρυθμιζόμενη τάση εξόδου: λύνεται το duty." if c['drive']=='regulated' else "Σταθερό duty: η τάση εξόδου προκύπτει από το φορτίο και την αγωγή.",
              "Για buck–boost χρησιμοποιείται |Vo| και πραγματική πολικότητα −Vo.",
              "Flyback: n=Ns/Np, L=Lm στο πρωτεύον, iL=im αναγμένο στο πρωτεύον."]}
    if include_waveforms:
        wave = {k: [] for k in ("t_us", "iL", "iC", "iD", "iS", "iin", "vo", "gate")}
        for cycle in range(2):
            for seg in segments:
                for f in np.linspace(0, 1, max(3, int(240*(seg["b"]-seg["a"])))):
                    wave["t_us"].append(float((cycle+seg["a"]+(seg["b"]-seg["a"])*f)/fs*1e6))
                    for name in ("iL", "iC", "iD", "iS", "iin"):
                        a,b = seg[name]
                        wave[name].append(float(a+(b-a)*f))
                    a,b = seg["iC"]
                    qf = seg["q0"]+(seg["b"]-seg["a"])/fs*(a*f+(b-a)*f*f/2)
                    wave["vo"].append(float(vo+(qf-(max(candidates)+min(candidates))/2)/cap))
                    wave["gate"].append(1 if seg["state"] == "ON" else 0)
        result["waveforms"] = wave
    if include_steps:
        result["steps"] = solution_steps(c, mode, metrics)
    return result


def solution_steps(c, mode, m):
    model = MODELS[c["topology"]]
    sym = symbolic_model(model.key, c["load"])
    def step(title, explanation, expr):
        return {"title": title, "explanation": explanation, "math": math_record(expr)}
    steps = [step("1 · Δεδομένα και αναφορές", "Όλες οι τάσεις εξόδου στις εξισώσεις είναι μέτρα. Το ρεύμα flyback είναι im στο πρωτεύον.", sp.Eq(R,V**2/P)),
             step("2 · Διακόπτης ON", "Οι παράγωγοι των καταστάσεων [iL, vo] από KVL και KCL.", sym["on"]),
             step("3 · Διακόπτης OFF / δίοδος ON", "Οι ίδιες καταστάσεις με ενεργή τη διαδρομή εκφόρτισης.", sym["off"]),
             step("4 · Μέσο μοντέλο CCM", "D·fON + (1−D)·fOFF = 0 στη μόνιμη κατάσταση.", sym["average"]),
             step("5 · Υποψήφιο duty CCM", "Συμβολική επίλυση των δύο εξισώσεων ισορροπίας. Ακολουθεί έλεγχος εγκυρότητας.", sp.Eq(D,sym["duty"])),
             step("6 · Όριο αγωγής", "Θέτουμε Imin=0, δηλαδή Iavg=ΔI/2. Στην ισότητα L=Lcrit έχουμε BCM.", sp.Eq(sp.Symbol("L_crit"),sym["critical"]))]
    if mode == "DCM":
        if model.key == "buck":
            expr = sp.Eq(D, sp.sqrt(2*L*FS*(P/V)*V/(VIN*(VIN-V))))
        elif model.key == "boost":
            expr = sp.Eq(D, sp.sqrt(2*L*FS*(P/V)*(V-VIN))/VIN)
        else:
            expr = sp.Eq(P,VIN**2*D**2/(2*L*FS))
        steps.append(step("7 · Επανεπίλυση σε DCM", "L<Lcrit: το ρεύμα μηδενίζεται πριν από την επόμενη περίοδο. Χρησιμοποιείται η τριγωνική μέση τιμή εξόδου, όχι το κέρδος CCM.", expr))
    else:
        steps.append(step("7 · Έλεγχος ρεύματος", f"L/Lcrit={m['L_margin']:.6g} → {mode}. Υπολογίζονται κορυφή και ελάχιστο του τριγωνικού ρεύματος.", sp.Eq(sp.Symbol("I_min"),sp.Symbol("I_avg")-sp.Symbol("Delta_I")/2)))
    t,T = sp.symbols("t T",positive=True)
    ic = sp.Function("i_C")(t)
    steps.append(step("8 · Πυκνωτής και κυμάτωση", "Ολοκληρώνουμε ανά διάστημα το iC. Τα ακρότατα φορτίου βρίσκονται στα άκρα και όπου iC=0. Η υλοποίηση ολοκληρώνει ακριβώς τις γραμμικές ράμπες.", sp.Eq(sp.Function("q")(t),sp.Integral(ic,(t,0,t)))))
    steps.append(step("9 · RMS και ισοζύγια", f"Υπόλοιπο ισχύος: {m['power_balance_W']:.3g} W · υπόλοιπο μέσου iC: {m['charge_balance_A']:.3g} A.",sp.Eq(sp.Symbol("I_rms"),sp.sqrt(sp.Integral(sp.Function("i")(t)**2,(t,0,T))/T))))
    return steps


def inverse(data):
    """Controlled symbolic relations, never evaluate user code or expressions."""
    key = data.get("topology", "buck_boost")
    if key not in MODELS:
        raise InputError("Άγνωστη τοπολογία.")
    model = symbolic_model(key)
    relation = data.get("relation", "gain")
    dv,di,q,io=sp.symbols('Delta_V Delta_I Delta_q I_o',positive=True)
    equations = {"gain": sp.Eq(V, model["gain"]*VIN),
                 "boundary": sp.Eq(L, model["critical"].subs(R,V**2/P)),
                 "boundary_operating": sp.Eq(L, model["critical"].subs(D,model['duty']).subs(R,V**2/P)),
                 "dcm_energy": sp.Eq(P,VIN**2*D**2/(2*L*FS)),
                 "charge_ripple":sp.Eq(dv,q/C),
                 "current_ripple":sp.Eq(di,(VIN-V if key=='buck' else VIN)*D/(L*FS)),
                 "current_ripple_ccm":sp.Eq(di,((VIN-V if key=='buck' else VIN)*D/(L*FS)).subs(D,model['duty'])),
                 "output_power":sp.Eq(P,V*io),
                 "load_resistance":sp.Eq(R,V**2/P)}
    if relation not in equations or (relation == "dcm_energy" and key not in ("buck_boost", "flyback")):
        raise InputError("Η σχέση δεν υποστηρίζεται για αυτή την τοπολογία.")
    names = {"vin": VIN,"vo": V,"duty": D,"L": L,"fs": FS,"power": P,"n": N,
             "C":C,"voltage_ripple":dv,"current_ripple":di,"charge_pp":q,"Iout":io,"resistance":R}
    unknown = data.get("unknown", "duty")
    if unknown not in names:
        raise InputError("Άγνωστο ζητούμενο.")
    eq, target = equations[relation], names[unknown]
    if target not in eq.free_symbols:
        raise InputError("Το ζητούμενο δεν εμφανίζεται στη συγκεκριμένη εξίσωση.")
    known = data.get("known", {})
    subs = {}
    for name, sym in names.items():
        if sym != target and sym in eq.free_symbols and name in known:
            subs[sym] = number(known,name,high=1e12)
    missing = eq.free_symbols-set(subs)-{target}
    symbolic = sp.solve(eq,target)
    if missing:
        return {"status":"underdetermined", "missing":[str(x) for x in sorted(missing,key=str)],
                "equation":math_record(eq),"solutions":[math_record(x) for x in symbolic]}
    candidates = []
    for expression in symbolic:
        val = complex(expression.subs(subs).evalf())
        if abs(val.imag)<1e-9 and math.isfinite(val.real) and val.real>0:
            candidate = val.real
            d = candidate if target == D else subs.get(D)
            if d is not None and not 0<d<1:
                continue
            vin = candidate if target == VIN else subs.get(VIN)
            vo = candidate if target == V else subs.get(V)
            if relation in ("gain","boundary_operating","current_ripple_ccm") and vin is not None and vo is not None:
                if key == "buck" and vo >= vin or key == "boost" and vo <= vin:
                    continue
            residual = abs(float((eq.lhs-eq.rhs).subs({**subs,target:candidate})))
            candidates.append({"value":candidate,"residual":residual,"expression":math_record(expression)})
    return {"status":"solved" if candidates else "no_physical_solution", "unknown":unknown,
            "equation":math_record(eq),"solutions":candidates,
            "scope":"Η σχέση gain ισχύει σε CCM/BCM· δεν επιβεβαιώνει από μόνη της την αγωγή. Η dcm_energy απαιτεί ξεχωριστό έλεγχο D+δ<1."}
