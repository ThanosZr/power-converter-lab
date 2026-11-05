"""Browser live simulator (web/sim.js) against the exact periodic solution.

The reference is independent of both the engine and the JS code: each
switched interval is solved exactly with a matrix exponential, the diode
turn-off instant is found by root finding, and the periodic steady state is
the fixed point of the one-period map. No small-ripple assumption.

The JS file itself is executed with Node.js, so the test is skipped on a
machine without Node; the browser runs the same file unchanged.
"""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

import numpy as np
from scipy.linalg import expm
from scipy.optimize import brentq, fsolve

from engine.analysis import steady

ROOT = Path(__file__).resolve().parents[1]
SIM = ROOT / 'web' / 'converter' / 'sim.js'


def matrices(key, state, vin, L, C, R, n):
    load = -1 / (R * C)
    if state == 'IDLE':
        return np.array([[0, 0], [0, load]]), np.array([0., 0.])
    if state == 'ON':
        if key == 'buck':
            return np.array([[0, -1 / L], [1 / C, load]]), np.array([vin / L, 0.])
        return np.array([[0, 0], [0, load]]), np.array([vin / L, 0.])
    if key == 'boost':
        return np.array([[0, -1 / L], [1 / C, load]]), np.array([vin / L, 0.])
    if key == 'flyback':
        return np.array([[0, -1 / (n * L)], [1 / (n * C), load]]), np.array([0., 0.])
    return np.array([[0, -1 / L], [1 / C, load]]), np.array([0., 0.])


def flow(A, b, x, t):
    M = np.zeros((3, 3))
    M[:2, :2] = A
    M[:2, 2] = b
    return (expm(M * t) @ np.array([x[0], x[1], 1.]))[:2]


def one_period(x, key, vin, L, C, R, n, D, T, samples=None):
    def run(state, x, t0, t1):
        A, b = matrices(key, state, vin, L, C, R, n)
        if samples is not None:
            for s in np.linspace(0, t1 - t0, 400):
                samples.append((t0 + s, *flow(A, b, x, s)))
        return flow(A, b, x, t1 - t0)
    x = run('ON', x, 0, D * T)
    A, b = matrices(key, 'OFF', vin, L, C, R, n)
    if flow(A, b, x, (1 - D) * T)[0] < 0:
        tz = brentq(lambda s: flow(A, b, x, s)[0], 0, (1 - D) * T, xtol=1e-18)
        x = run('OFF', x, D * T, D * T + tz)
        return run('IDLE', np.array([0., x[1]]), D * T + tz, T)
    return run('OFF', x, D * T, T)


def exact(key, vin, L, C, R, n, D, fs, guess):
    T = 1 / fs
    x = fsolve(lambda x: one_period(np.array(x), key, vin, L, C, R, n, D, T) - np.array(x), guess, xtol=1e-13)
    samples = []
    one_period(x, key, vin, L, C, R, n, D, T, samples)
    t, i, v = (np.array(col) for col in zip(*samples))
    return {'vavg': float(np.trapezoid(v, t) / T), 'dv': float(v.max() - v.min()), 'ipk': float(i.max())}


CASES = [
    ('buck', dict(vin=24, vo=12, power=24, L=100e-6)),
    ('buck', dict(vin=24, vo=12, power=24, L=5e-6)),
    ('boost', dict(vin=12, vo=40, power=60, L=40e-6)),
    ('boost', dict(vin=12, vo=40, power=60, L=3e-6)),
    ('buck_boost', dict(vin=8, vo=12, power=24, L=20e-6)),
    ('buck_boost', dict(vin=19.2, vo=30, power=240, L=1.92e-6, C=1406.25e-6)),
    ('flyback', dict(vin=24, vo=12, power=24, L=40e-6, n=.5)),
    ('flyback', dict(vin=24, vo=12, power=24, L=10e-6, n=.5)),
]

