"""CCM averaged linearization and independent event-based switching ODEs."""
import numpy as np
import sympy as sp
from functools import lru_cache
from scipy.integrate import solve_ivp
from .models import symbolic_model, VIN, V, D, L, C, R, N, P, S, FS
from .analysis import steady, math_record, number, InputError


def linearize(data):
    op = steady(data, False, False)
    c, m = op['config'], op['metrics']
    if op['mode']=='DCM':
        return linearize_dcm(op)
    if op['mode']=='BCM':
        return {'available':False,'mode':'BCM','reason':'Ακριβώς στο BCM αλλάζει ο κλάδος λειτουργίας. Δεν επιβάλλεται μία μοναδική ομαλή συνάρτηση μεταφοράς· εξετάστε τα γειτονικά CCM και DCM σημεία.'}
    sym = symbolic_model(c['topology'], c['load'])
    subs = {VIN:c['vin'], D:m['duty'], L:c['L'], C:c['C'], R:m['R'], N:c['n'], P:c['power']}
    a = np.array(sym['A'].subs(subs),dtype=float)
    poles = np.linalg.eigvals(a)
    freqs = np.geomspace(max(.01,c['fs']/1e6), c['fs']/10, 180)
    bd = np.array(sym['Bd'].subs(subs),dtype=float).reshape(2)
    response = np.array([np.linalg.solve(1j*2*np.pi*f*np.eye(2)-a,bd)[1] for f in freqs])
    gnum = sp.cancel(sym['Gvd'].subs(subs))
    num,den = sp.fraction(gnum)
    numco = np.array([float(x) for x in sp.Poly(num,S).all_coeffs()])
    denco = np.array([float(x) for x in sp.Poly(den,S).all_coeffs()])
    numco, denco = numco/denco[0], denco/denco[0]
    zeros = np.roots(numco) if len(numco)>1 else []
    complex_record = lambda x: {'real':float(np.real(x)), 'imag':float(np.imag(x))}
    return {'available':True, 'mode':'CCM','load':c['load'],
            'A':math_record(sym['A']), 'Bd':math_record(sym['Bd']),
            'Gvd':math_record(sym['Gvd']), 'Gvg':math_record(sym['Gvg']),
            'Gvd_numeric':math_record(gnum), 'A_numeric':a.tolist(),
            'numerator':numco.tolist(),'denominator':denco.tolist(),
            'poles':[complex_record(p) for p in poles],
            'zeros':[complex_record(z) for z in zeros],
            'stable':bool(np.all(np.real(poles)<0)),
            'bode':{'frequency':freqs.tolist(),'magnitude_db':(20*np.log10(np.maximum(np.abs(response),1e-30))).tolist(),
                    'phase_deg':np.rad2deg(np.unwrap(np.angle(response))).tolist()},
            'scope':'Μέσο μοντέλο CCM, ανοικτός βρόχος, διαταραχή duty → μέτρο Vo. Η signed απόκριση buck–boost έχει πρόσθετο αρνητικό πρόσημο. Bode έως fs/10· χωρίς ESR, απώλειες, καθυστέρηση ή PWM dynamics.'}


@lru_cache(maxsize=8)
def dcm_model(key,load_kind):
    slope_on=(VIN-V)/L if key=='buck' else VIN/L
    slope_off=V/L if key in ('buck','buck_boost') else (V-VIN)/L if key=='boost' else V/(N*L)
    ipk=slope_on*D/FS
    delta=sp.factor(slope_on*D/slope_off)
    # Buck delivers current during ON as well; the other three only OFF.
    jout=sp.factor(ipk*(D+delta)/2 if key=='buck' else ipk*delta/(2*(N if key=='flyback' else 1)))
    load=V/R if load_kind=='resistive' else P/V
    f=(jout-load)/C
    a=sp.factor(sp.diff(f,V));bd=sp.factor(sp.diff(f,D));bg=sp.factor(sp.diff(f,VIN))
    return {'Ipeak':ipk,'delta':delta,'jout':jout,'load':load,'field':f,
            'A':a,'Bd':bd,'Bg':bg,'Gvd':sp.factor(bd/(S-a)),'Gvg':sp.factor(bg/(S-a))}


