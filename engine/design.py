"""Operating-envelope extrema and explicit ideal CCM component sizing."""
import math
import numpy as np
import sympy as sp
from .analysis import config,steady,number,InputError,math_record
from .models import symbolic_model,VIN,V,D,L,R,N,FS,P


def envelope(data):
    c=config(data)
    if c['drive']!='regulated':
        raise InputError('Ο συμβολικός έλεγχος Lcrit εδώ αφορά ρυθμιζόμενο Vo. Για σταθερό duty χρησιμοποιήστε το παραμετρικό εργαστήριο.')
    lower=number(data,'vin_min',8)
    upper=number(data,'vin_max',24)
    if upper<lower:
        raise InputError('Απαιτείται Vin_max ≥ Vin_min.')
    # Validate both endpoints before symbolic extrema or sampling.
    steady({**c,'vin':lower},False,False)
    steady({**c,'vin':upper},False,False)
    sym=symbolic_model(c['topology'])
    expr=sp.factor(sym['critical'].subs(D,sym['duty']).subs(R,V**2/P))
    values={V:c['vo'],P:c['power'],FS:c['fs'],N:c['n']}
    derivative=sp.factor(sp.diff(expr,VIN))
    roots=sp.solve(derivative.subs(values),VIN)
    candidates=[lower,upper]
    for root in roots:
        val=complex(root.evalf())
        if abs(val.imag)<1e-8 and lower<val.real<upper:
            candidates.append(val.real)
    max_at=max(candidates,key=lambda x:float(expr.subs({**values,VIN:x})))
    max_l=float(expr.subs({**values,VIN:max_at}))
    points=[]
    for v in np.linspace(lower,upper,81):
        a=steady({**c,'vin':float(v)},False,False)
        m=a['metrics']
        points.append({'vin':float(v),'Lcrit':m['Lcrit'],'duty':m['duty'],
                       'Ipeak':m['Ipeak'],'ripple':m['Vripple_pp'],'mode':a['mode']})
    return {'points':points,'max_Lcrit':max_l,'worst_vin':max_at,
            'critical_expression':math_record(sp.Eq(sp.Symbol('L_crit'),expr)),
            'derivative':math_record(derivative),'extrema_candidates':candidates,
            'strict_ccm_everywhere':c['L']>max_l*(1+1e-7),
            'scope':'Σταθερά |Vo|, Po, fs και n σε όλο το εύρος. Ο δυσμενέστερος Lcrit ελέγχεται στα άκρα και σε όλα τα εσωτερικά στάσιμα σημεία της συμβολικής συνάρτησης. Οι υπόλοιπες καμπύλες δειγματοληπτούνται σε 81 σημεία.'}


def size_components(data):
    c=config(data)
    env=envelope(data)
    margin=number(data,'ccm_margin',1.2,low=1,high=10)
    rr=number(data,'current_ripple_ratio',.4,high=2)
    target=number(data,'voltage_ripple',.1,high=c['vo'])
    lower,upper=env['points'][0]['vin'],env['points'][-1]['vin']
    sym=symbolic_model(c['topology'])
    duty=sym['duty']
    # Lripple = slope_numerator*D / (fs*ratio*Imean).
    mean=c['power']/c['vo'] if c['topology']=='buck' else (c['n'] if c['topology']=='flyback' else 1)*c['power']/c['vo']/(1-duty)
    numerator=(VIN-V if c['topology']=='buck' else VIN)*duty
    lr=sp.factor(numerator/(FS*rr*mean))
    lr=lr.subs({V:c['vo'],N:c['n'],FS:c['fs']})
    xs=[lower,upper]
    for root in sp.solve(sp.diff(lr,VIN),VIN):
        val=complex(root.evalf())
        if abs(val.imag)<1e-8 and lower<val.real<upper:
            xs.append(val.real)
    chosen_l=max(env['max_Lcrit']*margin,max(float(lr.subs(VIN,x)) for x in xs))
    # Continuous scalar bounded search plus dense samples for charge ripple.
    # Clearly reported as numerical, unlike exact symbolic Lcrit extremum.
    from scipy.optimize import minimize_scalar
    def charge(v):
        return steady({**c,'vin':float(v),'L':chosen_l},False,False)['metrics']['charge_pp']
    sample=np.linspace(lower,upper,121)
    qs=[charge(v) for v in sample]
    candidates=[(qs[0],lower),(qs[-1],upper)]
    for j in range(1,len(sample)-1):
        if qs[j]>=qs[j-1] and qs[j]>=qs[j+1]:
            opt=minimize_scalar(lambda v:-charge(v),bounds=(sample[j-1],sample[j+1]),method='bounded')
            candidates.append((-opt.fun,float(opt.x)))
    max_q,worst=max(candidates)
    chosen_c=max_q/target
    return {'L':chosen_l,'C':chosen_c,'max_Lcrit':env['max_Lcrit'],
            'worst_Lcrit_vin':env['worst_vin'],'worst_ripple_vin':worst,
            'current_ripple_ratio':rr,'voltage_ripple_target':target,'ccm_margin':margin,
            'scope':'Ιδανική διαστασιολόγηση CCM: ελάχιστο L για το περιθώριο αγωγής και ΔiL/Iavg, και C από Δq/ΔV. Ο έλεγχος L είναι συμβολικός· η μέγιστη Δq εκτιμάται με πλέγμα 121 σημείων και τοπική αναζήτηση. Δεν περιλαμβάνει ESR, ανοχές, θερμικά, κορεσμό, τυποποιημένες τιμές ή βελτιστοποίηση απωλειών.'}
