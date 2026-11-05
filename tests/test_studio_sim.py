"""Studio simulator (web/studio/mna.js) against closed-form results, via Node."""
import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

CASES = Path(__file__).resolve().parent / 'js' / 'sim_cases.js'


@unittest.skipIf(shutil.which('node') is None, 'Node.js not installed; the browser runs the same file.')
class StudioSimulator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run(['node', str(CASES)], capture_output=True, text=True, timeout=600)
        if run.returncode:
            raise RuntimeError(run.stderr)
        cls.o = json.loads(run.stdout)

    def test_buck_ccm(self):
        r = self.o['buck_ccm']
        self.assertAlmostEqual(r['vo'], 12, delta=0.01)                        # Vo = D Vin
        self.assertAlmostEqual(r['il']['pp'], (24 - 12) * .5 / (100e-6 * 100e3), delta=0.002)

    def test_buck_dcm(self):
        K = 2 * 10e-6 / (50 / 100e3)
        vo = 24 * 2 / (1 + math.sqrt(1 + 4 * K / .3 ** 2))
        self.assertAlmostEqual(self.o['buck_dcm']['vo'], vo, delta=0.02)
        self.assertAlmostEqual(self.o['buck_dcm']['ilmin'], 0, delta=1e-3)    # current rests at zero

    def test_boost_dcm(self):
        K = 2 * 10e-6 / (100 / 50e3)
        vo = 12 * (1 + math.sqrt(1 + 4 * .3 ** 2 / K)) / 2
        self.assertAlmostEqual(self.o['boost_dcm']['vo'], vo, delta=0.05)

    def test_flyback_ccm(self):
        self.assertAlmostEqual(self.o['flyback']['vo'], 24 * .5 * .4 / .6, delta=0.03)

    def test_bridge_rectifier_battery(self):
        vpk, E, R = 230 * math.sqrt(2), 200, 2
        a = math.asin(E / vpk)
        iavg = (2 * vpk * math.cos(a) - E * (math.pi - 2 * a)) / (math.pi * R)
        self.assertAlmostEqual(self.o['rectifier']['iavg'], iavg, delta=0.01 * iavg)
        self.assertAlmostEqual(self.o['rectifier']['ipk'], (vpk - E) / R, delta=0.3)

    def test_bidirectional_matches_pe2(self):
        r = self.o['bidir_open']
        self.assertAlmostEqual(r['iavg'], -800, delta=1)
        self.assertAlmostEqual(r['ripple'], 223.2143, delta=0.05)
        self.assertAlmostEqual(r['pbus'], 40e3, delta=40)
        self.assertAlmostEqual(self.o['bidir_pi']['at5ms'], -800, delta=2)
        self.assertAlmostEqual(self.o['bidir_pi']['at10ms'], 800, delta=2)

    def test_bidirectional_system_load_step(self):
        r = self.o['bidir_system']
        self.assertAlmostEqual(r['vbus_before'], (50 + math.sqrt(50 ** 2 - 4e-3 * 20e3)) / 2, delta=0.08)
        self.assertAlmostEqual(r['isrc_after'], 0, delta=1e-3)                # unidirectional source blocks
        self.assertGreater(r['vbus_after'], 51)


if __name__ == '__main__':
    unittest.main(verbosity=2)


@unittest.skipIf(shutil.which('node') is None, 'Node.js not installed; the browser runs the same file.')
class IntegrationMethods(unittest.TestCase):
    """Gear/BDF2 and backward Euler reproduce the same closed-form results."""
    def run_method(self, method):
        import os
        env = dict(os.environ, PCL_METHOD=method)
        run = subprocess.run(['node', str(CASES)], capture_output=True, text=True, timeout=600, env=env)
        if run.returncode:
            raise RuntimeError(run.stderr)
        return json.loads(run.stdout)

    def test_bdf2_and_backward_euler(self):
        K = 2 * 10e-6 / (50 / 100e3)
        vdcm = 24 * 2 / (1 + math.sqrt(1 + 4 * K / .3 ** 2))
        for method, tol in (('BDF2', 2e-3), ('BE', 5e-3)):
            o = self.run_method(method)
            self.assertAlmostEqual(o['buck_ccm']['vo'], 12, delta=12 * tol)
            self.assertAlmostEqual(o['buck_ccm']['il']['pp'], .6, delta=.6 * tol)
            self.assertAlmostEqual(o['buck_dcm']['vo'], vdcm, delta=vdcm * tol)
            self.assertAlmostEqual(o['flyback']['vo'], 8, delta=8 * tol)
            self.assertAlmostEqual(o['bidir_open']['ripple'], 223.2143, delta=223 * tol)
            self.assertAlmostEqual(o['bidir_pi']['at10ms'], 800, delta=4)