def linearize_dcm(op):
    """Low-frequency one-state DCM model from averaged rectifier current.

    Inductor current resets every cycle; its fast subcycle state is eliminated.
    This is not a sampled-data model and does not apply at the BCM boundary.
    """
    c,m=op['config'],op['metrics']
    model=dcm_model(c['topology'],c['load'])
    jout,a,bd,bg,gd,gg=(model[k] for k in ('jout','A','Bd','Bg','Gvd','Gvg'))
    subs={VIN:c['vin'],V:c['vo'],D:m['duty'],L:c['L'],C:c['C'],R:m['R'],P:c['power'],FS:c['fs']}
    av,bv=float(a.subs(subs)),float(bd.subs(subs))
    # Remove tiny roundoff at the neutral CPL equilibrium, not real poles.
    if abs(av)<1e-10:av=0.
    gnum=bv/(S-av)
    freqs=np.geomspace(max(.01,c['fs']/1e6),c['fs']/20,180)
    response=bv/(1j*2*np.pi*freqs-av)
    return {'available':True,'mode':'DCM','load':c['load'],
            'A':math_record(sp.Matrix([[a]])),'Bd':math_record(sp.Matrix([[bd]])),
            'averaged_current':math_record(sp.Eq(sp.Symbol('I_rect'),jout)),
            'Gvd':math_record(gd),'Gvg':math_record(gg),'Gvd_numeric':math_record(gnum),
            'A_numeric':[[av]],'numerator':[bv],'denominator':[1.,-av],
            'poles':[{'real':av,'imag':0.}],'zeros':[],'stable':av<0,
            'bode':{'frequency':freqs.tolist(),'magnitude_db':(20*np.log10(np.maximum(abs(response),1e-30))).tolist(),
                    'phase_deg':np.rad2deg(np.unwrap(np.angle(response))).tolist()},
            'scope':'DCM μοντέλο χαμηλών συχνοτήτων, πρώτης τάξης: το μέσο ρεύμα ανορθωτή εξαρτάται από duty και Vo και το πηνίο μηδενίζεται κάθε περίοδο. Bode έως fs/20, μικρή διαταραχή που παραμένει σε DCM. Δεν είναι sampled-data μοντέλο και δεν εφαρμόζεται στο BCM. Έξοδος=μέτρο Vo· signed buck–boost έχει αρνητικό πρόσημο. Μηδενικός πόλος σε ιδανικό CPL σημαίνει μη απομονωμένο / μη ασυμπτωτικά ευσταθές σημείο.'}


