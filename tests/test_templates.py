"""Solution templates as data (engine/templates.py, web/studio/exercises/*.template.json)."""
import json
import unittest
from pathlib import Path

from engine.core import InputError
from engine.templates import template_solve

EX = Path(__file__).resolve().parents[1] / 'web' / 'studio' / 'exercises'


def load(name):
    return json.loads((EX / name).read_text(encoding='utf-8'))


class DataTemplates(unittest.TestCase):
    def test_index_lists_valid_templates(self):
        idx = json.loads((EX / 'index.json').read_text(encoding='utf-8'))
        for f in idx['templates']:
            r = template_solve({'template': load(f), 'values': {}})
            self.assertTrue(r['sections'])

    def test_battery_above_matches_pe2(self):
        r = template_solve({'template': load('pe2_battery.template.json'), 'values': {'V_st': 100, 'P': 40e3}})
        v = r['values']
        self.assertAlmostEqual(v['D_0'], .5)
        self.assertAlmostEqual(v['I_L'], -800)
        self.assertAlmostEqual(v['Delta_i_L'], 223.2142857, places=5)
        self.assertAlmostEqual(v['K_p'], 3.4417e-4, delta=1e-8)                 # same as the tutorial's piGains
        self.assertAlmostEqual(v['K_i'], 0.45965, delta=1e-4)
        self.assertTrue(all(c['ok'] for c in r['checks']))
        steps = [s for sec in r['sections'] for b in sec['blocks'] if b['type'] == 'steps' for s in b['steps']]
        d0 = next(s for s in steps if s['id'] == 'D_0')
        self.assertIn('50/100', d0['numeric']['text'])                          # substitution shown, not just the result
        table = next(b for sec in r['sections'] for b in sec['blocks'] if b['type'] == 'table')
        self.assertEqual(len(table['rows']), 6)
        self.assertEqual(table['rows'][0][0], 'A+')

    def test_battery_below_uses_other_relations(self):
        r = template_solve({'template': load('pe2_battery.template.json'), 'values': {'V_st': 25, 'P': 40e3}})
        v = r['values']
        self.assertAlmostEqual(v['V_lo'], 25)
        self.assertAlmostEqual(v['I_L'], 1600)
        script = next(b for sec in r['sections'] for b in sec['blocks'] if b['type'] == 'script')['text']
        self.assertIn('D    = 0.5;', script)                                    # MATLAB decimals, not Greek commas

    def test_buck_template_switches_region(self):
        tpl = load('buck_design.template.json')
        ccm = template_solve({'template': tpl, 'values': {'R': 10}})['values']
        dcm = template_solve({'template': tpl, 'values': {'R': 50}})['values']
        self.assertAlmostEqual(ccm['M'], .5)
        K = 2 * 1e-4 * 1e5 / 50
        self.assertAlmostEqual(dcm['M'], 2 / (1 + (1 + 4 * K / .25) ** .5))
        self.assertNotIn('dV_o', dcm)                                           # CCM-only steps are skipped

    def test_expressions_are_restricted(self):
        base = {'schema': 'pcl-template-1', 'id': 'x', 'inputs': [{'name': 'a', 'value': 1}], 'sections': [{'blocks': []}]}
        for bad in ("__import__('os')", 'a.real', "a+'1'", 'b+1', 'a[0]', 'lambda: 1'):
            with self.assertRaises(InputError, msg=bad):
                template_solve({'template': {**base, 'steps': [{'id': 'y', 'expr': bad}]}, 'values': {}})
        with self.assertRaises(InputError):
            template_solve({'template': {**base, 'schema': 'other'}})


if __name__ == '__main__':
    unittest.main(verbosity=2)
