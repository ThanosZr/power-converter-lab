"""Traceable current → charge → ripple → capacitor solution, per interval.

Generic equations use SI. The numerical piecewise functions use t_us and
q_uC to keep coefficients readable: integrating A over μs produces μC.
All coefficients come from the same operating intervals used for the plots.
"""
import math
import sympy as sp
from .analysis import steady,number,InputError,math_record
from .models import VIN,V,D,L,C,N,FS,P


def equation(lhs,rhs):
    return math_record(sp.Eq(lhs,rhs,evaluate=False))


def entry(title,explanation,lhs,rhs,numeric=None):
    result={'title':title,'explanation':explanation,'math':equation(lhs,rhs)}
    if numeric is not None:result['numeric']=numeric
    return result


def explain_operating_point(op,target=None):
    c,m,segs=op['config'],op['metrics'],op['intervals']
    key=c['topology'];dcm=op['mode']=='DCM'
    t,tau=sp.symbols('t tau',real=True)
    u=sp.Symbol('t_us',real=True)
    period=1/FS
    io,imin,ipk,delta=sp.symbols('I_o I_min I_pk delta',nonnegative=True)
    ripple=sp.Symbol('Delta_I',nonnegative=True)
    fl=sp.Function('i_m' if key=='flyback' else 'i_L')
    fc,fd,fswitch=sp.Function('i_C'),sp.Function('i_D'),sp.Function('i_S')
    qfun=sp.Function('q')
    slope_on=(VIN-V)/L if key=='buck' else VIN/L
    slope_off=V/L if key in ('buck','buck_boost') else (V-VIN)/L if key=='boost' else V/(N*L)
    mean=io if key=='buck' else io*(N if key=='flyback' else 1)/(1-D)
    on=sp.And(t>=0,t<D*period)
    off=sp.And(t>=D*period,t<(D+delta)*period)
    idle=sp.And(t>=(D+delta)*period,t<period)
    il_on=imin+slope_on*t
    il_off=ipk-slope_off*(t-D*period)
    il_pw=sp.Piecewise((il_on,on),(il_off,off),(0,idle))
    id_off=il_off/N if key=='flyback' else il_off
    ic_on=il_on-io if key=='buck' else -io
    ic_off=il_off-io if key=='buck' else id_off-io
    ic_pw=sp.Piecewise((ic_on,on),(ic_off,off),(-io,idle))
    is_pw=sp.Piecewise((il_on,on),(0,sp.And(t>=D*period,t<period)))
    id_pw=sp.Piecewise((0,on),(id_off,off),(0,idle))
    # Numerical interval expressions in μs, including exact discontinuities.
    numeric_parts={name:[] for name in ('iL','iS','iD','iC')}
    qparts=[];interval_rows=[];extrema=[]
    def add_extreme(time,charge,kind):
        if not any(math.isclose(time,r['t_us'],rel_tol=1e-10,abs_tol=1e-10) and math.isclose(charge,r['q_uC'],rel_tol=1e-10,abs_tol=1e-10) for r in extrema):
            extrema.append({'t_us':float(time),'q_uC':float(charge),'kind':kind})
    for seg in segs:
        start,end=seg['a']/c['fs']*1e6,seg['b']/c['fs']*1e6
        duration=end-start
        condition=sp.And(u>=sp.Float(start,9),u<sp.Float(end,9))
        expressions={}
        for name in numeric_parts:
            a,b=seg[name]
            expression=sp.Float(a,9)+sp.Float((b-a)/duration,9)*(u-sp.Float(start,9))
            expression=sp.expand(expression)
            numeric_parts[name].append((expression,condition))
            expressions[name]=math_record(expression)
        a,b=seg['iC'];q0=seg['q0']*1e6
        qexpr=sp.Float(q0,10)+sp.Float(a,10)*(u-sp.Float(start,10))+sp.Float((b-a)/(2*duration),10)*(u-sp.Float(start,10))**2
        qparts.append((sp.expand(qexpr),condition))
        qend=q0+duration*(a+b)/2
        add_extreme(start,q0,'άκρο διαστήματος')
        add_extreme(end,qend,'άκρο διαστήματος')
        if a*b<0:
            z=-a/(b-a)
            time=start+z*duration
            charge=q0+duration*(a*z+(b-a)*z*z/2)
            add_extreme(time,charge,'iC=0')
        interval_rows.append({'state':seg['state'],'start_us':start,'end_us':end,
                              'iL_start':seg['iL'][0],'iL_end':seg['iL'][1],
                              'iC_start':a,'iC_end':b,'q_start_uC':q0,'q_end_uC':qend,
                              'expressions':expressions,'charge':math_record(sp.expand(qexpr))})
    numeric={name:sp.Piecewise(*parts) for name,parts in numeric_parts.items()}
    qnumeric=sp.Piecewise(*qparts)
    extrema.sort(key=lambda p:p['t_us'])
    minimum=min(extrema,key=lambda p:p['q_uC']);maximum=max(extrema,key=lambda p:p['q_uC'])
    charge_pp=(maximum['q_uC']-minimum['q_uC'])*1e-6
    if not math.isclose(charge_pp,m['charge_pp'],rel_tol=1e-9,abs_tol=1e-15):
        raise InputError('Η αναλυτική διαδρομή φορτίου δεν συμφωνεί με την κυμάτωση του engine.')
    subs={VIN:sp.Float(c['vin'],9),V:sp.Float(c['vo'],9),D:sp.Float(m['duty'],9),
          L:sp.Float(c['L'],9),C:sp.Float(c['C'],9),N:sp.Float(c['n'],9),
          FS:sp.Float(c['fs'],9),P:sp.Float(c['power'],9),io:sp.Float(m['Iout'],9),
          imin:sp.Float(m['Ivalley'],9),ipk:sp.Float(m['Ipeak'],9),delta:sp.Float(m['delta'],9)}
    def substitute(lhs,expression):
        # Unevaluated substitution retains the actual arithmetic for teaching.
        def held(expr):
            if expr in subs:return subs[expr]
            if expr.is_Atom:return expr
            args=[held(arg) for arg in expr.args]
            return expr.func(*args,evaluate=False) if expr.func in (sp.Add,sp.Mul,sp.Pow) else expr.func(*args)
        return equation(lhs,held(expression))
    current_steps=[
        entry('1 · Μέσο ρεύμα εξόδου','Pο=|Vo|·Io. Οι τάσεις εξόδου στις σχέσεις είναι μέτρα.',io,P/V,substitute(io,sp.Mul(P,sp.Pow(V,-1,evaluate=False),evaluate=False))),
        entry('2α · Περίοδος και χρόνοι αγωγής',f"T={1/c['fs']*1e6:.8g} μs · tON={m['duty']/c['fs']*1e6:.8g} μs · tOFF={m['delta']/c['fs']*1e6:.8g} μs · tIDLE={m['idle']/c['fs']*1e6:.8g} μs. Το δ είναι ο λόγος διάρκειας αγωγής της διόδου.",sp.Symbol('T'),period,substitute(sp.Symbol('T'),period)),
        entry('2β · Διάστημα εκφόρτισης','Από την πτώση του ρεύματος έως το μηδέν στη DCM, ή όλο το υπόλοιπο της περιόδου σε CCM/BCM.',delta,((VIN-V)*D/V if key=='buck' else VIN*D/(V-VIN) if key=='boost' else VIN*D*(N if key=='flyback' else 1)/V) if dcm else 1-D,equation(delta,sp.Float(m['delta'],9))),
        entry('2 · Κυμάτωση ρεύματος πηνίου / μαγνήτισης','Από Δi=(vL/L)·tON. Στον flyback το im και το Lm είναι αναγμένα στο πρωτεύον.',ripple,slope_on*D/FS,substitute(ripple,slope_on*D/FS)),
        entry('3 · Μέση τιμή και όριο ρεύματος','Σε CCM/BCM: Imin=Iavg−ΔI/2 και Ipk=Iavg+ΔI/2. Σε DCM: Imin=0 και Ipk=ΔI.',sp.Symbol('I_avg_CCM'),mean,substitute(sp.Symbol('I_avg_CCM'),mean)) if not dcm else entry('3 · Έλεγχος DCM','Το ρεύμα μηδενίζεται πριν την επόμενη περίοδο· δεν χρησιμοποιείται η CCM μέση τιμή.',imin,sp.Integer(0)),
        entry('4 · Μέγιστο ρεύμα',f"Ipk={m['Ipeak']:.8g} A, Imin={m['Ivalley']:.8g} A, ΔI={m['Iripple_pp']:.8g} App.",ipk,ripple if dcm else mean+ripple/2),
        entry('5 · Ρεύμα πηνίου ανά διάστημα','Συμβολική τμηματική σχέση σε t [s]. Δίνονται και οι αριθμητικές ράμπες σε t_us [μs]. Το τρίτο διάστημα έχει μηδενική διάρκεια σε CCM/BCM.',fl(t),il_pw,equation(fl(u),numeric['iL'])),
        entry('6 · Ρεύμα διακόπτη','Ο διακόπτης φέρει το ρεύμα πηνίου/πρωτεύοντος μόνο στο ON.',fswitch(t),is_pw,equation(fswitch(u),numeric['iS'])),
        entry('7 · Ρεύμα διόδου','Στον flyback το δευτερεύον ρεύμα είναι im/n κατά το OFF. Η αναγωγή ρεύματος δεν παραλείπεται.',fd(t),id_pw,equation(fd(u),numeric['iD'])),
        entry('8 · Ρεύμα πυκνωτή','Buck: iC=iL−Io. Boost/buck–boost/flyback: iC=iD−Io. Στο ON των τελευταίων iC=−Io.',fc(t),ic_pw,equation(fc(u),numeric['iC'])),
        entry('9 · Μέσες και RMS τιμές',f"IL,rms={m['ILrms']:.8g} A · IS,rms={m['ISrms']:.8g} A · ID,rms={m['IDrms']:.8g} A · IC,rms={m['ICrms']:.8g} A. Ολοκλήρωση ανά διάστημα, με τους πραγματικούς χρόνους αγωγής.",sp.Symbol('I_rms'),sp.sqrt(sp.Integral(sp.Function('i')(tau)**2,(tau,0,period))/period))]
    for index,lhs,value in [(0,io,m['Iout']),(1,sp.Symbol('T'),1/c['fs']),
                            (3,ripple,m['Iripple_pp']),(5,ipk,m['Ipeak'])]:
        current_steps[index]['result']=equation(lhs,sp.Float(value,10))
    for name,function,metric,label in [('iL',fl,'ILrms','I_L_rms'),('iS',fswitch,'ISrms','I_S_rms'),('iD',fd,'IDrms','I_D_rms'),('iC',fc,'ICrms','I_C_rms')]:
        terms=[]
        for seg in segs:
            av,bv=(sp.Float(v,9) for v in seg[name])
            polynomial=sp.Add(sp.Pow(av,2,evaluate=False),sp.Mul(av,bv,evaluate=False),sp.Pow(bv,2,evaluate=False),evaluate=False)
            terms.append(sp.Mul(sp.Float((seg['b']-seg['a'])/3,10),polynomial,evaluate=False))
        numeric_rms=sp.Pow(sp.Add(*terms,evaluate=False),sp.Rational(1,2),evaluate=False)
        item=entry('9 · RMS '+label,f"Ανά γραμμικό διάστημα: ∫i²dt/T = (Δt/T)·(Ia²+IaIb+Ib²)/3. Αποτέλεσμα {m[metric]:.8g} A.",sp.Symbol(label),sp.sqrt(sp.Integral(function(tau)**2,(tau,0,period))/period),equation(sp.Symbol(label),numeric_rms))
        item['result']=equation(sp.Symbol(label),sp.Float(m[metric],10))
        current_steps.append(item)
    dv,dq=sp.symbols('Delta_V_pp Delta_q_pp',positive=True)
    ripple_steps=[
        entry('10 · Από το ρεύμα στο φορτίο','Ολοκληρώνουμε iC με συνεχή τιμή q στις μεταγωγές. Η προσθετική σταθερά του q δεν επηρεάζει την κυμάτωση.',qfun(t),sp.Integral(fc(tau),(tau,0,t)),equation(sp.Function('q_uC')(u),qnumeric)),
        entry('11 · Ακρότατα φορτίου',f"Ελέγχονται όλα τα άκρα και τα εσωτερικά iC=0. qmin={minimum['q_uC']:.8g} μC στο t={minimum['t_us']:.8g} μs, qmax={maximum['q_uC']:.8g} μC στο t={maximum['t_us']:.8g} μs.",dq,sp.Symbol('q_max')-sp.Symbol('q_min'),equation(sp.Symbol('Delta_q_uC'),sp.Add(sp.Float(maximum['q_uC'],9),-sp.Float(minimum['q_uC'],9),evaluate=False))),
        entry('12 · Κυμάτωση με το υπάρχον C',f"Με C={c['C']*1e6:.8g} μF: ΔVo,pp={m['Vripple_pp']:.8g} V = {m['Vripple_pp']*1000:.8g} mVpp. Η αναφορά είναι peak-to-peak, όχι ±ΔV.",dv,dq/C,equation(dv,sp.Mul(sp.Float(charge_pp,10),sp.Pow(sp.Float(c['C'],10),-1,evaluate=False),evaluate=False)))]
    ripple_steps[1]['result']=equation(sp.Symbol('Delta_q_uC'),sp.Float(charge_pp*1e6,10))
    ripple_steps[2]['result']=equation(dv,sp.Float(m['Vripple_pp'],10))
    sizing=None
    if target is not None:
        if not math.isfinite(target) or target<=0:raise InputError('Το μέγιστο ΔVo,pp πρέπει να είναι θετικό.')
        required=charge_pp/target
        sizing={'target_Vpp':target,'target_mVpp':target*1000,'C_min':required,
                'C_existing':c['C'],'existing_ripple_Vpp':m['Vripple_pp'],
                'meets_target':m['Vripple_pp']<=target*(1+1e-10)}
        ripple_steps.append(entry('13 · Επίλυση ως προς C',f"Ζητούμενο: ΔVo,pp ≤ {target:.8g} V. Άρα C ≥ {required:.8g} F = {required*1e6:.8g} μF. Η ισότητα δίνει το ιδανικό ελάχιστο στο εξετασμένο σημείο· ανοχές και ESR δεν περιλαμβάνονται.",C,sp.Max(dq,0)/sp.Symbol('Delta_V_pp_max',positive=True),equation(sp.Symbol('C_min_uF'),sp.Mul(sp.Float(charge_pp*1e6,10),sp.Pow(sp.Float(target,10),-1,evaluate=False),evaluate=False))))
        # The symbolic requirement is an inequality; preserve it explicitly.
        ripple_steps[-1]['math']=math_record(sp.GreaterThan(C,dq/sp.Symbol('Delta_V_pp_max',positive=True)))
        ripple_steps[-1]['result']=math_record(sp.GreaterThan(sp.Symbol('C_uF'),sp.Float(required*1e6,10)))
    charge_wave={'t_us':[],'q_uC':[],'iC_A':[]}
    for row in interval_rows:
        ta,tb=row['start_us'],row['end_us'];duration=tb-ta
        times=[ta+duration*j/24 for j in range(25)]
        times.extend(p['t_us'] for p in extrema if ta<p['t_us']<tb)
        for time in sorted(set(times)):
            elapsed=time-ta;ia,ib=row['iC_start'],row['iC_end']
            charge_wave['t_us'].append(time)
            charge_wave['iC_A'].append(ia+(ib-ia)*elapsed/duration)
            charge_wave['q_uC'].append(row['q_start_uC']+ia*elapsed+(ib-ia)*elapsed*elapsed/(2*duration))
    return {'config':c,'mode':op['mode'],'metrics':m,'charge_waveform':charge_wave,
            'current_steps':current_steps,'ripple_steps':ripple_steps,
            'numeric_waveforms':{name:equation({'iL':fl,'iC':fc,'iD':fd,'iS':fswitch}[name](u),expr) for name,expr in numeric.items()},
            'intervals':interval_rows,'charge_extrema':extrema,'q_min':minimum,'q_max':maximum,
            'charge_pp':charge_pp,'sizing':sizing,
            'units_note':'Γενικές σχέσεις: t σε s, q σε C. Αριθμητικές τμηματικές σχέσεις: t_us σε μs, q_uC σε μC, ρεύματα σε A. Τάσεις εξόδου ως μέτρα. Κυμάτωση peak-to-peak.',
            'scope':'Ιδανικά στοιχεία, περιοδική μόνιμη κατάσταση και μικρή κυμάτωση τάσης. Η αναλυτική φόρτιση προκύπτει από τις ίδιες ράμπες με τα διαγράμματα. Δεν αντικαθίσταται γενικά από Io·D/(fs·C), αν το iC αλλάζει πρόσημο και σε άλλο σημείο.'}


def derive(data):
    op=steady(data,True,False)
    target=number(data,'voltage_ripple',.1)
    return explain_operating_point(op,target)
