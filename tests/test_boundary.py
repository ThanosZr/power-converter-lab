import unittest
from engine.boundary import solve_boundary

BASE={'topology':'flyback','vin':24,'vo':12,'power':24,'fs':100000,'L':100e-6,'n':.5}


class InverseBoundary(unittest.TestCase):
    def test_find_output_or_input_from_given_L_in_ccm(self):
        output=solve_boundary({**BASE,'unknown':'vo'})
        self.assertEqual(output['status'],'solved')
        self.assertAlmostEqual(output['solutions'][0]['value'],125.72670690062)
        self.assertAlmostEqual(output['solutions'][0]['duty'],.912870929175)
        source=solve_boundary({**BASE,'unknown':'vin'})
        self.assertAlmostEqual(source['solutions'][0]['value'],251.45341380124)
        for result in (output,source):
            self.assertEqual(result['solutions'][0]['mode'],'BCM')
            self.assertAlmostEqual(result['solutions'][0]['Ivalley'],0)

    def test_two_voltage_solutions_are_not_lost(self):
        result=solve_boundary({**BASE,'topology':'boost','vin':12,'vo':24,'L':10e-6,'unknown':'vin'})
        self.assertEqual(len(result['solutions']),2)
        values=[s['value'] for s in result['solutions']]
        self.assertAlmostEqual(values[0],8.66822069357)
        self.assertAlmostEqual(values[1],21.51020656769)
        self.assertTrue(all(s['mode']=='BCM' for s in result['solutions']))

    def test_no_solution_is_not_invented(self):
        result=solve_boundary({**BASE,'L':200e-6,'unknown':'vo'})
        self.assertEqual(result['status'],'no_physical_solution')
        self.assertEqual(result['solutions'],[])

    def test_previous_mode_and_irrelevant_values_do_not_constrain_target(self):
        for old_l in (1e-6,30e-6,100e-6):
            result=solve_boundary({**BASE,'L':old_l,'unknown':'L','C':0,'duty_set':0})
            self.assertAlmostEqual(result['solutions'][0]['value'],30e-6)
        # A nonunique fixed-duty CPL point is irrelevant to a new regulated BCM design.
        result=solve_boundary({**BASE,'unknown':'vo','drive':'fixed_duty','load':'constant_power','duty_set':.5,'L':1e-6})
        self.assertEqual(result['status'],'solved')

    def test_load_law_and_reverse_unknowns(self):
        result=solve_boundary({**BASE,'unknown':'vo','boundary_load':'resistance','resistance':6,'L':30e-6,'power':0})
        self.assertAlmostEqual(result['solutions'][0]['value'],12)
        for unknown in ('L','fs','n','power','resistance'):
            load='resistance' if unknown=='resistance' else 'power'
            result=solve_boundary({**BASE,'L':30e-6,'unknown':unknown,'boundary_load':load,'resistance':6})
            self.assertEqual(result['status'],'solved')
            self.assertTrue(all(s['relative_residual']<1e-7 for s in result['solutions']))


if __name__=='__main__':unittest.main(verbosity=2)
