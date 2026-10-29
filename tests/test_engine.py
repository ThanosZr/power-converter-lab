"""Physical regression tests, independent known answers and ODE checks."""
import json
import math
import unittest
import numpy as np
import sympy as sp
from engine.analysis import steady,inverse,InputError
from engine.design import envelope,size_components
from engine.dynamics import linearize,switching
from engine.models import symbolic_model,VIN,D,L,C,R,S,N
from engine.workbench import sweep,capacitance,transition_sweep

BASE={'topology':'buck_boost','vin':8,'vo':12,'power':24,'fs':100000,'L':20e-6,'C':100e-6,'n':.5}


class KnownAnswers(unittest.TestCase):
    def test_exam_endpoints_and_all_input_range(self):
        expected=[(8,.6,4.8e-6,10.),(24,1/3,13.333333333333e-6,6.)]
        for vin,d,lc,ipk in expected:
            a=steady({**BASE,'vin':vin,'L':lc})
            self.assertEqual(a['mode'],'BCM')
            self.assertAlmostEqual(a['metrics']['duty'],d)
            self.assertAlmostEqual(a['metrics']['Ipeak'],ipk)
            self.assertAlmostEqual(a['metrics']['Ivalley'],0)
        env=envelope({**BASE,'vin_min':8,'vin_max':24})
        self.assertAlmostEqual(env['max_Lcrit'],13.333333333333e-6)
        self.assertEqual(env['worst_vin'],24)
        self.assertTrue(env['strict_ccm_everywhere'])

    def test_flyback_boundary_reference(self):
        a=steady({**BASE,'topology':'flyback','vin':24,'L':30e-6})
        m=a['metrics']
        self.assertEqual(a['mode'],'BCM')
        self.assertAlmostEqual(m['duty'],.5)
        self.assertAlmostEqual(m['Ipeak'],4)
        self.assertAlmostEqual(m['IDmean'],2)
        self.assertAlmostEqual(m['Vswitch'],48)
        self.assertAlmostEqual(m['Vdiode_reverse'],24)

    def test_buck_ripple_and_rms(self):
        m=steady({**BASE,'topology':'buck','vin':24,'L':100e-6})['metrics']
        self.assertAlmostEqual(m['Iripple_pp'],.6)
        self.assertAlmostEqual(m['ICrms'],.6/math.sqrt(12))
        self.assertAlmostEqual(m['Vripple_pp'],.6/(8*100000*100e-6))
        self.assertAlmostEqual(m['ILrms'],math.sqrt(4+.6**2/12))

    def test_internal_boost_extremum(self):
        # Lcrit(Vin) ∝ Vin²(Vo−Vin): maximum is at 2Vo/3, not the ends.
        e=envelope({**BASE,'topology':'boost','vo':24,'vin_min':4,'vin_max':23})
        self.assertAlmostEqual(e['worst_vin'],16)
        self.assertAlmostEqual(e['max_Lcrit'],24*(4/27)/(2*100000))


