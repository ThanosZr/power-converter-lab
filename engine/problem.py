"""Goal-driven design problems with explicit conditions and derivations."""
from itertools import product, combinations
import math
import sympy as sp
from .models import symbolic_model,VIN,V,D,L,C,R,N,FS,P
from .analysis import config,number,InputError,math_record,steady
from .workbench import axes as validate_axes,sweep

SYMBOLS={'vin':VIN,'vo':V,'power':P,'fs':FS,'n':N,'duty_set':D,'resistance':R}


def step(title,explanation,expr):
    return {'title':title,'explanation':explanation,'math':math_record(expr)}


def inductance_problem(data):
    c=config(data)
    goal=data.get('goal','ccm_all')
    if goal not in ('ccm_all','dcm_all','boundary_limits','boundary_all'):
        raise InputError('Άγνωστη συνθήκη σχεδιασμού L.')
    if c['drive']=='fixed_duty' and c['load']=='constant_power':
        raise InputError('Για σχεδιασμό CCM/DCM σε εύρος με σταθερό duty ορίστε ωμικό φορτίο R. Με ιδανικό φορτίο σταθερής ισχύος η έξοδος μπορεί να μην προσδιορίζεται στη DCM.')
    aa=validate_axes(data,c) if data.get('axes') else []
    allowed={'vin','vo','power','fs','n'} if c['drive']=='regulated' else {'vin','duty_set','resistance','fs','n'}
    if any(a['field'] not in allowed for a in aa):
        raise InputError('Το L είναι ζητούμενο και δεν μπορεί να είναι ταυτόχρονα άξονας. Ο C δεν καθορίζει το ιδανικό όριο αγωγής.')
    if c['topology']!='flyback' and any(a['field']=='n' for a in aa):
        raise InputError('Λόγος σπειρών υπάρχει μόνο στον flyback.')
    # The complete rectangular domain must be physically valid, including
    # corners that a sample-only calculation might otherwise discard.
    for values in product(*[(a['min'],a['max']) for a in aa]):
        point={**c,**{a['field']:v for a,v in zip(aa,values)}}
        steady(point,False,False)
    sym=symbolic_model(c['topology'])
    raw=sp.factor(sym['critical'].subs(D,sym['duty']).subs(R,V**2/P)) if c['drive']=='regulated' else sym['critical']
    active={a['field'] for a in aa}
    substitutions={symbol:sp.Rational(str(c[field])) for field,symbol in SYMBOLS.items() if field not in active}
    # In regulated mode R and D have already been eliminated. In fixed-duty
    # R mode only D,R,fs,n occur, while Vin may legitimately be a flat axis.
    expr=sp.factor(raw.subs(substitutions))
    variables=[SYMBOLS[a['field']] for a in aa]
    bounds=[(sp.Rational(str(a['min'])),sp.Rational(str(a['max']))) for a in aa]
    candidates=[]
    def evaluate(coords,kind):
        val=complex(expr.subs(dict(zip(variables,coords))).evalf())
        if abs(val.imag)>1e-9 or not math.isfinite(val.real) or val.real<=0:
            raise InputError('Το μοντέλο δεν δίνει θετική πεπερασμένη κρίσιμη επαγωγή σε όλο το πεδίο.')
        coordinates={a['field']:float(x) for a,x in zip(aa,coords)}
        if any(all(math.isclose(p['coordinates'][k],v,rel_tol=1e-10,abs_tol=1e-13) for k,v in coordinates.items()) for p in candidates):
            return
        point={**c,**coordinates,'L':val.real}
        boundary=steady(point,False,False)
        if boundary['mode']!='BCM':
            raise InputError('Ο ανεξάρτητος έλεγχος του σημείου οριακής αγωγής δεν συμφωνεί με το ακρότατο.')
        candidates.append({'coordinates':coordinates,'Lcrit':val.real,'kind':kind,
                           'duty':boundary['metrics']['duty'],'Ipeak':boundary['metrics']['Ipeak']})
    for coords in product(*bounds):
        evaluate(coords,'άκρο / κορυφή')
    # On a compact rectangle extrema lie at corners, stationary edge points,
    # or stationary interior points. Enumerate every face, including flat ones.
    for size in range(1,len(variables)+1):
        for free in combinations(range(len(variables)),size):
            fixed=[i for i in range(len(variables)) if i not in free]
            for fixed_values in product(*[bounds[i] for i in fixed]):
                base={variables[i]:v for i,v in zip(fixed,fixed_values)}
                restricted=expr.subs(base)
                freevars=[variables[i] for i in free]
                flat=[v for v in freevars if sp.diff(restricted,v)==0]
                midpoint={variables[i]:(bounds[i][0]+bounds[i][1])/2 for i in free if variables[i] in flat}
                effective=[v for v in freevars if v not in flat]
                equations=[sp.factor(sp.diff(restricted,v).subs(midpoint)) for v in effective]
                solutions=sp.solve(equations,effective,dict=True) if equations else [{}]
                for solution in solutions:
                    values={**base,**midpoint,**solution}
                    if any(v not in values or values[v].free_symbols for v in variables):
                        raise InputError('Το σύνολο στάσιμων σημείων δεν επιλύθηκε πλήρως από το συμβολικό μοντέλο.')
                    coords=[];accept=True
                    for i,v in enumerate(variables):
                        number_=complex(values[v].evalf())
                        if abs(number_.imag)>1e-9 or not float(bounds[i][0])-1e-10<=number_.real<=float(bounds[i][1])+1e-10:
                            accept=False;break
                        coords.append(values[v])
                    if accept:evaluate(coords,'στάσιμο εσωτερικό' if size==len(variables) else 'στάσιμο σε ακμή')
    minimum=min(candidates,key=lambda p:p['Lcrit'])
    maximum=max(candidates,key=lambda p:p['Lcrit'])
    lo,hi=minimum['Lcrit'],maximum['Lcrit']
    factor=number(data,'margin_factor',1.2,low=1,high=10)
    flat=math.isclose(lo,hi,rel_tol=1e-9)
    selected=hi*factor if goal=='ccm_all' else lo/factor if goal=='dcm_all' else lo if goal=='boundary_all' and flat else None
    labels={'ccm_all':'Ελάχιστο όριο L για CCM σε όλο το πεδίο',
            'dcm_all':'Μέγιστο όριο L για DCM σε όλο το πεδίο',
            'boundary_limits':'Ελάχιστη και μέγιστη κρίσιμη επαγωγή στο πεδίο',
            'boundary_all':'Σταθερό L για BCM σε όλα τα σημεία'}
    limit=sp.Symbol('L_crit_max' if goal=='ccm_all' else 'L_crit_min',positive=True)
    condition=sp.StrictGreaterThan(L,limit) if goal=='ccm_all' else sp.StrictLessThan(L,limit) if goal=='dcm_all' else sp.Eq(L,sp.Function('L_crit')(*variables))
    explanation='Για αυστηρή CCM απαιτείται L > max Lcrit. Η ισότητα δίνει BCM στα σημεία του μεγίστου, όχι αυστηρή CCM παντού.' if goal=='ccm_all' else 'Για αυστηρή DCM απαιτείται L < min Lcrit. Η ισότητα δίνει BCM στα σημεία του ελαχίστου, όχι αυστηρή DCM παντού.' if goal=='dcm_all' else 'Κάθε σημείο λειτουργίας έχει το δικό του Lcrit. Τα άκρα του δεν σημαίνουν ότι μία ενδιάμεση σταθερή τιμή δίνει BCM σε όλο το πεδίο.'
    if goal=='boundary_all':
        explanation='Το Lcrit είναι σταθερό σε αυτό το πεδίο: το ίδιο σταθερό L μπορεί να δίνει BCM παντού.' if flat else 'Δεν υπάρχει ένα σταθερό L που να δίνει BCM παντού: το Lcrit μεταβάλλεται. Χρειάζεται μεταβαλλόμενο L ή αλλαγή πρόσθετης παραμέτρου / στρατηγικής ελέγχου.'
    steps=[step('1 · Μετατροπή γνωστών και περιορισμών','Οι τιμές API είναι σε SI. Τα εύρη είναι ανεξάρτητοι συνδυασμοί στο δηλωμένο ορθογώνιο. Σταθερή ισχύς στο σύνολο των σημείων δεν συνεπάγεται υποχρεωτικά δυναμικό φορτίο σταθερής ισχύος.',sp.Eq(R,V**2/P)),
           step('2 · Duty στο όριο αγωγής','Στο BCM ισχύει η ισορροπία volt-seconds του CCM. Χρησιμοποιείται για να περιγραφεί το όριο, όχι για να επιβληθεί το κέρδος CCM σε DCM.',sp.Eq(D,sym['duty'])),
           step('3 · Συνθήκη BCM','Το ελάχιστο ρεύμα μηδενίζεται: Iavg=ΔI/2. Από τις εξισώσεις του καταχωρημένου μοντέλου παράγεται η κρίσιμη επαγωγή.',sp.Eq(sp.Symbol('L_crit'),sym['critical'])),
           step('4 · Συνάρτηση των ανεξάρτητων μεγεθών','Αντικαθίστανται το duty και η αντίσταση του σημείου όπου απαιτείται.',sp.Eq(sp.Symbol('L_crit'),raw)),
           step('5 · Αντικατάσταση γνωστών','Μένουν συμβολικά μόνο τα μεγέθη που έχουν οριστεί ως μεταβλητά στο πρόβλημα.',sp.Eq(sp.Symbol('L_crit'),expr))]
    for a,var in zip(aa,variables):
        steps.append(step('6 · Έλεγχος μεταβολής ως προς '+a['field'],'Λύνονται οι μηδενισμοί παραγώγων στο εσωτερικό και στις ακμές. Ελέγχονται επίσης όλες οι κορυφές.',sp.Eq(sp.Derivative(sp.Function('L_crit')(*variables),var),sp.factor(sp.diff(expr,var)))))
    steps.append(step('7 · Συνθήκη για το ζητούμενο',explanation,condition))
    return {'target':'L','goal':goal,'title':labels[goal],'config':c,'axes':aa,
            'min':minimum,'max':maximum,'candidates':candidates,'condition':math_record(condition),
            'explanation':explanation,'selected_value':selected,'margin_factor':factor,
            'constant_boundary_possible':flat,'feasible':goal!='boundary_all' or flat,
            'steps':steps,'method':'Συμβολικός έλεγχος κορυφών, ακμών και εσωτερικών στάσιμων σημείων· αριθμητική επαλήθευση BCM κάθε υποψήφιου σημείου.',
            'scope':'Ιδανικό μοντέλο μικρής κυμάτωσης, έως δύο ανεξάρτητες μεταβλητές. Το Lm του flyback είναι αναγμένο στο πρωτεύον και n=Ns/Np. Το ελάχιστο όριο αυστηρής CCM είναι κατώτατο φράγμα και το μέγιστο όριο αυστηρής DCM είναι ανώτατο φράγμα· τα ίδια τα όρια δεν ανήκουν στην αντίστοιχη αυστηρή περιοχή.'}


