"""Reference ("batch") simulation of a studio circuit with SciPy's solve_ivp.

The browser sends the netlist it built for its own fixed-step solver (same
elements, node numbering and controllers), so both runs describe exactly the
same circuit. Here the circuit is a switched linear system:

* in every topology (switch and diode states) the resistive network is solved
  exactly for the node voltages and branch currents, given the inductor
  currents and capacitor voltages (the states), and the states are integrated
  with an adaptive ODE solver: RK45, RK23, DOP853 (explicit) or Radau, BDF,
  LSODA (implicit, for stiff circuits);
* topology changes are events. PWM edges (with dead time), controller sampling
  instants, schedules and thyristor pulses are known in advance and end a
  segment; diode turn-off (current through zero) and turn-on (voltage above
  V_f) are located as roots inside the segment.

The result is a reference waveform with controlled local error (rtol/atol) to
compare against the browser solver.
"""
import math
import time

import numpy as np
from scipy.integrate import solve_ivp

GMIN = 1e-9
METHODS = ('Radau', 'BDF', 'LSODA', 'RK45', 'RK23', 'DOP853')
IMPLICIT = {'Radau', 'BDF', 'LSODA'}
LIMITS = {'els': 800, 'nodes': 600, 't_end': 10.0, 'wall': 45.0, 'points': 600000, 'periods': 20000}


class BatchError(ValueError):
    """Input or solver failure, reported to the user."""


def sched_at(s, t, dflt):
    if not s:
        return dflt
    v = s[0][1]
    if t < s[0][0]:
        return dflt
    for ts, val in s:
        if ts <= t + 1e-15:
            v = val
        else:
            break
    return v


