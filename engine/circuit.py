"""Connectivity validation and recognition for registered circuit families.

Graphs may be drawn and repositioned freely. Only recognized electrical
connectivity is sent to a family solver; unsupported circuits fail explicitly.
"""
from itertools import product
from functools import wraps
from .analysis import InputError

PORTS={'source':['p','n'],'switch':['a','b'],'diode':['a','k'],
       'inductor':['a','b'],'capacitor':['p','n'],'resistor':['a','b'],
       'transformer':['p1','p2','s1','s2']}
TEMPLATES={
 'buck':{'source':['in','g'],'switch':['in','sw'],'diode':['g','sw'],
         'inductor':['sw','out'],'capacitor':['out','g'],'resistor':['out','g']},
 'boost':{'source':['in','g'],'switch':['sw','g'],'diode':['sw','out'],
          'inductor':['in','sw'],'capacitor':['out','g'],'resistor':['out','g']},
 'buck_boost':{'source':['in','g'],'switch':['in','sw'],'diode':['out','sw'],
              'inductor':['sw','g'],'capacitor':['g','out'],'resistor':['out','g']},
 'flyback':{'source':['in','pg'],'switch':['psw','pg'],'diode':['sec','out'],
            'transformer':['in','psw','sg','sec'],'capacitor':['out','sg'],'resistor':['out','sg']}}


def recognize(data):
    circuit=data.get('circuit',data)
    if not isinstance(circuit,dict):raise InputError('Μη έγκυρο κύκλωμα.')
    components=circuit.get('components',[]);wires=circuit.get('wires',[])
    if not isinstance(components,list) or not isinstance(wires,list) or len(components)>30 or len(wires)>100:
        raise InputError('Μη έγκυρο μέγεθος κυκλώματος.')
    by_type={};pins={};ids=set()
    for component in components:
        if not isinstance(component,dict):raise InputError('Μη έγκυρο στοιχείο.')
        kind,identifier=component.get('type'),component.get('id')
        if kind not in PORTS or not isinstance(identifier,str) or ':' in identifier or not identifier or len(identifier)>40 or identifier in ids:
            raise InputError('Μη έγκυρος τύπος ή αναγνωριστικό στοιχείου.')
        if kind in by_type:raise InputError('Ο παρών engine αναγνωρίζει ένα στοιχείο ανά ρόλο στα βασικά πρότυπα. Αφαιρέστε τα επιπλέον στοιχεία ή χρησιμοποιήστε υποστηριζόμενο πρότυπο.')
        ids.add(identifier);by_type[kind]=identifier
        for port in PORTS[kind]:pins[f'{identifier}:{port}']=f'{identifier}:{port}'
    if not components:raise InputError('Το κύκλωμα είναι κενό. Πρόσθεσε στοιχεία και σύνδεσε τους ακροδέκτες.')
    def find(x):
        while pins[x]!=x:pins[x]=pins[pins[x]];x=pins[x]
        return x
    connected=set()
    for wire in wires:
        if not isinstance(wire,dict):raise InputError('Μη έγκυρη καλωδίωση.')
        a,b=wire.get('from'),wire.get('to')
        if not isinstance(a,str) or not isinstance(b,str) or a not in pins or b not in pins:
            raise InputError('Καλώδιο με άγνωστο ακροδέκτη.')
        pins[find(a)]=find(b);connected.update((a,b))
    missing=[p for p in pins if p not in connected]
    if missing:raise InputError('Ασύνδετοι ακροδέκτες: '+', '.join(missing))
    for topology,template in TEMPLATES.items():
        if set(template)!=set(by_type):continue
        fliptypes=[k for k in ('switch','resistor','inductor') if k in template]
        for flips in product((False,True),repeat=len(fliptypes)):
            orientations=dict(zip(fliptypes,flips));actual=[];expected=[]
            for kind,nodes in template.items():
                terminals=PORTS[kind][::-1] if orientations.get(kind) else PORTS[kind]
                actual.extend(find(f'{by_type[kind]}:{p}') for p in terminals)
                expected.extend(nodes)
            if all((actual[i]==actual[j])==(expected[i]==expected[j]) for i in range(len(actual)) for j in range(i)):
                return {'valid':True,'topology':topology,'nodes':len(set(actual)),
                        'message':'Αναγνωρίστηκε '+topology+' από τη συνδεσμολογία.',
                        'scope':'Αναγνώριση των τεσσάρων καταχωρημένων ιδανικών οικογενειών· δεν είναι γενικός SPICE/MNA λύτης.'}
    raise InputError('Η συνδεσμολογία δεν αντιστοιχεί σε υποστηριζόμενο buck, boost, αντιστρέφοντα buck–boost ή flyback. Ελέγξτε καλώδια, πολικότητα C, δίοδο και τελείες μετασχηματιστή. Δεν εκτελούνται οι τύποι του προηγούμενου προτύπου σε διαφορετικό κύκλωμα.')


def validated(action):
    @wraps(action)
    def solve(data):
        if 'circuit' in data:
            match=recognize(data)
            data={**data,'topology':match['topology']}
        return action(data)
    return solve