class RegimeConsistency(unittest.TestCase):
    cases=[('buck',24,12),('boost',12,24),('buck_boost',8,12),('flyback',24,12)]

    def test_modes_continuity_balance_and_diode_rms(self):
        for key,vin,vo in self.cases:
            c={**BASE,'topology':key,'vin':vin,'vo':vo}
            bc=steady(c,False,False)['metrics']['Lcrit']
            for factor in [.1,.5,1,2,20]:
                a=steady({**c,'L':bc*factor})
                m=a['metrics']
                with self.subTest(key=key,factor=factor):
                    self.assertLess(abs(m['power_balance_W']),1e-9)
                    self.assertLess(abs(m['charge_balance_A']),1e-9)
                    self.assertLessEqual(m['duty']+m['delta'],1+1e-10)
                    self.assertGreaterEqual(m['Ivalley'],0)
                    self.assertGreaterEqual(m['ICrms'],0)
                    if factor<1:
                        self.assertEqual(a['mode'],'DCM')
                        self.assertGreater(m['idle'],0)
                    if key=='flyback':
                        self.assertAlmostEqual(m['IDrms'],m['ILrms']*math.sqrt(m['delta']/(m['duty']+m['delta']))/c['n'])
            below=steady({**c,'L':bc*(1-1e-5)},False,False)['metrics']
            at=steady({**c,'L':bc},False,False)['metrics']
            self.assertAlmostEqual(below['duty'],at['duty'],delta=1e-5)
            self.assertAlmostEqual(below['Ipeak'],at['Ipeak'],delta=1e-3)

    def test_numeric_integrals_match_reported(self):
        # Independent fine-grid integration of exported waveforms.
        for key,vin,vo in self.cases:
            a=steady({**BASE,'topology':key,'vin':vin,'vo':vo,'L':2e-6})
            w=a['waveforms'];t=np.array(w['t_us'])*1e-6
            for sig,metric in [('iL','ILrms'),('iS','ISrms'),('iD','IDrms'),('iC','ICrms')]:
                rms=math.sqrt(np.trapezoid(np.array(w[sig])**2,t)/(t[-1]-t[0]))
                self.assertAlmostEqual(rms,a['metrics'][metric],delta=.003*max(1,rms))

    def test_component_sizing_meets_constraints(self):
        for key,vin,vo in self.cases:
            low,high=(15,30) if key=='buck' else (4,23) if key=='boost' else (8,24)
            c={**BASE,'topology':key,'vin':vin,'vo':vo,'vin_min':low,'vin_max':high}
            d=size_components(c)
            for v in np.linspace(low,high,53):
                a=steady({**c,'L':d['L'],'C':d['C'],'vin':float(v)},False,False)
                m=a['metrics']
                self.assertEqual(a['mode'],'CCM')
                self.assertLessEqual(m['Iripple_pp']/m['ILmean'],.400001)
                self.assertLessEqual(m['Vripple_pp'],.100001)


class SymbolicDynamics(unittest.TestCase):
    def test_buck_transfer_from_interval_jacobians(self):
        g=symbolic_model('buck')['Gvd']
        expected=VIN/(L*C*S*S+L*S/R+1)
        self.assertEqual(sp.simplify(g-expected),0)

    def test_dc_gain_matches_derivative_of_equilibrium(self):
        for key in ['buck','boost','buck_boost','flyback']:
            model=symbolic_model(key)
            expected=sp.diff(model['gain']*VIN,D)
            self.assertEqual(sp.simplify(model['Gvd'].subs(S,0)-expected),0)

    def test_rhp_zero_and_cpl_poles(self):
        for key in ['boost','buck_boost','flyback']:
            c={**BASE,'topology':key,'vin':12 if key=='boost' else 24,'vo':24 if key=='boost' else 12,'L':100e-6}
            g=linearize(c)
            self.assertTrue(g['available'])
            self.assertTrue(any(z['real']>0 for z in g['zeros']))
            self.assertTrue(g['stable'])
            g=linearize({**c,'load':'constant_power'})
            self.assertFalse(g['stable'])
        self.assertTrue(linearize({**BASE,'L':1e-6})['available'])
        self.assertFalse(linearize({**BASE,'L':4.8e-6})['available'])

    def test_inverse_and_missing_data(self):
        for target,known,answer in [('duty',{'vin':8,'vo':12},.6),('vin',{'duty':.6,'vo':12},8),('vo',{'vin':8,'duty':.6},12)]:
            a=inverse({'topology':'buck_boost','unknown':target,'known':known})
            self.assertEqual(a['status'],'solved')
            self.assertAlmostEqual(a['solutions'][0]['value'],answer)
        a=inverse({'topology':'flyback','unknown':'L','relation':'boundary','known':{'vin':24,'vo':12,'n':.5,'power':24,'fs':1e5}})
        # Boundary relation also requires D; do not silently infer extra relations.
        self.assertEqual(a['status'],'underdetermined')
        a=inverse({'topology':'flyback','unknown':'L','relation':'boundary','known':{'duty':.5,'vo':12,'n':.5,'power':24,'fs':1e5}})
        self.assertAlmostEqual(a['solutions'][0]['value'],30e-6)
        self.assertEqual(inverse({'known':{'vin':8}})['status'],'underdetermined')