def _f(v, d=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return d
    return v if math.isfinite(v) else d


class Ctrl:
    """PWM / PI / PID block, same rules as the browser (web/studio/mna.js)."""
    FIELDS = ('id', 'mode', 'carrier', 'qty', 'ff')

    def __init__(self, k):
        for f in self.FIELDS:
            setattr(self, f, k.get(f))
        self.T = _f(k.get('T'), 1e-4)
        for f in ('D', 'phase', 'dt', 'Kp', 'Ki', 'Kd', 'Tf', 'D0', 'dmin', 'dmax', 'm', 'fref', 'refphase'):
            setattr(self, f, _f(k.get(f)))
        self.dsched = k.get('dsched')
        self.ref = k.get('ref') or [[0, 0]]
        self.sensor = k.get('sensorRec')
        self.ffA = k.get('ffARec')
        self.ffB = k.get('ffBRec')
        self.d = self.D
        self.xi = 0.0
        self.k = None
        self.tk = 0.0
        self.tkPrev = None
        self.dPrev = None
        self.meas = 0.0
        self.refNow = 0.0
        self.ePrev = None
        self.dF = 0.0

    def raw(self, out, t, tk, dd):
        T = self.T
        if self.mode == 'spwm':
            ph = ((t / T - self.phase) % 1 + 1) % 1
            car = 1 - 4 * ph if ph < .5 else -3 + 4 * ph
            ref = self.m * math.sin(2 * math.pi * self.fref * t + self.refphase)
            a, b = ref > car, -ref > car
        else:
            tau, d = t - tk, min(1.0, max(0.0, dd))
            if self.mode == 'pp':
                h = T / 2
                a = -1e-15 <= tau < d * h * (1 - 1e-12)
                b = h * (1 - 1e-12) <= tau < h + d * h * (1 - 1e-12)
            else:
                e0, e1 = (0, d * T) if self.carrier == 'saw' else ((1 - d) * T / 2, (1 + d) * T / 2)
                a = e0 * (1 - 1e-12) - 1e-18 <= tau < e1 * (1 - 1e-12)
                b = a
        return a if out == 'a' else (not a) if out == 'na' else b if out == 'b' else (not b)

    def gate(self, out, t):
        if not self.dt > 0:
            return self.raw(out, t, self.tk, self.d)
        if not self.raw(out, t, self.tk, self.d):
            return False
        td = t - self.dt
        if self.mode == 'spwm' or td >= self.tk - 1e-15 * self.T:
            return self.raw(out, td, self.tk, self.d)
        return self.raw(out, td, self.tkPrev if self.tkPrev is not None else self.tk - self.T,
                        self.dPrev if self.dPrev is not None else self.d)

    def edges(self):
        T, d = self.T, min(1.0, max(0.0, self.d))
        if self.mode == 'pp':
            h = T / 2
            E = [self.tk + d * h, self.tk + h, self.tk + h + d * h, self.tk + T]
        else:
            e0, e1 = (0, d * T) if self.carrier == 'saw' else ((1 - d) * T / 2, (1 + d) * T / 2)
            E = [self.tk + e0, self.tk + e1, self.tk + T]
        if self.dt > 0:
            E = E + [self.tk + self.dt] + [e + self.dt for e in E]
        return E


class Circuit:
    def __init__(self, net):
        self.els = net['els']
        self.nN = int(net['nNodes'])
        size = int(net['size'])
        if len(self.els) > LIMITS['els'] or self.nN > LIMITS['nodes']:
            raise BatchError('Πολύ μεγάλο κύκλωμα για τον batch λύτη.')
        self.ctrls = [Ctrl(k) for k in net.get('ctrls', [])]
        self.cmap = {k.id: k for k in self.ctrls}
        E = self.els
        self.iL = [i for i, e in enumerate(E) if e['k'] == 'L']
        self.iC = [i for i, e in enumerate(E) if e['k'] == 'C']
        self.iD = [i for i, e in enumerate(E) if e['k'] == 'D']
        self.iS = [i for i, e in enumerate(E) if e['k'] == 'S']
        self.iP = [i for i, e in enumerate(E) if e['k'] == 'CPL']
        self.iG = [i for i, e in enumerate(E) if e['k'] == 'G']
        self.iGs = [i for i in self.iG if E[i].get('sched')]
        self.iV = [i for i, e in enumerate(E) if e['k'] == 'V']
        self.iI = [i for i, e in enumerate(E) if e['k'] == 'I']
        self.iX = [i for i, e in enumerate(E) if e['k'] == 'X']
        self.n = size + len(self.iC)
        self.crow = {ci: size + j for j, ci in enumerate(self.iC)}
        self.ns = len(self.iL) + len(self.iC)
        self.on = {i: False for i in self.iD + self.iS}
        self.gon = {i: False for i in self.iD if E[i].get('gk')}
        self.cap_rs = 0.0
        self.cache = {}
        self.icpl = np.zeros(len(self.iP))
        for i in self.iP:
            E[i]['Vmin'] = max(_f(E[i].get('Vmin'), 5), 1e-3)
        # states -> right-hand side, and node solution -> state derivatives
        n, ns = self.n, self.ns
        self.Bx = np.zeros((n, ns))
        self.Dm = np.zeros((ns, n))
        for k, i in enumerate(self.iL):
            e = E[i]
            if e['a'] >= 0:
                self.Bx[e['a'], k] -= 1
                self.Dm[k, e['a']] += 1 / e['L']
            if e['b'] >= 0:
                self.Bx[e['b'], k] += 1
                self.Dm[k, e['b']] -= 1 / e['L']
        for j, i in enumerate(self.iC):
            r = self.crow[i]
            self.Bx[r, len(self.iL) + j] = 1
            self.Dm[len(self.iL) + j, r] = 1 / E[i]['C']
        self.Bc = np.zeros((n, len(self.iP)))
        self.Cv = np.zeros((len(self.iP), n))
        for q, i in enumerate(self.iP):
            e = E[i]
            if e['a'] >= 0:
                self.Bc[e['a'], q] -= 1
                self.Cv[q, e['a']] += 1
            if e['b'] >= 0:
                self.Bc[e['b'], q] += 1
                self.Cv[q, e['b']] -= 1
        self.x0 = np.array([_f(E[i].get('i')) for i in self.iL] + [_f(E[i].get('v')) for i in self.iC])
        if ns == 0:     # purely resistive circuit (e.g. diode rectifier into R, E): a dummy
            self.ns = 1  # constant state lets the ODE solver march in time and find events
            self.Bx, self.Dm, self.x0 = np.zeros((n, 1)), np.zeros((1, n)), np.zeros(1)
        self.base_T = min([k.T for k in self.ctrls], default=None) or next(
            (1 / max(1e-6, _f(E[i]['src'].get('f'), 50)) for i in self.iV if E[i]['src'].get('kind') == 'ac'), 1e-3)
        self._z = None
        self.started = False

    # ------------------------------------------------------------ sources
    def R(self, e, t):
        return max(sched_at(e.get('sched'), t, e['R']), 1e-9)

    def Vsrc(self, e, t):
        s = e['src']
        if s.get('kind') == 'dc':
            return sched_at(s.get('sched'), t, _f(s.get('V')))
        return _f(s.get('off')) + _f(s.get('Vpk')) * math.sin(2 * math.pi * _f(s.get('f')) * t + _f(s.get('ph')))

    def topo(self, t):
        key = (tuple(self.on[i] for i in self.iD + self.iS), tuple(self.R(self.els[i], t) for i in self.iGs), self.cap_rs)
        tp = self.cache.get(key)
        if tp is None:
            if len(self.cache) > 400:
                self.cache.clear()
            tp = self.build(t)
            self.cache[key] = tp
        return tp

    def build(self, t):
        n, E = self.n, self.els
        A = np.zeros((n, n))
        for i in range(self.nN):
            A[i, i] += GMIN

        def g(a, b, G):
            if a >= 0:
                A[a, a] += G
            if b >= 0:
                A[b, b] += G
            if a >= 0 and b >= 0:
                A[a, b] -= G
                A[b, a] -= G

        def vrow(a, b, r):
            if a >= 0:
                A[a, r] += 1
                A[r, a] += 1
            if b >= 0:
                A[b, r] -= 1
                A[r, b] -= 1
        bd = np.zeros(n)
        for i in self.iG:
            g(E[i]['a'], E[i]['b'], 1 / self.R(E[i], t))
        for i in self.iS:
            e = E[i]
            g(e['a'], e['b'], 1 / e['Ron'] if self.on[i] else 1 / e['Roff'])
        for i in self.iD:
            e = E[i]
            if self.on[i]:
                g(e['a'], e['b'], 1 / e['Ron'])
                j = e['Vf'] / e['Ron']
                if e['a'] >= 0:
                    bd[e['a']] += j
                if e['b'] >= 0:
                    bd[e['b']] -= j
            else:
                g(e['a'], e['b'], 1 / e['Roff'])
        for i in self.iV:
            vrow(E[i]['a'], E[i]['b'], E[i]['row'])
        for i in self.iC:
            r = self.crow[i]
            vrow(E[i]['a'], E[i]['b'], r)
            A[r, r] -= self.cap_rs
        for i in self.iX:
            e, r = E[i], E[i]['row']
            N = e['n']
            for node, s in ((e['s1'], 1), (e['s2'], -1), (e['p1'], -N), (e['p2'], N)):
                if node >= 0:
                    A[node, r] += s
                    A[r, node] += s
        try:
            cond = np.linalg.cond(A)
            if not math.isfinite(cond) or cond > 1e17:
                raise np.linalg.LinAlgError
            Ainv = np.linalg.inv(A)
        except np.linalg.LinAlgError:
            if self.cap_rs == 0 and self.iC:
                # a capacitor directly across an ideal voltage source: give the
                # capacitors a tiny series resistance and rebuild
                self.cap_rs = 1e-6
                self.cache.clear()
                return self.build(t)
            raise BatchError('Ιδιόμορφο σύστημα στον batch λύτη (βρόχος ιδανικών πηγών ή κόμβος χωρίς διαδρομή).')
        M = self.Dm @ Ainv
        return {'Ainv': Ainv, 'M': M, 'J': M @ self.Bx, 'bd': bd, 'Z1': Ainv @ self.Bc if self.iP else None}

    def bsrc(self, t):
        b = np.zeros(self.n)
        E = self.els
        for i in self.iV:
            b[E[i]['row']] = self.Vsrc(E[i], t)
        for i in self.iI:
            e = E[i]
            I = sched_at(e.get('sched'), t, _f(e.get('I')))
            if e['a'] >= 0:
                b[e['a']] += I
            if e['b'] >= 0:
                b[e['b']] -= I
        return b

    def solve_z(self, t, x, tp):
        b = self.Bx @ x + self.bsrc(t) + tp['bd']
        z0 = tp['Ainv'] @ b
        if not self.iP:
            return z0
        # constant-power loads: Newton on i = P/v (resistive below V_min)
        K = self.Cv @ tp['Z1']
        v0 = self.Cv @ z0
        P = np.array([sched_at(self.els[i].get('sched'), t, _f(self.els[i].get('P'))) for i in self.iP])
        Vm = np.array([self.els[i]['Vmin'] for i in self.iP])
        icp = self.icpl.copy()
        for _ in range(30):
            v = v0 + K @ icp
            big = np.abs(v) >= Vm
            g = np.where(big, P / np.where(big, v, 1), P * v / Vm ** 2)
            dg = np.where(big, -P / np.where(big, v, 1) ** 2, P / Vm ** 2)
            F = icp - g
            if np.max(np.abs(F)) <= 1e-10 * (1 + np.max(np.abs(icp))):
                break
            Jf = np.eye(len(icp)) - dg[:, None] * K
            icp = icp - np.linalg.solve(Jf, F)
        self.icpl = icp
        return z0 + tp['Z1'] @ icp

    # ------------------------------------------------------------ gates and states
    def scr_u(self, e, t):
        F = e['fire']
        return F['f'] * t + F['ph0'] / (2 * math.pi) - (F['alpha'] + F['shift']) / 360

    def scr_gate(self, e, t):
        u = self.scr_u(e, t)
        return u - math.floor(u) < e['fire']['pw'] / 360

    def scr_edges(self, e, t):
        F = e['fire']
        u = self.scr_u(e, t)
        fl = math.floor(u + 1e-9)
        back = lambda uu: (uu - F['ph0'] / (2 * math.pi) + (F['alpha'] + F['shift']) / 360) / F['f']
        return [back(fl + F['pw'] / 360), back(fl + 1), back(fl + 1 + F['pw'] / 360)]

    def gate_state(self, e, t):
        if e.get('gate') == 'on':
            return True
        if e.get('gate') == 'pwm':
            k = self.cmap.get(e.get('pwm'))
            return bool(k and k.gate(e.get('out') or 'a', t))
        if e.get('gate') == 'alpha':
            return self.scr_gate(e, t)
        return False

    def set_gates(self, t):
        for i in self.iS:
            self.on[i] = self.gate_state(self.els[i], t)
        for i in self.gon:
            self.gon[i] = self.gate_state(self.els[i], t)
            if self.els[i]['gk'] == 'igbt' and not self.gon[i]:
                self.on[i] = False

    def may_turn_on(self, i, init=False):
        gk = self.els[i].get('gk')
        return not gk or self.gon[i] or (init and gk == 'scr')

    def tolerances(self, x):
        nl = len(self.iL)
        iscale = float(np.max(np.abs(x[:nl]))) if nl else 0.0
        vscale = float(np.max(np.abs(x[nl:]))) if len(x) > nl else 0.0
        return 1e-9 * (1 + iscale), 1e-7 * (1 + vscale)

    def consistent(self, t, x, init=False):
        itol, vtol = self.tolerances(x)
        for it in range(80):
            tp = self.topo(t)
            z = self.solve_z(t, x, tp)
            bad = []
            for i in self.iD:
                e = self.els[i]
                v = (z[e['a']] if e['a'] >= 0 else 0) - (z[e['b']] if e['b'] >= 0 else 0)
                if self.on[i]:
                    cur = (v - e['Vf']) / e['Ron']
                    if cur < -itol:
                        bad.append((-cur * e['Ron'], i))
                elif self.may_turn_on(i, init) and v > e['Vf'] + vtol:
                    bad.append((v - e['Vf'], i))
            if not bad:
                return tp, z
            if it < 25:
                for _, i in bad:
                    self.on[i] = not self.on[i]
            else:   # flip the worst one only: breaks oscillation between parallel diodes
                i = max(bad)[1]
                self.on[i] = not self.on[i]
        raise BatchError(f'Οι καταστάσεις των διόδων δεν συγκλίνουν στο t = {t:.6g} s.')

    # ------------------------------------------------------------ controllers
    def value(self, rec, t, x, z):
        if not rec:
            return 0.0
        if 'v' in rec:
            return float(sum(c * z[nd] for nd, c in rec['v'] if nd >= 0))
        if 'i' in rec:
            return float(sum(c * self.current(i, t, x, z) for i, c in rec['i']))
        if 'prod' in rec:
            a, b = rec['prod']
            return self.value(a, t, x, z) * self.value(b, t, x, z)
        if 'sum' in rec:
            return float(sum(self.value(r, t, x, z) for r in rec['sum']))
        if 'ctrl' in rec:
            ci, field = rec['ctrl']
            return float(getattr(self.ctrls[ci], field))
        if 'gate' in rec:
            ci, out = rec['gate']
            return 1.0 if self.ctrls[ci].gate(out, t) else 0.0
        return 0.0

    def current(self, i, t, x, z):
        e = self.els[i]
        k = e['k']
        V = lambda nd: z[nd] if nd is not None and nd >= 0 else 0.0
        if k == 'L':
            return float(x[self.iL.index(i)])
        if k == 'C':
            return float(z[self.crow[i]])
        if k == 'V':
            return float(-z[e['row']])
        if k == 'X':
            return float(z[e['row']])
        if k == 'I':
            return sched_at(e.get('sched'), t, _f(e.get('I')))
        if k == 'CPL':
            return float(self.icpl[self.iP.index(i)])
        v = V(e.get('a')) - V(e.get('b'))
        if k == 'G':
            return v / self.R(e, t)
        if k == 'S':
            return v / (e['Ron'] if self.on[i] else e['Roff'])
        if k == 'D':
            return (v - e['Vf']) / e['Ron'] if self.on[i] else v / e['Roff']
        return 0.0

    def sample(self, t, x, z, force=False):
        for k in self.ctrls:
            T = k.T
            idx = math.floor((t + 1e-12 * T) / T - k.phase)
            if not force and k.k == idx:
                continue
            first = k.k is None
            if not first:
                k.tkPrev, k.dPrev = k.tk, k.d
            k.k = idx
            k.tk = (idx + k.phase) * T
            if k.mode in ('fixed', 'pp'):
                k.d = sched_at(k.dsched, t, k.D)
            elif k.mode == 'pi':
                k.refNow = sched_at(k.ref, t, k.ref[0][1])
                k.meas = self.value(k.sensor, t, x, z)
                ff = 0.0
                if k.ff == 'ratio':
                    a, b = self.value(k.ffA, t, x, z), self.value(k.ffB, t, x, z)
                    ff = 1 - a / b if abs(b) > 1e-9 else 0.0
                elif k.ff == 'const':
                    ff = k.D0
                e = k.refNow - k.meas
                if force and not self.started:
                    k.xi, k.ePrev, k.dF = 0.0, None, 0.0
                der = 0.0
                if k.Kd:
                    raw = 0.0 if k.ePrev is None else (e - k.ePrev) / T
                    k.dF = (k.Tf * k.dF + T * raw) / (k.Tf + T) if k.Tf > 0 else raw
                    der = k.Kd * k.dF
                k.ePrev = e
                k.xi += k.Ki * T * e
                d = ff + k.Kp * e + k.xi + der
                if d > k.dmax or d < k.dmin:
                    k.xi -= k.Ki * T * e
                    d = min(k.dmax, max(k.dmin, ff + k.Kp * e + k.xi + der))
                k.d = d
            if first or k.tkPrev is None:
                k.tkPrev, k.dPrev = k.tk - T, k.d

    # ------------------------------------------------------------ events
    def next_event(self, t, tmax):
        tn = tmax
        eps = self.base_T * 1e-9
        for k in self.ctrls:
            if k.mode == 'spwm':
                continue
            for e in k.edges():
                if t + eps < e < tn:
                    tn = e

        def sch(s):
            nonlocal tn
            for ts, _ in s or []:
                if t + eps < ts < tn:
                    tn = ts
        for e in self.els:
            sch(e.get('sched'))
            if e['k'] == 'V':
                sch(e['src'].get('sched'))
        for k in self.ctrls:
            sch(k.dsched)
            if k.mode == 'pi':
                sch(k.ref)
        for e in self.els:
            if e.get('fire'):
                for te in self.scr_edges(e, t):
                    if t + eps < te < tn:
                        tn = te
        sp = [k for k in self.ctrls if k.mode == 'spwm']
        if sp:
            outs = ('a', 'na', 'b', 'nb') if any(k.dt > 0 for k in sp) else ('a', 'b')
            sig = lambda s: tuple(k.gate(o, s) for k in sp for o in outs)
            step = min(k.T for k in sp) / 40
            s0 = sig(t + step * 1e-7)
            lo = t
            while lo < tn:
                hi = min(lo + step, tn)
                if sig(hi) != s0:
                    a, b = lo, hi
                    for _ in range(60):
                        m = (a + b) / 2
                        if sig(m) == s0:
                            a = m
                        else:
                            b = m
                    tn = max(b, t + eps * 10)
                    break
                lo = hi
        return tn


def _decimate(t, cols, limit):
    n = len(t)
    if n <= limit:
        return np.arange(n)
    buckets = max(1, limit // (2 + 2 * len(cols)))
    edges = np.linspace(0, n, buckets + 1).astype(int)
    keep = set()
    for a, b in zip(edges[:-1], edges[1:]):
        if b <= a:
            continue
        keep.update((a, b - 1))
        for c in cols:
            seg = c[a:b]
            keep.update((a + int(np.argmin(seg)), a + int(np.argmax(seg))))
    return np.array(sorted(keep))


def simulate(data):
    """Action 'batch_sim'. Input: {net, channels, t_end, method, rtol, atol, max_step, max_points}."""
    if not isinstance(data, dict) or not isinstance(data.get('net'), dict):
        raise BatchError('Λείπει το κύκλωμα.')
    method = data.get('method', 'Radau')
    if method not in METHODS:
        raise BatchError('Άγνωστη μέθοδος: ' + str(method))
    t_end = _f(data.get('t_end'), 0)
    if not 0 < t_end <= LIMITS['t_end']:
        raise BatchError(f'Η διάρκεια πρέπει να είναι 0 … {LIMITS["t_end"]} s.')
    rtol = min(1e-2, max(1e-12, _f(data.get('rtol'), 1e-6)))
    atol = min(1.0, max(1e-14, _f(data.get('atol'), 1e-9)))
    max_step = _f(data.get('max_step'), 0)
    max_points = int(min(200000, max(1000, _f(data.get('max_points'), 40000))))
    wall = min(LIMITS['wall'], max(1.0, _f(data.get('wall'), LIMITS['wall'])))
    channels = data.get('channels') or {}
    if not isinstance(channels, dict) or len(channels) > 40:
        raise BatchError('Μέχρι 40 σήματα.')
    ckt = Circuit(data['net'])
    # default step limit: diode events inside a long smooth segment (AC sources)
    # must not be stepped over, and the reference trace needs enough points
    auto_step = max_step <= 0
    if auto_step:
        max_step = ckt.base_T / (50 if ckt.ctrls else 200)
    if t_end / ckt.base_T > LIMITS['periods']:
        raise BatchError(f'Πάνω από {LIMITS["periods"]} περίοδοι: μείωσε τη διάρκεια.')
    keys = list(channels)
    T, Y = [], [[] for _ in keys]
    stats = {'segments': 0, 'diode_events': 0, 'nfev': 0, 'njev': 0, 'nlu': 0, 'steps': 0}
    start = time.perf_counter()
    status, message = 'ok', ''

    def record(t, x, z):
        T.append(t)
        for j, k in enumerate(keys):
            Y[j].append(ckt.value(channels[k], t, x, z))

    t, x = 0.0, ckt.x0.copy()
    ckt.set_gates(0.0)
    tp, z = ckt.consistent(0.0, x, init=True)
    ckt.sample(0.0, x, z, force=True)
    record(t, x, z)
    stuck = 0
    implicit = method in IMPLICIT
    while t < t_end * (1 - 1e-12):
        if time.perf_counter() - start > wall:
            status, message = 'timeout', f'Σταμάτησε στο t = {t:.6g} s (όριο {wall:.0f} s). ' + (
                'Οι ρητές μέθοδοι (RK) θέλουν πολύ μικρά βήματα σε άκαμπτα κυκλώματα (R_off, DCM): δοκίμασε Radau ή BDF.' if not implicit else 'Μεγάλωσε τα rtol/atol ή μείωσε τη διάρκεια.')
            break
        if len(T) > LIMITS['points']:
            status, message = 'points', f'Σταμάτησε στο t = {t:.6g} s: πάνω από {LIMITS["points"]} σημεία.'
            break
        tn = ckt.next_event(t, t_end)
        before = (tuple(ckt.on.values()), tuple(ckt.gon.values()))
        ckt.set_gates((t + tn) / 2)
        tp, z = ckt.consistent(t, x)
        if (tuple(ckt.on.values()), tuple(ckt.gon.values())) != before:
            record(t, x, z)            # the point right after switching: vertical edges
        itol, vtol = ckt.tolerances(x)
        cache = {}

        def zof(tt, yy, tp=tp):
            key = (tt, yy.tobytes())
            if cache.get('k') != key:
                cache['k'] = key
                cache['z'] = ckt.solve_z(tt, yy, tp)
            return cache['z']

        def fun(tt, yy, tp=tp):
            if ckt.iP:
                return ckt.Dm @ zof(tt, yy)
            return tp['M'] @ (ckt.Bx @ yy + ckt.bsrc(tt) + tp['bd'])
        events, owners = [], []
        for i in ckt.iD:
            e = ckt.els[i]
            a, b = e['a'], e['b']
            if ckt.on[i]:
                def ev(tt, yy, a=a, b=b, e=e):
                    zz = zof(tt, yy)
                    return ((zz[a] if a >= 0 else 0) - (zz[b] if b >= 0 else 0) - e['Vf']) / e['Ron'] + itol
                ev.direction = -1
            elif ckt.may_turn_on(i):
                def ev(tt, yy, a=a, b=b, e=e):
                    zz = zof(tt, yy)
                    return (zz[a] if a >= 0 else 0) - (zz[b] if b >= 0 else 0) - e['Vf'] - vtol
                ev.direction = 1
            else:
                continue
            ev.terminal = True
            events.append(ev)
            owners.append(i)
        kw = dict(method=method, rtol=rtol, atol=atol, max_step=max_step, events=events or None)
        if implicit and not ckt.iP:
            kw['jac'] = (lambda tt, yy, J=tp['J']: J) if method == 'LSODA' else tp['J']
        sol = solve_ivp(fun, (t, tn), x, **kw)
        stats['segments'] += 1
        stats['nfev'] += int(sol.nfev)
        stats['njev'] += int(sol.njev)
        stats['nlu'] += int(sol.nlu)
        stats['steps'] += max(0, len(sol.t) - 1)
        if sol.status == -1:
            raise BatchError(f'Ο {method} απέτυχε στο t = {t:.6g} s: {sol.message}')
        for j in range(1, len(sol.t)):
            yy = sol.y[:, j]
            record(float(sol.t[j]), yy, zof(float(sol.t[j]), yy))
        t_new = float(sol.t[-1])
        x = sol.y[:, -1].copy()
        if sol.status == 1:
            te = min(float(ts[0]) for ts in sol.t_events if len(ts))
            for q, ts in enumerate(sol.t_events):
                if len(ts) and abs(float(ts[0]) - te) <= 1e-12 * ckt.base_T + 1e-18:
                    ckt.on[owners[q]] = not ckt.on[owners[q]]
                    stats['diode_events'] += 1
            stuck = stuck + 1 if te - t < 1e-12 * ckt.base_T else 0
            if stuck > 60:
                raise BatchError(f'Συνεχείς μεταγωγές χωρίς πρόοδο στο t = {te:.6g} s (chattering).')
            t = te
            tp, z = ckt.consistent(t, x)
            record(t, x, z)
        else:
            t = tn if abs(t_new - tn) < 1e-9 * ckt.base_T else t_new
            ckt.started = True
            ckt.sample(t, x, zof(t_new, x))
    ckt.started = True
    wall_s = time.perf_counter() - start
    T = np.array(T)
    cols = [np.array(c) for c in Y]
    keep = _decimate(T, cols, max_points)
    r6 = lambda a: [float(f'{v:.7g}') for v in a]
    return {
        'method': method, 'rtol': rtol, 'atol': atol, 'max_step': max_step, 'auto_step': auto_step,
        't_end': float(T[-1]) if len(T) else 0.0, 'requested_t_end': t_end, 'status': status, 'message': message,
        'stats': {**stats, 'points': int(len(T)), 'returned': int(len(keep)), 'wall_s': round(wall_s, 3),
                  'cap_rs': ckt.cap_rs, 'states': ckt.ns, 'unknowns': ckt.n},
        't': [float(f'{v:.12g}') for v in T[keep]],
        'ch': {k: r6(cols[j][keep]) for j, k in enumerate(keys)},
    }


def batch_sim(data):
    try:
        return simulate(data)
    except BatchError:
        raise
    except (KeyError, TypeError, IndexError) as e:
        raise BatchError(f'Μη έγκυρο netlist: {e}') from e