def capacitor_problem(data):
    from .derivation import explain_operating_point
    c=config(data)
    aa=data.get('axes',[])
    target=number(data,'voltage_ripple',.1)
    if aa:
        if any(a.get('field')=='C' for a in aa):
            raise InputError('Το C είναι ζητούμενο και δεν μπορεί να είναι ταυτόχρονα ανεξάρτητος άξονας.')
        result=sweep({**data,'voltage_ripple':target})
        if result['invalid']:
            raise InputError('Δεν μπορεί να σχεδιαστεί όλο το πεδίο: υπάρχουν μη αποδεκτοί συνδυασμοί. '+result['invalid'][0]['reason'])
        worst=max(result['points'],key=lambda p:p['C_required'])
        value=worst['C_required']
        point_data={**c,**{axis['field']:worst['x' if i==0 else 'y'] for i,axis in enumerate(aa)}}
        point=steady(point_data,False,False)
        method='Μέγιστο σε δηλωμένο πλέγμα σημείων· δεν αποδεικνύεται συνεχές πολυδιάστατο άνω όριο.'
    else:
        point=steady(c,False,False)
        value=point['metrics']['charge_pp']/target
        worst={'vin':c['vin'],'vo':c['vo'],'mode':point['mode']}
        method='Ακριβής ολοκλήρωση των τμηματικά γραμμικών ραμπών του ιδανικού μοντέλου μικρής κυμάτωσης.'
    derivation=explain_operating_point(point,target)
    return {'target':'C','goal':'ripple','title':'Ελάχιστο ιδανικό C για το όριο κυμάτωσης',
            'config':c,'axes':aa,'selected_value':value,'voltage_ripple':target,
            'worst':worst,'method':method,'feasible':True,
            'explanation':'Το C επιλέγεται από τη μεγαλύτερη διακύμανση φορτίου Δq, όχι από μέση τιμή του ρεύματος.',
            'derivation':derivation,
            'steps':derivation['current_steps']+derivation['ripple_steps'],
            'scope':'Ιδανικό C, χωρίς ESR ή ανοχές. Για εύρη τα αποτελέσματα αφορούν το δηλωμένο πλέγμα· για ένα σημείο την ακριβή ολοκλήρωση των γραμμικών ραμπών.'}