class IndependentSwitching(unittest.TestCase):
    def test_ccm_and_dcm_ode_agreement(self):
        for key,vin,vo in RegimeConsistency.cases:
            c={**BASE,'topology':key,'vin':vin,'vo':vo,'C':47e-6}
            lc=steady(c,False,False)['metrics']['Lcrit']
            for factor in [.4,4]:
                with self.subTest(key=key,factor=factor):
                    a=switching({**c,'L':lc*factor,'cycles':800})
                    self.assertLess(abs(a['target_error_percent']),1.2)
                    self.assertGreaterEqual(min(a['waveforms']['iL']),-1e-7)
                    self.assertTrue(a['settled'],a['periodic_residual'])

    def test_load_step_changes_unregulated_output(self):
        c={**BASE,'topology':'buck_boost','L':2e-6,'C':47e-6,'cycles':600,'load_step':1.5}
        a=switching(c)
        self.assertLess(a['average_vo'],11)
        self.assertTrue(a['settled'])


class Validation(unittest.TestCase):
    def test_bad_inputs(self):
        for patch in [{'L':0},{'vin':float('nan')},{'C':-1},{'power':True},{'topology':'anything'},
                      {'topology':'buck','vin':8,'vo':12},{'topology':'boost','vin':24,'vo':12}]:
            with self.subTest(patch=patch),self.assertRaises(InputError):
                steady({**BASE,**patch})
        with self.assertRaises(InputError):envelope({**BASE,'vin_min':24,'vin_max':8})

    def test_results_are_strict_json(self):
        c={**BASE}
        for fn in (steady,envelope,size_components,linearize):
            json.dumps(fn(c),allow_nan=False)


