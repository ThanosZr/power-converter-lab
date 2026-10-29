"""Custom operating combinations and direct ripple/component design.

Two independent axes are supported. A regulated Vo is a requested setpoint;
with fixed duty, Vo is an output and cannot also be an independent axis.
"""
import numpy as np
from .analysis import config,steady,number,InputError,duty_and_boundary

AXES={'vin','vo','power','fs','n','duty_set','resistance','L','C'}


def transition_sweep(c):
    """A one-axis experiment crossing the physical L boundary at fixed data.

    With fixed-duty R loading, first use the *CCM* output candidate to find
    the boundary. A DCM point's regulated-output Lcrit is not that boundary.
    Fixed-duty CPL is excluded: some families have no unique DCM voltage.
    """
    if c['drive']=='fixed_duty' and c['load']=='constant_power':
        return None
    point=c.copy()
    if c['drive']=='fixed_duty':
        d,n,vin=c['duty_set'],c['n'],c['vin']
        v=vin*d if c['topology']=='buck' else vin/(1-d) if c['topology']=='boost' else vin*d/(1-d)*(n if c['topology']=='flyback' else 1)
        point.update(vo=v,power=v*v/c['resistance'])
    try:
        _,lc=duty_and_boundary(point)
    except InputError:
        # A valid sweep may start from a base point outside the domain; its
        # axes replace those values. An optional demo must not reject it.
        return None
    return {'Lcrit':lc,'axes':[{'field':'L','min':lc*.5,'max':lc*1.5,'points':21}],
            'scope':'Μεταβάλλεται μόνο L από 0,5 έως 1,5 φορές το όριο του τρέχοντος σημείου. Τα Vin, fs, n και ο επιλεγμένος νόμος εξόδου/φορτίου μένουν σταθερά.'}


def axes(data,c):
    raw=data.get('axes',[{'field':'vin','min':8,'max':24,'points':21}])
    if not isinstance(raw,list) or not 1<=len(raw)<=2:
        raise InputError('Ορίστε έναν ή δύο άξονες μεταβολής.')
    out=[]
    for axis in raw:
        if not isinstance(axis,dict) or axis.get('field') not in AXES:
            raise InputError('Μη υποστηριζόμενος άξονας μεταβολής.')
        field=axis['field']
        if c['drive']=='fixed_duty' and field=='vo':
            raise InputError('Με σταθερό duty το Vo είναι αποτέλεσμα. Για ανεξάρτητο εύρος Vo επιλέξτε ρυθμιζόμενη έξοδο.')
        if c['drive']=='regulated' and field in ('duty_set','resistance'):
            raise InputError('Σε ρυθμιζόμενη έξοδο ορίζονται Vin, Vo και Po· D και R προκύπτουν. Αλλάξτε οδήγηση για ανεξάρτητο D ή R.')
        if c['drive']=='fixed_duty' and c['load']=='resistive' and field=='power':
            raise InputError('Με σταθερό duty και ωμικό φορτίο η ισχύς είναι αποτέλεσμα. Χρησιμοποιήστε άξονα R.')
        if c['drive']=='fixed_duty' and c['load']=='constant_power' and field=='resistance':
            raise InputError('Το φορτίο σταθερής ισχύος ορίζεται από Po, όχι από ανεξάρτητη R.')
        lo,hi=number(axis,'min'),number(axis,'max')
        count=int(number(axis,'points',21,low=1,high=41))
        if hi<lo:
            raise InputError('Το άνω όριο κάθε άξονα πρέπει να είναι ≥ του κάτω.')
        if field=='duty_set' and hi>=1:
            raise InputError('Το duty πρέπει να παραμένει μικρότερο του 1.')
        out.append({'field':field,'min':lo,'max':hi,'points':count})
    if len(out)==2 and out[0]['field']==out[1]['field']:
        raise InputError('Οι δύο άξονες πρέπει να είναι διαφορετικά μεγέθη.')
    return out


def scenarios(data):
    c=config(data)
    aa=axes(data,c)
    a0=np.linspace(aa[0]['min'],aa[0]['max'],aa[0]['points'])
    a1=np.linspace(aa[1]['min'],aa[1]['max'],aa[1]['points']) if len(aa)>1 else [None]
    for y in a1:
        for x in a0:
            point={**c,aa[0]['field']:float(x)}
            if y is not None:point[aa[1]['field']]=float(y)
            yield point,float(x),float(y) if y is not None else None


