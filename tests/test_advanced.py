import copy
import unittest
import numpy as np
from engine.problem import solve_problem
from engine.circuit import PORTS,TEMPLATES,recognize,validated
from engine.curves import operating_curves
from engine.analysis import steady,InputError
from engine.dynamics import linearize

BASE={'topology':'flyback','vin':24,'vo':12,'power':24,'fs':100000,'L':30e-6,'C':100e-6,'n':.5,'load':'resistive','drive':'regulated'}


def graph(key):
    components=[];groups={}
    for kind,nodes in TEMPLATES[key].items():
        identifier=kind+'1';components.append({'id':identifier,'type':kind,'x':100.,'y':100.})
        for pin,node in zip(PORTS[kind],nodes):groups.setdefault(node,[]).append(identifier+':'+pin)
    wires=[{'from':pins[i],'to':pin} for pins in groups.values() for i,pin in enumerate(pins[1:])]
    return {'components':components,'wires':wires}


class GoalProblems(unittest.TestCase):
    def test_two_axis_extrema_and_strict_regions(self):
        axes=[{'field':'vin','min':16,'max':32,'points':11},{'field':'vo','min':8,'max':16,'points':11}]
        cc=solve_problem({**BASE,'axes':axes,'goal':'ccm_all'})
        self.assertAlmostEqual(cc['min']['Lcrit']*1e6,13.33333333333)
        self.assertAlmostEqual(cc['max']['Lcrit']*1e6,53.33333333333)
        dc=solve_problem({**BASE,'axes':axes,'goal':'dcm_all'})
        for vin in np.linspace(16,32,13):
            for vo in np.linspace(8,16,13):
                self.assertEqual(steady({**BASE,'vin':vin,'vo':vo,'L':cc['selected_value']},False,False)['mode'],'CCM')
                self.assertEqual(steady({**BASE,'vin':vin,'vo':vo,'L':dc['selected_value']},False,False)['mode'],'DCM')

    def test_interior_stationary_points_in_input_and_output(self):
        boost=solve_problem({**BASE,'topology':'boost','vin':12,'vo':24,'axes':[{'field':'vin','min':4,'max':23,'points':11}]})
        self.assertAlmostEqual(boost['max']['coordinates']['vin'],16)
        buck=solve_problem({**BASE,'topology':'buck','axes':[{'field':'vo','min':2,'max':23,'points':11}]})
        self.assertAlmostEqual(buck['max']['coordinates']['vo'],16)

    def test_boundary_everywhere_is_conditional(self):
        axes=[{'field':'vin','min':12,'max':48,'points':11}]
        impossible=solve_problem({**BASE,'axes':axes,'goal':'boundary_all'})
        self.assertFalse(impossible['feasible']);self.assertIsNone(impossible['selected_value'])
        possible=solve_problem({**BASE,'drive':'fixed_duty','duty_set':.5,'resistance':6,'axes':axes,'goal':'boundary_all'})
        self.assertTrue(possible['feasible'])
        self.assertAlmostEqual(possible['selected_value'],30e-6)
        for vin in [12,24,48]:
            a=steady({**BASE,'vin':vin,'drive':'fixed_duty','duty_set':.5,'resistance':6,'L':possible['selected_value']},False,False)
            self.assertEqual(a['mode'],'BCM')

    def test_invalid_whole_rectangle_is_rejected(self):
        with self.assertRaises(InputError):
            solve_problem({**BASE,'topology':'buck','axes':[{'field':'vin','min':8,'max':24,'points':11}]})
        with self.assertRaises(InputError):
            solve_problem({**BASE,'axes':[{'field':'L','min':1e-6,'max':100e-6,'points':11}]})

    def test_capacitor_and_selected_point_outputs_have_equations(self):
        a=solve_problem({**BASE,'target':'C','axes':[],'voltage_ripple':.1})
        check=steady({**BASE,'C':a['selected_value']},False,False)
        self.assertAlmostEqual(check['metrics']['Vripple_pp'],.1)
        b=solve_problem({**BASE,'target':'point','L':10e-6,'outputs':['Ipeak','duty','Vswitch']})
        self.assertEqual(len(b['outputs']),3)
        self.assertTrue(all('equation' in row for row in b['outputs']))


class ElectricalGraphs(unittest.TestCase):
    def test_renaming_positions_and_wire_order_do_not_change_physics(self):
        for key in TEMPLATES:
            g=graph(key);self.assertEqual(recognize(g)['topology'],key)
            for c in g['components']:c['x']+=432;c['y']-=123
            g['wires'].reverse()
            self.assertEqual(recognize(g)['topology'],key)

    def test_removed_wire_and_reversed_diode_do_not_run_old_formulas(self):
        for key in TEMPLATES:
            g=graph(key);g['wires'].pop()
            with self.assertRaises(InputError):recognize(g)
            g=graph(key)
            for wire in g['wires']:
                for field in ('from','to'):
                    if wire[field]=='diode1:a':wire[field]='diode1:k'
                    elif wire[field]=='diode1:k':wire[field]='diode1:a'
            with self.assertRaises(InputError):recognize(g)

    def test_detected_topology_overrides_stale_selection(self):
        # The actual graph is boost, even if the previous selected card was buck.
        a=validated(steady)({**BASE,'topology':'buck','vin':12,'vo':24,'circuit':graph('boost')})
        self.assertEqual(a['config']['topology'],'boost')


class DCMModelsAndCurves(unittest.TestCase):
    def test_dcm_dc_gain_matches_independent_steady_derivative(self):
        for key,vin,vo in [('buck',24,12),('boost',12,24),('buck_boost',8,12),('flyback',24,12)]:
            c={**BASE,'topology':key,'vin':vin,'vo':vo,'L':1e-6}
            a=steady(c,False,False);duty=a['metrics']['duty'];r=a['metrics']['R']
            tf=linearize(c);self.assertEqual(tf['mode'],'DCM')
            eps=duty*1e-5
            low=steady({**c,'drive':'fixed_duty','duty_set':duty-eps,'resistance':r},False,False)['config']['vo']
            high=steady({**c,'drive':'fixed_duty','duty_set':duty+eps,'resistance':r},False,False)['config']['vo']
            dc=tf['numerator'][0]/tf['denominator'][-1]
            self.assertAlmostEqual(dc,(high-low)/(2*eps),delta=abs(dc)*1e-6)

    def test_dcm_flyback_reference_pole_and_gain(self):
        c={**BASE,'L':10e-6};a=steady(c,False,False);tf=linearize(c)
        self.assertAlmostEqual(tf['poles'][0]['real'],-2/(a['metrics']['R']*c['C']))
        self.assertAlmostEqual(tf['numerator'][0]/tf['denominator'][-1],c['vo']/a['metrics']['duty'])
        self.assertFalse(linearize(BASE)['available'])

    def test_curves_distinguish_dcm_gain_and_ccm_reference(self):
        c={**BASE,'L':10e-6}
        result=operating_curves(c)
        dcm=[p for p in result['points'] if p['mode']=='DCM']
        ccm=[p for p in result['points'] if p['mode']=='CCM']
        self.assertTrue(dcm);self.assertTrue(ccm)
        self.assertTrue(any(abs(p['gain']-p['gain_ccm_reference'])>.1 for p in dcm))
        self.assertTrue(all(abs(p['gain']-p['gain_ccm_reference'])<1e-8 for p in ccm))
        self.assertEqual(len(result['boundary_duties']),1)


if __name__=='__main__':unittest.main(verbosity=2)
