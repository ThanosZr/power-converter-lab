"""Analytic bundle for circuits drawn in the studio: recognition from wiring and region test."""
import unittest

from engine.studio_math import studio_math, region_steps

SRC, SW, D, L, C, R = 'V1', 'S1', 'D1', 'L1', 'C1', 'R1'
COMPS = [{'id': SRC, 'type': 'source'}, {'id': SW, 'type': 'switch'}, {'id': D, 'type': 'diode'},
         {'id': L, 'type': 'inductor'}, {'id': C, 'type': 'capacitor'}, {'id': R, 'type': 'resistor'}]


def nets_to_wires(nets):
    return [{'from': n[0], 'to': p} for n in nets for p in n[1:]]


CIRCUITS = {
    'buck': [['V1:p', 'S1:a'], ['S1:b', 'D1:k', 'L1:a'], ['L1:b', 'C1:p', 'R1:a'], ['V1:n', 'D1:a', 'C1:n', 'R1:b']],
    'boost': [['V1:p', 'L1:a'], ['L1:b', 'S1:a', 'D1:a'], ['D1:k', 'C1:p', 'R1:a'], ['V1:n', 'S1:b', 'C1:n', 'R1:b']],
    # capacitor drawn with + on the negative output: still recognised
    'buck_boost': [['V1:p', 'S1:a'], ['S1:b', 'D1:k', 'L1:a'], ['D1:a', 'C1:p', 'R1:a'], ['V1:n', 'L1:b', 'C1:n', 'R1:b']],
}


class StudioMath(unittest.TestCase):
    def solve(self, topo, **p):
        params = {'vin': 24, 'fs': 100e3, 'L': 100e-6, 'C': 100e-6, 'D': .5, 'R': 10, **p}
        return studio_math({'circuit': {'components': COMPS, 'wires': nets_to_wires(CIRCUITS[topo])}, 'params': params})

    def test_recognition_from_wiring(self):
        for topo in CIRCUITS:
            r = self.solve(topo)
            self.assertEqual(r['recognized']['topology'], topo)
            for key in ('derivation', 'curves', 'linearize', 'proof'):
                self.assertNotIn('error', r[key], (topo, key))
        self.assertTrue(self.solve('buck_boost')['notes'])          # reversed capacitor is reported

    def test_region_and_substitution(self):
        ccm, dcm = self.solve('buck'), self.solve('buck', R=50)
        self.assertEqual((ccm['region']['mode'], dcm['region']['mode']), ('CCM', 'DCM'))
        self.assertEqual(dcm['steady']['mode'], 'DCM')
        self.assertAlmostEqual(dcm['region']['M'] * 24, dcm['steady']['config']['vo'], places=6)
        self.assertTrue(all('numeric' in s for s in ccm['region']['steps']))

    def test_flyback_dcm_ratio(self):
        r = region_steps('flyback', .4, 24, 200e-6, 100e3, 40, .5)
        self.assertEqual(r['mode'], 'DCM')
        self.assertAlmostEqual(r['M'] * 24, 24 * .4 * (40 / (2 * 200e-6 * 100e3)) ** .5, places=9)


if __name__ == '__main__':
    unittest.main(verbosity=2)