def sweep(data):
    c=config(data);aa=axes(data,c)
    points=[];invalid=[]
    target=number(data,'voltage_ripple',.1,high=1e12)
    for point,x,y in scenarios(data):
        try:
            a=steady(point,False,False);m=a['metrics']
            points.append({'x':x,'y':y,'vin':a['config']['vin'],'vo':a['config']['vo'],
                'power':a['config']['power'],'mode':a['mode'],'duty':m['duty'],
                'L':a['config']['L'],'C':a['config']['C'],'Lcrit':m['Lcrit'],
                'L_margin':m['L_margin'],'Ivalley':m['Ivalley'],
                'idle':m['idle'],'ripple':m['Vripple_pp'],'Ipeak':m['Ipeak'],
                'Iout':m['Iout'],'C_required':m['charge_pp']/target})
        except InputError as e:
            invalid.append({'x':x,'y':y,'reason':str(e)})
    mode_counts={key:sum(p['mode']==key for p in points) for key in ('CCM','BCM','DCM')}
    if points and mode_counts['CCM']==len(points):
        reason='Όλα τα έγκυρα σημεία είναι CCM: σε κάθε σημείο L > Lcrit. Το εύρος που επιλέχθηκε δεν διασχίζει το όριο αγωγής. Μειώστε L ή το φορτίο Po σε ρυθμιζόμενη έξοδο, ή σαρώστε το L γύρω από το όριο.'
    elif points and mode_counts['DCM']==len(points):
        reason='Όλα τα έγκυρα σημεία είναι DCM: σε κάθε σημείο L < Lcrit. Για μετάβαση σε CCM αυξήστε L ή το φορτίο Po σε ρυθμιζόμενη έξοδο.'
    elif points:
        reason='Το πλέγμα περιλαμβάνει διαφορετικές περιοχές αγωγής ή το όριό τους. BCM υπάρχει μόνο όταν L = Lcrit· ένα διακριτό πλέγμα μπορεί να μη συμπέσει ακριβώς με αυτή την καμπύλη.'
    else:
        reason='Δεν υπάρχουν έγκυρα σημεία. Ελέγξτε τις αιτίες απόρριψης.'
    return {'axes':aa,'points':points,'invalid':invalid,'mode_counts':mode_counts,
            'regime_diagnostics':{'explanation':reason,
                'min_Lcrit':min((p['Lcrit'] for p in points),default=None),
                'max_Lcrit':max((p['Lcrit'] for p in points),default=None),
                'min_L_margin':min((p['L_margin'] for p in points),default=None),
                'max_L_margin':max((p['L_margin'] for p in points),default=None)},
            'transition_sweep':transition_sweep(c),
            'C_required_max':max((p['C_required'] for p in points),default=None),
            'max_Lcrit':max((p['Lcrit'] for p in points),default=None),
            'max_ripple':max((p['ripple'] for p in points),default=None),
            'voltage_ripple_target':target,
            'scope':'Καρτεσιανοί συνδυασμοί έως 41×41 σημείων. Η οδήγηση και ο νόμος φορτίου ισχύουν σε κάθε σημείο. Τα μέγιστα αφορούν το δηλωμένο πλέγμα· δεν αποτελούν απόδειξη ορίου σε συνεχές πολυδιάστατο πεδίο. Ο C_required υπολογίζεται από τη μέγιστη διακύμανση φορτίου Δq/ΔV με το τρέχον L.'}


def capacitance(data):
    a=steady(data,False,False)
    target=number(data,'voltage_ripple',.1,high=a['config']['vo'])
    esr=number(data,'ESR',1e-30,low=-1e-30,high=1e6)
    currents=[v for seg in a['intervals'] for v in seg['iC']]
    esr_bound=esr*(max(currents)-min(currents))
    remaining=target-esr_bound
    if remaining<=0 and data.get('task','size')!='check':
        raise InputError('Το συντηρητικό όριο κυμάτωσης ESR μόνο του φτάνει ή ξεπερνά τον στόχο. Μειώστε ESR ή αλλάξτε το σημείο λειτουργίας.')
    q=a['metrics']['charge_pp']
    return {'C_required':q/remaining if remaining>0 else None,'C_existing':a['config']['C'],
            'target':target,'ripple_capacitive_existing':q/a['config']['C'],
            'esr_ripple_bound':esr_bound,'total_ripple_bound_existing':q/a['config']['C']+esr_bound,
            'meets_target':q/a['config']['C']+esr_bound<=target,
            'charge_pp':q,'scope':'C από Δq/(ΔVστόχος−ESR·ΔiC). Η πρόσθεση είναι συντηρητικό άνω όριο, επειδή τα ακρότατα των δύο συνιστωσών δεν συμπίπτουν απαραίτητα. Το ESR δεν ενσωματώνεται ακόμη στις διαφορικές εξισώσεις. Δεν περιλαμβάνονται ανοχές ή DC bias.'}