class CustomProblems(unittest.TestCase):
    def test_flyback_sweep_depends_on_inductance_not_forced_colors(self):
        axes=[{'field':'vin','min':16.512,'max':24.768,'points':41},
              {'field':'vo','min':10.944,'max':16.416,'points':41}]
        c={**BASE,'topology':'flyback','vin':20.64,'vo':13.68,'L':100e-6}
        continuous=sweep({**c,'axes':axes})
        self.assertEqual(continuous['mode_counts'],{'CCM':1681,'BCM':0,'DCM':0})
        self.assertGreater(continuous['regime_diagnostics']['min_L_margin'],1)
        discontinuous=sweep({**c,'L':10e-6,'axes':axes})
        self.assertEqual(discontinuous['mode_counts'],{'CCM':0,'BCM':0,'DCM':1681})
        self.assertLess(discontinuous['regime_diagnostics']['max_L_margin'],1)

    def test_transition_demo_crosses_boundary_in_all_families(self):
        for key,vin,vo in RegimeConsistency.cases:
            for drive in ('regulated','fixed_duty'):
                c=steady({**BASE,'topology':key,'vin':vin,'vo':vo,'L':2e-6,
                          'drive':drive,'duty_set':.5,'resistance':6},False,False)['config']
                experiment=transition_sweep(c)
                result=sweep({**c,'axes':experiment['axes']})
                with self.subTest(topology=key,drive=drive):
                    self.assertEqual(result['mode_counts'],{'CCM':10,'BCM':1,'DCM':10})
        c=steady({**BASE,'drive':'fixed_duty','load':'constant_power'},False,False)['config']
        self.assertIsNone(transition_sweep(c))

    def test_capacitor_sweep_changes_ripple_not_ideal_regime(self):
        c={**BASE,'topology':'flyback','vin':24,'L':10e-6}
        result=sweep({**c,'axes':[{'field':'C','min':50e-6,'max':150e-6,'points':11}]})
        self.assertEqual(result['mode_counts']['DCM'],11)
        self.assertAlmostEqual(result['points'][0]['ripple']/result['points'][-1]['ripple'],3)

    def test_fixed_duty_resistive_inverse_in_all_regimes(self):
        for key,vin,vo in RegimeConsistency.cases:
            c={**BASE,'topology':key,'vin':vin,'vo':vo}
            lc=steady(c,False,False)['metrics']['Lcrit']
            for factor in [.2,1,5]:
                a=steady({**c,'L':lc*factor},False,False)
                b=steady({**c,'L':lc*factor,'drive':'fixed_duty',
                         'duty_set':a['metrics']['duty'],'resistance':a['metrics']['R']},False,False)
                with self.subTest(key=key,factor=factor):
                    self.assertEqual(a['mode'],b['mode'])
                    self.assertAlmostEqual(b['config']['vo'],vo)
                    self.assertAlmostEqual(b['config']['power'],c['power'])
                    self.assertAlmostEqual(b['metrics']['duty'],a['metrics']['duty'])

    def test_fixed_duty_cpl_is_not_falsely_determined(self):
        for key in ('buck_boost','flyback'):
            with self.assertRaisesRegex(InputError,'δεν προσδιορίζεται μοναδικά'):
                steady({**BASE,'topology':key,'drive':'fixed_duty','duty_set':.5,'L':1e-6,'load':'constant_power'})
            # Exact energy equality: even the nominal BCM point belongs to a
            # continuum of possible output voltages, not one unique solution.
            with self.assertRaisesRegex(InputError,'δεν προσδιορίζεται μοναδικά'):
                steady({**BASE,'topology':key,'drive':'fixed_duty','duty_set':.5,'L':1e-6,'power':80,'load':'constant_power'})

    def test_fixed_duty_cpl_buck_and_boost_dcm_roundtrip(self):
        for key,vin,vo in [('buck',24,12),('boost',12,24)]:
            c={**BASE,'topology':key,'vin':vin,'vo':vo,'L':1e-6,'load':'constant_power'}
            a=steady(c,False,False)
            b=steady({**c,'drive':'fixed_duty','duty_set':a['metrics']['duty']},False,False)
            self.assertEqual(b['mode'],'DCM')
            self.assertAlmostEqual(b['config']['vo'],vo)

    def test_two_variable_inputs_outputs_and_invalid_regions(self):
        axes=[{'field':'vin','min':8,'max':24,'points':11},{'field':'vo','min':8,'max':16,'points':11}]
        a=sweep({**BASE,'axes':axes})
        self.assertEqual(len(a['points']),121)
        self.assertEqual(len(a['invalid']),0)
        for p in a['points']:
            self.assertAlmostEqual(p['duty'],p['vo']/(p['vin']+p['vo']))
        b=sweep({**BASE,'topology':'buck','axes':axes})
        self.assertGreater(len(b['invalid']),0)
        self.assertGreater(len(b['points']),0)
        with self.assertRaisesRegex(InputError,'Vo είναι αποτέλεσμα'):
            sweep({**BASE,'drive':'fixed_duty','axes':axes})

    def test_custom_fixed_duty_load_sweep(self):
        axes=[{'field':'vin','min':8,'max':24,'points':11},{'field':'resistance','min':3,'max':12,'points':11}]
        a=sweep({**BASE,'drive':'fixed_duty','duty_set':.5,'axes':axes})
        self.assertEqual(len(a['points']),121)
        for p in a['points']:
            self.assertAlmostEqual(p['duty'],.5)

    def test_capacitor_given_ripple_and_ripple_given_capacitor(self):
        a=capacitance({**BASE,'voltage_ripple':.1})
        b=steady({**BASE,'C':a['C_required']},False,False)
        self.assertAlmostEqual(b['metrics']['Vripple_pp'],.1)
        esr=capacitance({**BASE,'voltage_ripple':.2,'ESR':.001})
        self.assertGreater(esr['esr_ripple_bound'],0)
        with self.assertRaisesRegex(InputError,'ESR μόνο του'):
            capacitance({**BASE,'voltage_ripple':.01,'ESR':1})
        check=capacitance({**BASE,'task':'check','voltage_ripple':.01,'ESR':1})
        self.assertIsNone(check['C_required'])
        self.assertGreater(check['total_ripple_bound_existing'],.01)

    def test_symbolic_capacitor_and_frequency_unknowns(self):
        a=inverse({'relation':'charge_ripple','unknown':'C','known':{'charge_pp':12e-6,'voltage_ripple':.1}})
        self.assertAlmostEqual(a['solutions'][0]['value'],120e-6)
        b=inverse({'relation':'current_ripple','unknown':'fs','known':{'vin':8,'duty':.6,'L':20e-6,'current_ripple':2.4}})
        self.assertAlmostEqual(b['solutions'][0]['value'],100000)
        boundary=inverse({'relation':'boundary_operating','topology':'flyback','unknown':'L','known':{'vin':24,'vo':12,'power':24,'fs':100000,'n':.5}})
        self.assertAlmostEqual(boundary['solutions'][0]['value'],30e-6)
        ripple=inverse({'relation':'current_ripple_ccm','topology':'buck','unknown':'L','known':{'vin':24,'vo':12,'current_ripple':.6,'fs':100000}})
        self.assertAlmostEqual(ripple['solutions'][0]['value'],100e-6)


if __name__=='__main__':unittest.main(verbosity=2)