def switching(data):
    """Integrate physical interval ODEs, with diode turn-off at i=0.

    Duty is fixed at the analytical estimate. There is no voltage controller.
    Starts near operating point; reports actual settling rather than asserting it.
    """
    op = steady(data, False, False)
    c,m = op['config'],op['metrics']
    cycles = int(number(data,'cycles',300,low=9,high=1000))
    step = number(data,'load_step',1,low=.1,high=3)
    vin,vo,fs,ll,cap,n = (c[k] for k in ('vin','vo','fs','L','C','n'))
    key, duty = c['topology'],m['duty']
    period = 1/fs
    y = np.array([m['Ivalley'],vo],dtype=float)
    points, vals, gates = [],[],[]
    history = []
    last_segments=[]
    zero_cycles=0
    for cycle in range(cycles):
        before = y.copy()
        factor = step if cycle>=cycles//2 else 1.
        power = c['power']*factor
        resistance = m['R']/factor
        def rhs(state):
            def f(t,z):
                i,v = z
                if v<=0 and c['load']=='constant_power':
                    raise InputError('Κατάρρευση τάσης με φορτίο σταθερής ισχύος. Μειώστε το βήμα φορτίου ή εξετάστε κλειστό βρόχο σε μελλοντική έκδοση.')
                io = v/resistance if c['load']=='resistive' else power/max(v,vo*.001)
                if state=='ON':
                    di = (vin-v)/ll if key=='buck' else vin/ll
                    oc = i if key=='buck' else 0.
                elif state=='OFF':
                    di = (-v/ll if key in ('buck','buck_boost') else (vin-v)/ll if key=='boost' else -v/(n*ll))
                    oc = i/n if key=='flyback' else i
                else:
                    di,oc=0.,0.
                return [di,(oc-io)/cap]
            return f
        def zero(t,z): return z[0]
        zero.terminal,zero.direction=True,-1
        def collapse(t,z): return z[1]-vo*.02
        collapse.terminal,collapse.direction=True,-1
        def reenter(t,z): return z[1]-vin
        reenter.terminal,reenter.direction=True,-1
        begin,end=cycle*period,(cycle+1)*period
        def advance(a,b,state,events=None):
            nonlocal y
            sol=solve_ivp(rhs(state),(a,b),y,rtol=2e-8,atol=[1e-9,1e-8],
                          max_step=period/12,dense_output=True,events=events)
            if not sol.success:
                raise InputError('Ο αριθμητικός ολοκληρωτής δεν συνέκλινε: '+sol.message)
            stop=sol.t[-1]
            ts=np.linspace(a,stop,max(3,int((stop-a)/period*40)+1))
            zs=sol.sol(ts)
            points.extend(ts.tolist()); vals.extend(zs.T.tolist()); gates.extend([1 if state=='ON' else 0]*len(ts))
            y=sol.y[:,-1]
            if y[1]<vo*.020001:
                raise InputError('Η τάση εξόδου κατέρρευσε κάτω από 2% της αρχικής. Το ανοικτό κύκλωμα δεν διατηρεί αυτό το σημείο λειτουργίας.')
            return stop
        middle=begin+duty*period
        advance(begin,middle,'ON',[collapse])
        stop=advance(middle,end,'OFF',[zero,collapse])
        if stop<end-period*1e-9:
            zero_cycles+=1
            y[0]=0.
            if key=='boost' and y[1]<=vin:
                advance(stop,end,'OFF',[collapse])
            else:
                idle_stop=advance(stop,end,'IDLE',[reenter,collapse] if key=='boost' else [collapse])
                if idle_stop<end-period*1e-9:
                    advance(idle_stop,end,'OFF',[collapse])
        history.append({'t_ms':end*1000,'vo':float(y[1]),'ivalley':float(y[0])})
        if cycle==cycles-1:
            scale=np.array([max(m['Ipeak'],1e-6),vo])
            residual=float(np.max(np.abs(y-before)/scale))
    ts=np.array(points); ys=np.array(vals); gate=np.array(gates)
    keep=ts>=(cycles-3)*period-1e-14
    last=ts>=(cycles-1)*period-1e-14
    tlast=ts[last]; vlast=ys[last,1]
    avg=float(np.trapezoid(vlast,tlast)/period)
    return {'history':history,'waveforms':{'t_us':((ts[keep]-(cycles-3)*period)*1e6).tolist(),
             'iL':ys[keep,0].tolist(),'vo':ys[keep,1].tolist(),'gate':gate[keep].tolist()},
            'average_vo':avg,'ripple_pp':float(np.ptp(vlast)),
            'target_error_percent':100*(avg/vo-1),'periodic_residual':residual,
            'settled':residual<1e-4,'cycles_with_zero':zero_cycles,
            'scope':'Ανεξάρτητη επίλυση των διακοπτικών ODE με γεγονός iL=0. Σταθερό duty, εκκίνηση κοντά στο αναλυτικό σημείο· χωρίς ρυθμιστή. Το βήμα φορτίου γίνεται στη μέση της δοκιμής. Η προσέγγιση μικρής κυμάτωσης δεν επιβάλλεται στον ολοκληρωτή.'}
