"""Explicit model, equilibrium, Jacobians and transfer-function derivation."""
import sympy as sp
from .analysis import steady,math_record
from .models import symbolic_model,MODELS,VIN,V,I,D,L,C,R,N,FS,P,S
from .dynamics import dcm_model,linearize
from .derivation import entry,equation


def model_proof(data):
    op=steady(data,False,False);c,m=op['config'],op['metrics']
    mode=op['mode'];key=c['topology'];load=c['load']
    model=symbolic_model(key,load)
    on,off=MODELS[key].fields(load)
    t=sp.Symbol('t',real=True)
    states=sp.Matrix([sp.Function('i_m' if key=='flyback' else 'i_L')(t),sp.Function('v_o')(t)])
    derivatives=states.diff(t)
    steps=[entry('Μ1 · Μεταβλητές κατάστασης','Κατάσταση: ρεύμα πηνίου/μαγνήτισης και μέτρο τάσης εξόδου. Flyback: n=Ns/Np και im αναγμένο στο πρωτεύον.',sp.Symbol('x'),states),
           entry('Μ2 · KVL/KCL με S ON','Πρώτη γραμμή: νόμος πηνίου. Δεύτερη: KCL στον πυκνωτή. Δεν υποκαθίσταται η έξοδος με σταθερή τάση στη δυναμική εξίσωση.',derivatives,on),
           entry('Μ3 · KVL/KCL με S OFF / δίοδο ON','Στον flyback γίνεται η αναγωγή τόσο της τάσης στο πρωτεύον όσο και του ρεύματος στο δευτερεύον.',derivatives,off)]
    if mode in ('CCM','BCM'):
        average=D*on+(1-D)*off
        steps.extend([
          entry('Μ4 · Μέσο μοντέλο δύο διαστημάτων','Σε CCM τα δύο διαστήματα καλύπτουν ολόκληρη την περίοδο: f=D fON+(1−D)fOFF.',derivatives,average),
          entry('Μ5 · Μόνιμη κατάσταση','Μηδενίζουμε τις παραγώγους. Η πρώτη σχέση ισοδυναμεί με ισορροπία volt-seconds και η δεύτερη με ισορροπία φορτίου.',sp.zeros(2,1),average),
          entry('Μ6 · Απόδειξη του κέρδους και του duty','Λύνουμε ταυτόχρονα τις εξισώσεις ισορροπίας. Το κέρδος εδώ αφορά CCM και το όριό της.',V/VIN,model['gain']),
          entry('Μ7 · Επίλυση ως προς D','Το duty δεν επιβάλλεται από έναν αυθαίρετο τύπο· απομονώνεται από τη σχέση ισορροπίας.',D,model['duty']),
          entry('Μ8 · Γραμμικοποίηση','Υποθέτουμε μικρές διαταραχές γύρω από το σημείο λειτουργίας και κρατάμε όρους πρώτης τάξης.',sp.Symbol('A'),model['A']),
          entry('Μ9 · Παράγωγος ως προς duty','Bd=(∂f/∂d) στο σημείο ισορροπίας. Ο όρος αυτός εκφράζει τη μεταβολή των διαστημάτων αγωγής.',sp.Symbol('B_d'),model['Bd']),
          entry('Μ10 · Παράγωγος ως προς είσοδο','Bg=(∂f/∂Vin) στο σημείο ισορροπίας.',sp.Symbol('B_g'),model['Bg'])])
        a,bd,bg=model['A'],model['Bd'],model['Bg'];dimension=2;output=sp.Matrix([[0,1]])
    else:
        dc=dcm_model(key,load)
        io=sp.Symbol('I_o',positive=True)
        steps.extend([
          entry('Μ4 · Τρίτο διάστημα DCM','Το ρεύμα μηδενίζεται και παραμένει μηδενικό έως τον επόμενο παλμό. Η OFF διάρκεια είναι δT, όχι υποχρεωτικά (1−D)T.',sp.Symbol('delta'),dc['delta']),
          entry('Μ5 · Κορυφή ρεύματος από το ON','Το ρεύμα ξεκινά από μηδέν: Ipk=(vL,ON/L)DT.',sp.Symbol('I_pk'),dc['Ipeak']),
          entry('Μ6α · Εμβαδόν τριγωνικών ραμπών','Μέσο ρεύμα = εμβαδόν / περίοδος. Στον flyback το δευτερεύον ρεύμα είναι im/n.',io,sp.Symbol('I_pk')*(D+sp.Symbol('delta'))/2 if key=='buck' else sp.Symbol('I_pk')*sp.Symbol('delta')/(2*(N if key=='flyback' else 1))),
          entry('Μ6β · Μέσο ρεύμα προς την έξοδο','Αντικαθιστούμε το Ipk και το δ. Ο buck δίνει ρεύμα στην έξοδο και στο ON· οι άλλοι μόνο στο OFF.',io,dc['jout']),
          entry('Μ7 · Δυναμική εξίσωση πυκνωτή','Αντικαθιστούμε το μέσο ρεύμα προς την έξοδο και τον νόμο φορτίου: C·dVo/dt=j−iLoad.',sp.Derivative(states[1],t),dc['field']),
          entry('Μ8 · Μόνιμη κατάσταση DCM','Θέτουμε j−iLoad=0. Η CCM σχέση κέρδους δεν εφαρμόζεται εδώ.',sp.Integer(0),sp.factor(dc['jout']-dc['load']))])
        duty=sp.solve(sp.Eq(dc['jout'],dc['load']),D)
        if duty:steps.append(entry('Μ9 · Duty DCM από το ισοζύγιο','Απομονώνουμε το θετικό D από την εξίσωση μέσου ρεύματος και ελέγχουμε D+δ<1.',D,duty[0]))
        a,bd,bg=sp.Matrix([[dc['A']]]),sp.Matrix([[dc['Bd']]]),sp.Matrix([[dc['Bg']]])
        dimension=1;output=sp.Matrix([[1]])
        steps.extend([entry('Μ10 · Γραμμικοποίηση DCM','Από το μονοδιάστατο μέσο μοντέλο: A=∂f/∂Vo.',sp.Symbol('A'),a),
                      entry('Μ11 · Είσοδοι μικρού σήματος','Bd=∂f/∂d. Το γρήγορο υποκυκλικό ρεύμα έχει απαλειφθεί, επειδή μηδενίζεται σε κάθε περίοδο.',sp.Symbol('B_d'),bd),
                      entry('Μ12 · Διαταραχή εισόδου','Bg=∂f/∂Vin.',sp.Symbol('B_g'),bg)])
    xhat=sp.MatrixSymbol('x_hat',dimension,1)
    dhat,vghat=sp.symbols('d_hat v_in_hat')
    matrix=sp.factor(S*sp.eye(dimension)-a)
    steps.extend([
      entry('Σ1 · Laplace με μηδενικές αρχικές συνθήκες','Από d(xhat)/dt=A·xhat+Bd·dhat+Bg·vghat προκύπτει (sI−A)xhat=Bd·dhat+Bg·vghat.',matrix*xhat,bd*dhat+bg*vghat),
      entry('Σ2 · Πίνακας του συστήματος','Αυτός ο πίνακας αντιστρέφεται για να εκφράσουμε τις καταστάσεις ως συνάρτηση των διαταραχών.',sp.Symbol('sI_minus_A'),matrix),
      entry('Σ2α · Χαρακτηριστικό πολυώνυμο','Η ορίζουσα det(sI−A) δίνει τους πόλους του μέσου μοντέλου πριν από τυχόν απλοποιήσεις εισόδου/εξόδου.',sp.Symbol('det_sI_minus_A'),sp.factor(matrix.det())),
      entry('Σ3 · Duty → έξοδος','Θέτουμε vghat=0, λύνουμε xhat=(sI−A)⁻¹Bd·dhat και επιλέγουμε την έξοδο.',sp.Function('G_vd')(S),sp.factor((output*matrix.inv()*bd)[0])),
      entry('Σ4 · Είσοδος → έξοδος','Θέτουμε dhat=0 και επιλέγουμε την ίδια έξοδο.',sp.Function('G_vg')(S),sp.factor((output*matrix.inv()*bg)[0]))])
    transfer=linearize(c)
    if transfer['available']:
        steps.append({'title':'Σ5 · Αντικατάσταση του τρέχοντος σημείου','explanation':f"Vin={c['vin']:.8g} V, |Vo|={c['vo']:.8g} V, D={m['duty']:.8g}, L={c['L']:.8g} H, C={c['C']:.8g} F, Rσημείου={m['R']:.8g} Ω, fs={c['fs']:.8g} Hz, n={c['n']:.8g}.", 'math':transfer['Gvd_numeric']})
    else:
        dc=dcm_model(key,load)
        steps.append(entry('Σ5 · Όριο BCM — δύο γειτονικοί κλάδοι','Το μέσο CCM μοντέλο παραπάνω δίνει τον έναν γειτονικό κλάδο. Ο DCM κλάδος έχει διαφορετική δυναμική. Δεν ορίζεται μία μοναδική ομαλή συνάρτηση μεταφοράς ακριβώς στο BCM.',sp.Function('G_vd_DCM')(S),dc['Gvd']))
    return {'config':c,'mode':mode,'steps':steps,'transfer':transfer,
            'method':'Οι εξισώσεις καταστάσεων, οι ισορροπίες, οι Jacobian και η αντιστροφή του sI−A υπολογίζονται συμβολικά από τον ίδιο φυσικό πυρήνα που χρησιμοποιείται για τη λύση.',
            'scope':transfer.get('scope',transfer.get('reason',''))}