RUNNER = r"""
const {SwitchedSim}=require(process.argv[1]);
const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));
const out=cases.map(c=>{
 const T=1/c.fs,s=new SwitchedSim({...c,load:'resistive',h:T/1000});
 s.reset('op',{i0:c.i0,v0:c.vo});let prev=null;
 for(let k=0;k<40000;k++){s.run(T);const l=s.last;
  if(prev&&k>50&&Math.abs(l.vavg-prev.vavg)<1e-10*c.vo&&Math.abs(l.imax-prev.imax)<1e-9*l.imax)break;prev=l;}
 const l=s.last;return {vavg:l.vavg,dv:l.vmax-l.vmin,ipk:l.imax};
});
process.stdout.write(JSON.stringify(out));
"""


@unittest.skipIf(shutil.which('node') is None, 'Node.js is not installed; the browser simulator is checked in the browser only.')
class LiveSimulator(unittest.TestCase):
    def test_matches_exact_periodic_solution(self):
        inputs, references, labels = [], [], []
        for key, params in CASES:
            data = {'topology': key, 'fs': 100e3, 'C': 100e-6, 'n': 1, **params}
            a = steady(data, False, False)
            m, c = a['metrics'], a['config']
            R = c['vo'] ** 2 / c['power']
            inputs.append({'topology': key, 'vin': c['vin'], 'L': c['L'], 'C': c['C'], 'fs': c['fs'],
                           'n': c['n'], 'duty': m['duty'], 'R': R, 'vref': c['vo'], 'vo': c['vo'], 'i0': m['Ivalley']})
            references.append(exact(key, c['vin'], c['L'], c['C'], R, c['n'], m['duty'], c['fs'], [m['Ivalley'], c['vo']]))
            labels.append(f"{key} {a['mode']}")
        run = subprocess.run(['node', '-e', RUNNER, str(SIM)], input=json.dumps(inputs), capture_output=True, text=True, timeout=600)
        self.assertEqual(run.returncode, 0, run.stderr)
        results = json.loads(run.stdout)
        for label, got, ref in zip(labels, results, references):
            for key in ('vavg', 'dv', 'ipk'):
                with self.subTest(case=label, quantity=key):
                    self.assertAlmostEqual(got[key] / ref[key], 1, delta=1e-4)


class EngineRippleAgainstExact(unittest.TestCase):
    """The engine's ΔVo,pp (small-ripple, exact triangle integration) versus
    the exact switched solution, in every family and conduction mode."""

    def test_voltage_ripple_and_peak_current(self):
        for key, params in CASES:
            data = {'topology': key, 'fs': 100e3, 'C': 100e-6, 'n': 1, **params}
            a = steady(data, False, False)
            m, c = a['metrics'], a['config']
            R = c['vo'] ** 2 / c['power']
            ref = exact(key, c['vin'], c['L'], c['C'], R, c['n'], m['duty'], c['fs'], [m['Ivalley'], c['vo']])
            with self.subTest(case=f"{key} {a['mode']}"):
                self.assertAlmostEqual(m['Vripple_pp'] / ref['dv'], 1, delta=5e-3)
                self.assertAlmostEqual(m['Ipeak'] / ref['ipk'], 1, delta=5e-3)

    def test_textbook_shortcut_underestimates_when_iC_changes_sign(self):
        # Flyback Lm=40 μH: secondary current falls below Io inside OFF, so
        # the charge maximum is interior and Io·D/(fs·C) is too small.
        a = steady({'topology': 'flyback', 'vin': 24, 'vo': 12, 'power': 24, 'fs': 100e3,
                    'L': 40e-6, 'C': 100e-6, 'n': .5}, False, False)
        m, c = a['metrics'], a['config']
        ref = exact('flyback', 24, 40e-6, 100e-6, 6, .5, m['duty'], 100e3, [m['Ivalley'], 12])
        shortcut = m['Iout'] * m['duty'] / (c['fs'] * c['C'])
        self.assertLess(shortcut, 0.97 * ref['dv'])
        self.assertAlmostEqual(m['Vripple_pp'] / ref['dv'], 1, delta=5e-3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
