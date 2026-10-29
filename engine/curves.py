"""Duty-to-output curves with actual ideal conduction and load law."""
import numpy as np
import sympy as sp
from .analysis import config,steady,number,InputError,math_record
from .models import symbolic_model,VIN,V,D,R,N,FS,P,L


def operating_curves(data):
    c=config(data)
    lower=number(data,'duty_min',.02,high=.9999)
    upper=number(data,'duty_max',.9,high=.9999)
    count=int(number(data,'points',101,low=2,high=301))
    if lower>=upper:raise InputError('Απαιτείται 0 < Dmin < Dmax < 1.')
    resistance=c['resistance'] if c['drive']=='fixed_duty' and c['load']=='resistive' else c['vo']**2/c['power']
    model=symbolic_model(c['topology'])
    k=2*L*FS/R
    dcm_gain=2/(1+sp.sqrt(1+4*k/D**2)) if c['topology']=='buck' else (1+sp.sqrt(1+4*D**2/k))/2 if c['topology']=='boost' else D/sp.sqrt(k)
    subs={VIN:c['vin'],N:c['n'],FS:c['fs'],P:c['power'],R:resistance}
    gain=model['gain'].subs(subs)
    boundary=model['critical']
    if c['load']=='constant_power':boundary=boundary.subs(R,(model['gain']*VIN)**2/P)
    boundary=sp.factor(boundary.subs(subs))
    roots=sp.solve(sp.Eq(boundary,c['L']),D)
    borders=[]
    for root in roots:
        val=complex(root.evalf())
        if abs(val.imag)<1e-9 and lower<val.real<upper:borders.append(val.real)
    points=[]
    for duty in sorted(set([*np.linspace(lower,upper,count),*borders])):
        item={'duty':float(duty),'gain_ccm_reference':float(gain.subs(D,duty)),
              'Lcrit':float(boundary.subs(D,duty))}
        try:
            a=steady({**c,'drive':'fixed_duty','duty_set':float(duty),'resistance':resistance},False,False)
            m=a['metrics'];item.update(valid=True,vo=a['config']['vo'],gain=a['config']['vo']/c['vin'],
                mode=a['mode'],Ipeak=m['Ipeak'],ripple=m['Vripple_pp'],Ivalley=m['Ivalley'])
        except InputError as error:
            item.update(valid=False,reason=str(error),vo=None,gain=None,mode=None,Ipeak=None,ripple=None,Ivalley=None)
        points.append(item)
    return {'config':c,'points':points,'boundary_duties':sorted(borders),'load_resistance':resistance,
            'gain_ccm':math_record(sp.Eq(V/VIN,model['gain'])),
            'gain_dcm_resistive':math_record(sp.Eq(V/VIN,dcm_gain)),
            'boundary_equation':math_record(sp.Eq(L,boundary)),
            'scope':'Σάρωση πραγματικού duty με σταθερό Vin, L, C, fs, n και σταθερή R (ή Po αν επιλεγεί ιδανικό φορτίο σταθερής ισχύος). Vo και Vo/Vin εδώ είναι μέτρα· ο πραγματικός αντιστρέφων buck–boost έχει αρνητική έξοδο. Η dashed CCM σχέση είναι αναφορά και δεν επιβάλλεται σε DCM. Τα σύνορα αγωγής προκύπτουν από L=Lcrit(D). Μη προσδιορισμένα CPL σημεία παραμένουν κενά.'}
