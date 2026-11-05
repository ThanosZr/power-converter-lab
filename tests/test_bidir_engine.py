"""Analytic engine: the exercise numbers, both storage positions, exact check."""
import math
import unittest

from engine.bidir import solve, op, config
from engine.core import InputError


def exact_period(vlo, vhi, L, fs, D, i0):
    """Exact switched waveform for one period (S2 first), ideal sources."""
    T = 1 / fs
    t1 = D * T
    i1 = i0 + vlo / L * t1
    i2 = i1 + (vlo - vhi) / L * (T - t1)
    # piecewise linear: the mean is exact from the two trapezoids
    mean = ((i0 + i1) / 2 * t1 + (i1 + i2) / 2 * (T - t1)) / T
    pts = (i0, i1, i2)
    return i2, mean, max(pts) - min(pts)


class StudentCase(unittest.TestCase):
    """Window 60–100 V, f_s = 20 kHz, L = 5.6 μH (the student's choices)."""
    @classmethod
    def setUpClass(cls):
        cls.r = solve({})

    def test_q2(self):
        self.assertAlmostEqual(self.r['q2']['load_avg_kW'], 38.75)
        self.assertAlmostEqual(self.r['q2']['ports'][2]['bus'][0]['I'], 60e3 / 49)

    def test_q3_stresses(self):
        s = {(x['name'], x['which']): x['value'] for x in self.r['q3']['stresses']}
        self.assertAlmostEqual(s[('Τάση αποκοπής S1, S2', 'με υπερφόρτιση')], 100)
        self.assertAlmostEqual(s[('Μέγιστη |v_L|', 'όλο το εύρος')], 51)
        self.assertAlmostEqual(s[('Μέσο ρεύμα πηνίου (= μέγιστο, Δi ≈ 0)', 'με υπερφόρτιση')], 1224.4898, places=3)
        self.assertEqual([m['name'] for m in self.r['q3']['modes']], ['Buck', 'Boost'])

    def test_q4(self):
        q = self.r['q4']
        self.assertAlmostEqual(q['L_min'] * 1e6, 5.208333, places=5)
        self.assertAlmostEqual(q['L_std'] * 1e6, 5.6)
        self.assertAlmostEqual(q['ripple_max']['vst'], 100)
        self.assertAlmostEqual(q['ripple_max']['dI'], 223.2143, places=3)
        self.assertAlmostEqual(q['peak']['nom']['I'], 911.6071, places=3)
        self.assertAlmostEqual(q['peak']['over']['I'], 1311.6071, places=3)
        self.assertAlmostEqual(q['duty_range_bus'][0], 0.15)
        self.assertAlmostEqual(q['duty_range_bus'][1], 0.51)

    def test_q5_tests(self):
        t = {x['id']: x for x in self.r['q5']['tests']}
        self.assertEqual(t['Β']['mode'], 'Buck')
        self.assertAlmostEqual(t['Β']['D'], 0.5)
        self.assertAlmostEqual(t['Β']['IL'], -800)
        self.assertAlmostEqual(t['Β']['iL0_S2_first'], -800 - 223.2143 / 2, places=3)
        self.assertEqual(t['Ζ']['covered_by'], ['Β', 'Ε'])

    def test_exact_switched_waveform(self):
        """Fixed D0 and the tabulated i_L(0): exactly periodic with the tabulated mean and ripple."""
        for x in self.r['q5']['tests']:
            i_end, mean, ripple = exact_period(x['vlo'], x['vhi'], 5.6e-6, 20e3, x['D'], x['iL0_S2_first'])
            self.assertAlmostEqual(i_end, x['iL0_S2_first'], places=6)
            self.assertAlmostEqual(mean, x['IL'], places=6)
            self.assertAlmostEqual(ripple, x['dI'], places=6)

    def test_control_and_system(self):
        c = self.r['control']
        self.assertAlmostEqual(c['drift_A_per_s'], 100 * 0.001 / 5.6e-6)
        self.assertAlmostEqual(c['transition']['t'], 5.6e-6 * 1600 / (100 * 0.05))
        s = self.r['system']
        self.assertAlmostEqual(s['P_src_max'], 49e3)
        self.assertAlmostEqual(s['min_discharge_at_max_load'], 11e3)
        self.assertGreater(s['swing_kJ'], 0)


class BelowCase(unittest.TestCase):
    def test_interior_extrema(self):
        r = solve({'position': 'below'})
        q = r['q4']
        self.assertAlmostEqual(q['ripple_max']['vst'], 25)       # V_bus / 2
        self.assertAlmostEqual(q['relative_max']['vst'], 100 / 3)  # 2 V_bus / 3
        self.assertEqual([m['name'] for m in r['q3']['modes']], ['Boost', 'Buck'])
        t = {x['id']: x for x in r['q5']['tests']}
        self.assertEqual((r['config']['vst_min'], r['config']['vst_max']), (25, 40))   # μπαταρία 25–40 V
        self.assertAlmostEqual(t['Α']['IL'], 1600)
        self.assertAlmostEqual(q['L_min'] * 1e6, 1.54321, places=4)
        self.assertEqual(t['Ζ']['covered_by'], ['Α', 'Δ'])   # μέγιστη Δi στα 25 V = άκρο παραθύρου
        self.assertIsNone(t['Η']['covered_by'])               # μέγιστη σχετική κυμάτωση στα 33,3 V

    def test_invalid_window(self):
        with self.assertRaises(InputError):
            config({'position': 'above', 'vst_min': 50, 'vst_mid': 70, 'vst_max': 90})
        with self.assertRaises(InputError):
            config({'position': 'below', 'vst_min': 20, 'vst_mid': 40, 'vst_max': 49.5})

    def test_op_consistency(self):
        c = config({})
        o = op(c, 50, 80, -40e3)
        self.assertAlmostEqual(o['IL'] * o['vlo'], 40e3)          # charging: bus -> storage
        self.assertAlmostEqual(o['IS1_avg'] * o['vhi'], 40e3)     # high-side average current


if __name__ == '__main__':
    unittest.main(verbosity=2)
