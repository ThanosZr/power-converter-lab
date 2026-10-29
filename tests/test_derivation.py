import json
import unittest
import numpy as np
from engine.analysis import InputError,steady
from engine.derivation import derive
from engine.problem import solve_problem
from engine.proof import model_proof

BASE={'topology':'flyback','vin':24,'vo':12,'power':24,'fs':100000,
      'L':100e-6,'C':100e-6,'n':.5,'voltage_ripple':.1}


class RippleDerivation(unittest.TestCase):
    def test_flyback_currents_and_current_capacitor_ripple(self):
        a=derive(BASE)
        self.assertAlmostEqual(a['metrics']['Iout'],2)
        self.assertAlmostEqual(a['metrics']['Ivalley'],1.4)
        self.assertAlmostEqual(a['metrics']['Ipeak'],2.6)
        self.assertAlmostEqual(a['intervals'][0]['iC_start'],-2)
        self.assertAlmostEqual(a['intervals'][1]['iC_start'],3.2)
        self.assertAlmostEqual(a['intervals'][1]['iC_end'],.8)
        self.assertAlmostEqual(a['charge_pp'],10e-6)
        self.assertAlmostEqual(a['metrics']['Vripple_pp'],.1)
        self.assertAlmostEqual(a['sizing']['C_min'],100e-6)
        self.assertTrue(a['sizing']['meets_target'])

    def test_current_zero_inside_off_changes_capacitor_requirement(self):
        a=derive({**BASE,'L':40e-6})
        self.assertAlmostEqual(a['charge_pp']*1e6,10.41666666667)
        self.assertAlmostEqual(a['sizing']['C_min']*1e6,104.16666666667)
        roots=[p for p in a['charge_extrema'] if p['kind']=='iC=0']
        self.assertEqual(len(roots),1)
        self.assertAlmostEqual(roots[0]['t_us'],9.166666666667)
        # An ON-only Io*D/fs shortcut would miss the additional charge.
        shortcut=a['metrics']['Iout']*a['metrics']['duty']/BASE['fs']
        self.assertGreater(a['charge_pp'],shortcut)

    def test_original_boost_diode_waveform_reference(self):
        # T=10 us, iD=0 for 7 us, then 10 A→0 A over 3 us.
        a=derive({**BASE,'topology':'boost','vin':12,'vo':40,'power':60,'L':8.4e-6})
        self.assertEqual(a['mode'],'BCM')
        self.assertAlmostEqual(a['intervals'][0]['end_us'],7)
        self.assertAlmostEqual(a['metrics']['Iout'],1.5)
        self.assertAlmostEqual(a['charge_pp']*1e6,10.8375)
        self.assertAlmostEqual(a['sizing']['C_min']*1e6,108.375)

    def test_all_families_and_modes_match_charge_integral(self):
        for key,vin,vo in [('buck',24,12),('boost',12,24),('buck_boost',8,12),('flyback',24,12)]:
            for inductance in (1e-6,100e-6):
                a=derive({**BASE,'topology':key,'vin':vin,'vo':vo,'L':inductance})
                q=a['charge_waveform'];t=np.array(q['t_us'])*1e-6
                mean=np.trapezoid(q['iC_A'],t)/(t[-1]-t[0])
                self.assertAlmostEqual(mean,0,delta=1e-8)
                self.assertAlmostEqual((max(q['q_uC'])-min(q['q_uC']))*1e-6,a['charge_pp'])
                check=steady({**a['config'],'C':a['sizing']['C_min']},False,False)
                self.assertAlmostEqual(check['metrics']['Vripple_pp'],.1)

    def test_numeric_substitution_and_model_proof_are_exportable(self):
        a=derive(BASE)
        self.assertIn('24.0/12.0',a['current_steps'][0]['numeric']['text'])
        self.assertIn('10.0/0.1',a['ripple_steps'][-1]['numeric']['text'])
        self.assertTrue(all('numeric' in s for s in a['ripple_steps']))
        json.dumps(a,allow_nan=False)
        for value in (0,-1):
            with self.assertRaises(InputError):derive({**BASE,'voltage_ripple':value})

    def test_capacitor_goal_expands_the_worst_case_solution(self):
        p=solve_problem({**BASE,'target':'C','axes':[{'field':'vin','min':16,'max':32,'points':11}], 'voltage_ripple':.05})
        self.assertIn('derivation',p)
        self.assertAlmostEqual(p['selected_value'],p['derivation']['sizing']['C_min'])
        self.assertTrue(any(s.get('numeric') for s in p['steps']))
        selected=solve_problem({**BASE,'target':'point','outputs':['Iripple_pp','ICrms','ISrms','IDmean']})
        self.assertEqual(len(selected['outputs']),4)
        self.assertTrue(all(o['value']>=0 for o in selected['outputs']))


class TransferModelProof(unittest.TestCase):
    def test_ccm_dcm_and_boundary_derivations(self):
        for key,vin,vo in [('buck',24,12),('boost',12,24),('buck_boost',8,12),('flyback',24,12)]:
            for inductance in (1e-6,100e-6):
                a=model_proof({**BASE,'topology':key,'vin':vin,'vo':vo,'L':inductance})
                self.assertTrue(a['transfer']['available'])
                titles=' '.join(s['title'] for s in a['steps'])
                self.assertIn('KVL/KCL',titles);self.assertIn('Γραμμικοποίηση',titles)
                self.assertIn('Laplace',titles);self.assertIn('Χαρακτηριστικό',titles)
                self.assertIn('Αντικατάσταση',titles)
                json.dumps(a,allow_nan=False)
        boundary=model_proof({**BASE,'L':30e-6})
        self.assertFalse(boundary['transfer']['available'])
        self.assertIn('δύο γειτονικοί',boundary['steps'][-1]['title'])


if __name__=='__main__':unittest.main(verbosity=2)
