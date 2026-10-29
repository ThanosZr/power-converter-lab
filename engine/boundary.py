"""Inverse BCM design independent of the current operating regime.

Duty is an internally solved variable. The requested unknown may be L,
Vin, Vo, fs, turns ratio, or load. All real algebraic roots are considered
and each physical candidate is checked by the independent steady solver.
"""
import math
import sympy as sp
from .models import symbolic_model,VIN,V,D,L,R,N,FS,P
from .analysis import config,number,steady,InputError,math_record
from .derivation import entry,equation


NAMES={'L':L,'vin':VIN,'vo':V,'fs':FS,'n':N,'power':P,'resistance':R}
DEFAULTS={'L':20e-6,'vin':8,'vo':12,'fs':100000,'n':.5,'power':24,'resistance':6}


def solve_boundary(data):
    unknown=data.get('unknown','L');law=data.get('boundary_load','power')
    if unknown not in NAMES or law not in ('power','resistance'):
        raise InputError('Μη υποστηριζόμενο ζητούμενο ή δήλωση φορτίου για BCM.')
    if unknown=='power' and law=='resistance' or unknown=='resistance' and law=='power':
        raise InputError('Το επιλεγμένο φορτίο είναι εξαρτημένο μέγεθος. Αλλάξτε τη δήλωση φορτίου Po/R.')
    # The ignored unknown is replaced *before* validating inputs. The old
    # regime / fixed-duty point must not constrain the new BCM design.
    raw={**data,'drive':'regulated','duty_set':.5,unknown:DEFAULTS[unknown]}
    # C does not occur in the BCM equations. Keep it only if suitable for
    # the verification point; an empty irrelevant field must not block design.
    try:cap=float(raw.get('C',100e-6))
    except (ValueError,TypeError):cap=100e-6
    raw['C']=cap if math.isfinite(cap) and 1e-12<cap<=100 else 100e-6
    if law=='power' and unknown!='resistance':raw['resistance']=6
    if law=='resistance' and unknown!='power':raw['power']=24
    if raw.get('topology','buck_boost')!='flyback':raw['n']=.5
    c=config(raw);key=c['topology']
    if unknown=='n' and key!='flyback':raise InputError('Λόγος σπειρών υπάρχει μόνο στον flyback.')
    model=symbolic_model(key)
    rawcrit=sp.factor(model['critical'].subs(D,model['duty']))
    if law=='power':rawcrit=sp.factor(rawcrit.subs(R,V**2/P))
    relation=sp.Eq(L,rawcrit,evaluate=False)
    target=NAMES[unknown]
    if target not in relation.free_symbols:raise InputError('Το ζητούμενο δεν εμφανίζεται στη συνθήκη BCM.')
    known={field:c[field] for field,symbol in NAMES.items() if symbol!=target and symbol in relation.free_symbols}
    subs={NAMES[field]:sp.Rational(str(value)) for field,value in known.items()}
    residual=sp.factor((relation.lhs-relation.rhs).subs(subs))
    numerator,denominator=sp.fraction(sp.cancel(residual))
    polynomial=sp.Poly(numerator,target)
    steps=[entry('Ο1 · Νέα απαίτηση: BCM','Η τρέχουσα CCM/DCM κατάσταση δεν επιβάλλεται στη νέα σχεδίαση. Το D λύνεται μαζί με το ζητούμενο από τη συνθήκη του ορίου.',sp.Symbol('I_min'),sp.Integer(0)),
           entry('Ο2 · Ισορροπία volt-seconds στο όριο','Στο BCM το τρίτο διάστημα έχει μηδενική διάρκεια. Άρα ισχύει η CCM σχέση ισορροπίας για το ίδιο το όριο.',V/VIN,model['gain']),
           entry('Ο3 · Εσωτερικός άγνωστος D','Απομονώνεται το duty. Δεν διατηρείται αυθαίρετα το duty της προηγούμενης λειτουργίας.',D,model['duty']),
           entry('Ο4 · Κρίσιμη επαγωγή','Θέτουμε Iavg=ΔI/2 και αντικαθιστούμε D. Το φορτίο ορίζεται από Po ή από R, σύμφωνα με την επιλογή.',L,rawcrit),
           entry('Ο5 · Αντικατάσταση γνωστών',f"Άγνωστο: {unknown}. Τα υπόλοιπα δεδομένα είναι γνωστά· οι μονάδες της εξίσωσης είναι SI.",sp.Integer(0),residual),
           entry('Ο6 · Αλγεβρική επίλυση','Μηδενίζεται ο αριθμητής και αποκλείονται οι μηδενισμοί παρονομαστή. Εξετάζονται όλες οι πραγματικές ρίζες, όχι μόνο μία αρχική αριθμητική εικασία.',sp.Integer(0),polynomial.as_expr())]
    if polynomial.is_zero:
        return {'target':'boundary_inverse','unknown':unknown,'load_law':law,'status':'underdetermined',
                'solutions':[],'rejected':[],'known':known,'steps':steps,
                'explanation':'Η εξίσωση είναι ταυτότητα για τα δεδομένα αυτά. Το ζητούμενο δεν προσδιορίζεται μοναδικά από τη συνθήκη BCM.'}
    roots=sp.polys.polytools.real_roots(polynomial) if polynomial.degree()>0 else []
    solutions=[];rejected=[]
    for root in roots:
        value=float(root.evalf(16))
        if any(math.isclose(value,p['value'],rel_tol=1e-9,abs_tol=1e-13) for p in solutions):continue
        if not math.isfinite(value) or value<=0:
            rejected.append({'value':value if math.isfinite(value) else None,'reason':'Μη θετική ή μη πεπερασμένη ρίζα.'});continue
        den=complex(denominator.subs(target,root).evalf())
        if abs(den)<1e-20:
            rejected.append({'value':value,'reason':'Μηδενισμός παρονομαστή· εξωγενής ρίζα.'});continue
        candidate={**c,unknown:value,'drive':'regulated'}
        if law=='resistance':candidate['power']=candidate['vo']**2/candidate['resistance'];candidate['load']='resistive'
        try:
            a=steady(candidate,False,False);m=a['metrics']
            if a['mode']!='BCM':raise InputError('Η ρίζα δεν επιβεβαιώνει Imin=0 / L=Lcrit.')
            if not 0<m['duty']<1:raise InputError('Το duty δεν βρίσκεται στο (0,1).')
            rel=abs(float(residual.subs(target,root).evalf()))/max(a['config']['L'],1e-20)
            if rel>1e-7:raise InputError('Το υπόλοιπο της αρχικής εξίσωσης είναι υπερβολικά μεγάλο.')
        except InputError as error:
            rejected.append({'value':value,'reason':str(error)});continue
        solutions.append({'value':value,'config':a['config'],'mode':a['mode'],
                          'duty':m['duty'],'Ipeak':m['Ipeak'],'Ivalley':m['Ivalley'],
                          'Lcrit':m['Lcrit'],'relative_residual':rel,
                          'equation':equation(target,sp.Float(value,12))})
    solutions.sort(key=lambda x:x['value'])
    # Simple closed-form parameter solutions stay useful; cubic voltage
    # problems are described by their exact polynomial and isolated roots.
    closed=[]
    if polynomial.degree()<=2:
        for expression in sp.solve(relation,target):
            closed.append(math_record(expression))
    explanation='Βρέθηκαν όλες οι θετικές φυσικά αποδεκτές λύσεις και επιβεβαιώθηκαν σε BCM με νέο duty.' if solutions else 'Δεν υπάρχει θετική φυσικά αποδεκτή λύση BCM μεταβάλλοντας μόνο αυτό το ζητούμενο με τα δηλωμένα γνωστά. Αλλάξτε ένα ακόμη δεδομένο ή περιορισμό.'
    if len(solutions)>1:explanation+=' Η απαίτηση δεν έχει μοναδική λύση· επιλέξτε το επιθυμητό σημείο.'
    return {'target':'boundary_inverse','unknown':unknown,'load_law':law,
            'status':'solved' if solutions else 'no_physical_solution','known':known,
            'solutions':solutions,'rejected':rejected,'steps':steps,'closed_forms':closed,
            'equation':math_record(relation),'polynomial':math_record(sp.Eq(numerator,0,evaluate=False)),
            'explanation':explanation,
            'method':'Συμβολική απαλοιφή D, ακριβής πραγματική απομόνωση ριζών πολυωνύμου, έλεγχος παρονομαστών και αριθμητική επαλήθευση κάθε λύσης στον φυσικό engine.',
            'scope':'Ιδανικό μοντέλο BCM, θετικά μέτρα Vo/Vin, n=Ns/Np. Ένα κύριο ζητούμενο κάθε φορά· D και το εξαρτημένο Po ή R υπολογίζονται εσωτερικά. Η παλιά περιοχή αγωγής δεν δεσμεύει τη λύση.'}