def solve_problem(data):
    target=data.get('target','L')
    if target=='L':return inductance_problem(data)
    if target=='C':return capacitor_problem(data)
    if target=='point':
        from .derivation import explain_operating_point
        a=steady(data)
        derivation=explain_operating_point(a)
        sym=symbolic_model(a['config']['topology'])
        key=a['config']['topology'];dcm=a['mode']=='DCM'
        ramp=(VIN-V if key=='buck' else VIN)*D/(L*FS)
        mean=P/V if key=='buck' else P*(N if key=='flyback' else 1)/(V*(1-D))
        duty=sym['duty']
        if dcm:
            duty=sp.sqrt(2*L*FS*P/(VIN*(VIN-V))) if key=='buck' else sp.sqrt(2*L*FS*P*(V-VIN)/V)/VIN if key=='boost' else sp.sqrt(2*L*FS*P)/VIN
        vstress=VIN if key=='buck' else V if key=='boost' else VIN+V/N if key=='flyback' else VIN+V
        formulas={'duty':duty,'Iout':P/V,'Ipeak':ramp if dcm else mean+ramp/2,
                  'Ivalley':sp.Integer(0) if dcm else mean-ramp/2,
                  'Lcrit':sym['critical'],'Vripple_pp':(sp.Symbol('q_max')-sp.Symbol('q_min'))/C,
                  'ILrms':sp.sqrt(sp.Symbol('I_peak')**2*(D+sp.Symbol('delta'))/3) if dcm else sp.sqrt((sp.Symbol('I_min')**2+sp.Symbol('I_min')*sp.Symbol('I_peak')+sp.Symbol('I_peak')**2)/3),
                  'Vswitch':vstress,'Vdiode_reverse':V+N*VIN if key=='flyback' else vstress,
                  'Iripple_pp':ramp,'ILmean':mean if not dcm else sp.Symbol('I_pk')*(D+sp.Symbol('delta'))/2,
                  'ISrms':sp.sqrt(sp.Integral(sp.Function('i_S')(sp.Symbol('t'))**2,(sp.Symbol('t'),0,1/FS))*FS),
                  'IDrms':sp.sqrt(sp.Integral(sp.Function('i_D')(sp.Symbol('t'))**2,(sp.Symbol('t'),0,1/FS))*FS),
                  'ICrms':sp.sqrt(sp.Integral(sp.Function('i_C')(sp.Symbol('t'))**2,(sp.Symbol('t'),0,1/FS))*FS),
                  'IDmean':sp.Integral(sp.Function('i_D')(sp.Symbol('t')),(sp.Symbol('t'),0,1/FS))*FS}
        choices={'duty':('Duty',''), 'Iout':('Ρεύμα εξόδου','A'),
                 'Ipeak':('Ρεύμα κορυφής','A'),'Ivalley':('Ελάχιστο ρεύμα','A'),
                 'Lcrit':('Κρίσιμη επαγωγή','H'),'Vripple_pp':('Κυμάτωση τάσης','Vpp'),
                 'ILrms':('RMS πηνίου / im','A'),'Vswitch':('Τάση διακόπτη','V'),
                 'Vdiode_reverse':('Ανάστροφη τάση διόδου','V'),
                 'Iripple_pp':('Κυμάτωση ρεύματος πηνίου','App'),
                 'ILmean':('Μέσο ρεύμα πηνίου / im','A'),'ISrms':('RMS διακόπτη','A'),
                 'IDrms':('RMS διόδου','A'),'ICrms':('RMS πυκνωτή','A'),'IDmean':('Μέσο ρεύμα διόδου','A')}
        outputs=data.get('outputs',['duty','Iout','Ipeak','Lcrit','Vripple_pp'])
        if not isinstance(outputs,list) or not outputs or any(k not in choices for k in outputs):
            raise InputError('Επιλέξτε ένα ή περισσότερα υποστηριζόμενα ζητούμενα σημείου λειτουργίας.')
        return {'target':'point','goal':'outputs','title':'Επιλεγμένα ζητούμενα σημείου λειτουργίας',
                'config':a['config'],'axes':[],'feasible':True,'mode':a['mode'],
                'outputs':[{'key':k,'name':choices[k][0],'unit':choices[k][1],'value':a['metrics'][k],
                            'equation':math_record(sp.Eq(D if k=='duty' else sp.Symbol(k),formulas[k]))} for k in dict.fromkeys(outputs)],
                'derivation':derivation,
                'steps':derivation['current_steps']+(derivation['ripple_steps'] if 'Vripple_pp' in outputs else []),
                'explanation':'Τα επιλεγμένα ζητούμενα υπολογίζονται με κοινή συνεπή περιοχή αγωγής και τον δηλωμένο νόμο οδήγησης/φορτίου.',
                'method':'Συμβολικό μοντέλο και τμηματικά γραμμικές ράμπες.',
                'scope':'Ιδανικό μοντέλο μικρής κυμάτωσης. Οι τιμές των στοιχείων του κυκλώματος ορίζουν τα γνωστά του σημείου λειτουργίας.'}
    raise InputError('Υποστηριζόμενα ζητούμενα: L, C ή επιλεγμένα μεγέθη σημείου λειτουργίας.')
