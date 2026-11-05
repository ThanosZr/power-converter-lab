"""New tutorials (voltage loop, thyristor bridges, flyback clamp, real switches) against theory, via Node."""
import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

CASES = Path(__file__).resolve().parent / 'js' / 'tutorial_cases.js'


@unittest.skipIf(shutil.which('node') is None, 'Node.js not installed; the browser runs the same files.')
class Tutorials(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(['node', str(CASES)], capture_output=True, text=True, timeout=600)
        if run.returncode:
            raise RuntimeError(run.stderr)
        cls.o = json.loads(run.stdout)

    def test_voltage_loop_pi_vs_pid(self):
        pi, pid = self.o['vloop_pi'], self.o['vloop_pid']
        for r in (pi, pid):
            self.assertAlmostEqual(r['vo_end'], 15, delta=0.05)
            self.assertLess(r['os'], 2)
            self.assertTrue(r['load_disturbance'])
        self.assertLess(pid['ts'], pi['ts'] / 4)                                 # PID settles much faster
        self.assertLess(pid['iae'], pi['iae'] / 2)
        self.assertLess(pid['load_dev'], pi['load_dev'])

    def test_single_phase_thyristor_bridge(self):
        vpk = 230 * math.sqrt(2)
        for a in (0, 60, 90):
            ar = math.radians(a)
            self.assertAlmostEqual(self.o[f'scr1_r_{a}']['vd'], vpk / math.pi * (1 + math.cos(ar)), delta=0.3)
        self.assertAlmostEqual(self.o['scr1_rl_60']['vd'], 2 * vpk / math.pi * .5, delta=0.3)

    def test_three_phase_bridge(self):
        vd0 = 3 * math.sqrt(3) / math.pi * 325
        for dev, a in (('diode', 0), ('30', 30), ('60', 60)):
            for load in ('r', 'rl'):
                self.assertAlmostEqual(self.o[f'b3_{dev}_{load}']['vR'], vd0 * math.cos(math.radians(a)), delta=0.002 * vd0)
        r = self.o['b3_diode_rl']
        self.assertAlmostEqual(r['ia_rms'], math.sqrt(2 / 3) * r['id'], delta=0.01 * r['id'])

    def test_flyback_leakage_clamp(self):
        c, i = self.o['fly_clamp'], self.o['fly_ideal']
        self.assertGreater(c['vsw_max'], i['vsw_max'] + 10)                       # leakage spike, clamped
        self.assertAlmostEqual(c['vsw_max'], 24 + c['vc'], delta=2)
        vr = c['vo'] / .5
        p = .5 * 4e-6 * c['im_pk'] ** 2 * 100e3 * c['vc'] / (c['vc'] - vr)
        self.assertAlmostEqual(c['prc'], p, delta=0.15 * p)

    def test_real_switches_losses(self):
        r = self.o['bat_real_pi']
        self.assertAlmostEqual(r['il'], 800, delta=5)
        self.assertAlmostEqual(r['psw1'] + r['psw2'], 20e3 * 2.1e-3, delta=5)    # one hard-switched device
        self.assertGreater(r['p1'] + r['p2'], 500)                                # I²R + body diodes
        self.assertLess(abs(self.o['bat_real_fixed']['il']), 790)                 # open loop drifts away


if __name__ == '__main__':
    unittest.main(verbosity=2)
