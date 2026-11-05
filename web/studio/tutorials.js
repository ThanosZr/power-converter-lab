'use strict';
// Tutorial circuits. Each tutorial is a function of its options that returns a
// complete, editable project: components, wires, simulation settings and scopes.
(function(root){
 const C=(id,type,x,y,params={},o={})=>({id,type,x,y,rot:o.rot||0,flip:!!o.flip,label:o.label||id,params,...(o.lbl?{lbl:o.lbl}:{})});
 const J=(id,x,y)=>C(id,'JUNC',x,y,{},{label:''});
 const pin=s=>{const [c,p]=s.split(':');return {c,p:p||'j'};};
 const project=(comps,wires,extra={})=>({version:2,components:comps,wires:wires.map((w,i)=>({id:'w'+(i+1),a:pin(w[0]),b:pin(w[1]),pts:w[2]||[],...(w[3]||{})})),...extra});
 const gnd=(x,y)=>C('G1','GND',x,y,{},{label:'0 V'});
 // PE2 PI design (same as the bidirectional tutorial app): crossover fs/20, PM 60°, ZOH delay Ts
 function piGains(L,vhi,fs,fcRatio=.05,pm=60){const wc=2*Math.PI*fcRatio*fs,phid=wc/fs;let th=Math.PI/2-pm*Math.PI/180-phid;if(th<=0)th=5*Math.PI/180;const wz=wc*Math.tan(th),kp=wc*L*Math.cos(th)/vhi;return {kp,ki:kp*wz,fc:wc/2/Math.PI};}

 const T=[];
 // ------------------------------------------------------------------ Buck
 T.push({id:'buck',group:'DC-DC χωρίς απομόνωση',title:'Buck (υποβιβασμός)',theory:'v1',topology:'buck',
  options:[{k:'load',label:'Φορτίο',options:[['10','R = 10 Ω · CCM'],['50','R = 50 Ω · DCM']],def:'10'},{k:'start',label:'Εκκίνηση',options:[['zero','Από μηδέν (μεταβατικό)'],['steady','Από μόνιμη κατάσταση']],def:'zero'}],
  desc:'Ο διακόπτης S1 εφαρμόζει V_in στο πηνίο για χρόνο D·T. Η δίοδος D1 κρατά τη ροή του ρεύματος όταν ο S1 σβήνει. Μέση τάση εξόδου V_o = D·V_in σε CCM.',
  tasks:['Δεξί κλικ στο L1 → Scope ρεύματος, και στον κόμβο μεταγωγής → τάση κόμβου.','Άλλαξε το D από τον έλεγχο κάτω από το κύκλωμα και δες την έξοδο να ακολουθεί.','Διάλεξε R = 50 Ω: το ρεύμα του πηνίου μηδενίζεται για ένα διάστημα (DCM) και η V_o ανεβαίνει πάνω από D·V_in.'],
  build(o){const R=+o.load,st=o.start==='steady',Vo=R===10?12:18;
   return project([C('V1','VDC',100,210,{V:24},{label:'V_in'}),gnd(100,300),C('S1','SW',200,150,{pwm:'PWM1',out:'a',body:false},{rot:3}),J('J1',270,150),C('D1','D',270,200,{},{rot:3}),
     C('L1','L',340,150,{L:100e-6,i0:st?Vo/R:0}),J('J2',430,150),C('C1','C',430,210,{C:100e-6,v0:st?Vo:0},{label:'C'}),C('R1','R',520,210,{R},{rot:1,label:'R'}),
     J('J3',100,270),J('J4',270,270),J('J5',430,270),C('PWM1','PWM',200,60,{fs:100e3,D:.5})],
    [['V1:p','S1:d',[[100,150]]],['S1:s','J1'],['J1','L1:a'],['J1','D1:k'],['L1:b','J2',[],{name:'v_o'}],['J2','C1:p'],['J2','R1:a',[[520,150]]],
     ['V1:n','J3'],['J3','G1:g'],['J3','J4'],['J4','D1:a'],['J4','J5'],['J5','C1:n'],['J5','R1:b',[[520,270]]]],
    {sim:{hDiv:200,speed:100,stopT:0},scope:{panes:[[['I:L1','i_L']],[['VN:J1:j','v_sw'],['V:C1','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ Boost
 T.push({id:'boost',group:'DC-DC χωρίς απομόνωση',title:'Boost (ανύψωση)',theory:'v1',topology:'boost',
  options:[{k:'load',label:'Φορτίο',options:[['20','R = 20 Ω · CCM'],['200','R = 200 Ω · DCM']],def:'20'},{k:'start',label:'Εκκίνηση',options:[['zero','Από μηδέν'],['steady','Από μόνιμη κατάσταση']],def:'steady'}],
  desc:'Με τον S1 κλειστό το πηνίο αποθηκεύει ενέργεια από την V_in. Όταν ανοίγει, το ρεύμα του πηνίου περνά από τη D1 στην έξοδο. Σε CCM V_o = V_in/(1−D).',
  tasks:['Scope στο ρεύμα της διόδου D1: είναι το ρεύμα που φορτίζει τον πυκνωτή (Θέμα 1 εξετάσεων).','Με R = 200 Ω η έξοδος ξεπερνά τα 24 V: ασυνεχής αγωγή.','Scope ρεύματος στον C1: φαίνεται η φόρτιση/εκφόρτιση που ορίζει την κυμάτωση.'],
  build(o){const R=+o.load,st=o.start==='steady';const Vo=R===20?24:30.2,Il=Vo*Vo/R/12;
   return project([C('V1','VDC',100,210,{V:12},{label:'V_in'}),gnd(100,300),C('L1','L',170,150,{L:100e-6,i0:st&&R===20?Il:0}),J('J1',230,150),C('S1','SW',230,200,{pwm:'PWM1',out:'a',body:false}),
     C('D1','D',290,150),J('J2',360,150),C('C1','C',360,210,{C:220e-6,v0:st?Vo:12}),C('R1','R',450,210,{R},{rot:1,label:'R'}),J('J3',100,270),J('J4',230,270),J('J5',360,270),C('PWM1','PWM',230,60,{fs:100e3,D:.5})],
    [['V1:p','L1:a',[[100,150]]],['L1:b','J1'],['J1','S1:d'],['J1','D1:a'],['D1:k','J2',[],{name:'v_o'}],['J2','C1:p'],['J2','R1:a',[[450,150]]],['V1:n','J3'],['J3','G1:g'],['J3','J4'],['J4','S1:s'],['J4','J5'],['J5','C1:n'],['J5','R1:b',[[450,270]]]],
    {sim:{hDiv:200,speed:100,stopT:0},scope:{panes:[[['I:L1','i_L'],['I:D1','i_D']],[['V:C1','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ Buck-boost
 T.push({id:'buck_boost',group:'DC-DC χωρίς απομόνωση',title:'Buck–boost (αναστροφής)',theory:'v1',topology:'buck_boost',
  options:[{k:'D',label:'Duty',options:[['0.4','D = 0,4 · |V_o| < V_in'],['0.6','D = 0,6 · |V_o| > V_in']],def:'0.4'}],
  desc:'Το πηνίο φορτίζεται από την είσοδο όταν άγει ο S1 και εκφορτίζεται στην έξοδο μέσω της D1. Η έξοδος είναι αρνητική: V_o = −V_in·D/(1−D).',
  tasks:['Δες ότι η τάση του πυκνωτή είναι αρνητική ως προς τη γείωση.','Σύγκρινε το μέσο ρεύμα του πηνίου με το I_o/(1−D).'],
  build(o){const D=+o.D;
   return project([C('V1','VDC',100,210,{V:12},{label:'V_in'}),gnd(100,300),C('S1','SW',200,150,{pwm:'PWM1',out:'a',body:false},{rot:3}),J('J1',270,150),C('L1','L',270,210,{L:100e-6},{rot:1}),
     C('D1','D',330,150,{},{rot:2}),J('J2',400,150),C('C1','C',400,210,{C:220e-6}),C('R1','R',480,210,{R:10},{rot:1,label:'R'}),J('J3',100,270),J('J4',270,270),J('J5',400,270),C('PWM1','PWM',200,60,{fs:100e3,D})],
    [['V1:p','S1:d',[[100,150]]],['S1:s','J1'],['J1','D1:k'],['J1','L1:a'],['D1:a','J2',[],{name:'v_o'}],['J2','C1:p'],['J2','R1:a',[[480,150]]],['V1:n','J3'],['J3','G1:g'],['J3','J4'],['J4','L1:b'],['J4','J5'],['J5','C1:n'],['J5','R1:b',[[480,270]]]],
    {sim:{hDiv:200,speed:200,stopT:0},scope:{panes:[[['I:L1','i_L']],[['V:C1','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ Cuk
 T.push({id:'cuk',group:'DC-DC χωρίς απομόνωση',title:'Ćuk',theory:'formula',topology:'cuk',
  options:[{k:'D',label:'Duty',options:[['0.4','D = 0,4'],['0.6','D = 0,6']],def:'0.4'}],
  desc:'Η ενέργεια μεταφέρεται μέσω του πυκνωτή C1. Και τα δύο πηνία έχουν συνεχές ρεύμα, άρα και η είσοδος και η έξοδος δεν διακόπτονται. V_o = −V_in·D/(1−D).',
  tasks:['Scope τάσης στον C1: μέση τιμή V_in + |V_o|.','Σύγκρινε τις κυματώσεις των δύο πηνίων με αυτές του buck–boost.'],
  build(o){const D=+o.D,Vo=-12*D/(1-D),Io=Vo/8;
   return project([C('V1','VDC',100,210,{V:12},{label:'V_in'}),gnd(100,300),C('L1','L',170,150,{L:200e-6,i0:+(Math.abs(Io)*D/(1-D)).toFixed(5)}),J('JA',230,150),C('S1','SW',230,200,{pwm:'PWM1',out:'a',body:false}),C('C1','C',290,150,{C:10e-6,v0:+(12-Vo).toFixed(5)},{rot:3}),
     J('JB',350,150),C('D1','D',350,200,{},{rot:1}),C('L2','L',420,150,{L:200e-6,i0:+Io.toFixed(5)}),J('JO',490,150),C('C2','C',490,210,{C:100e-6,v0:+Vo.toFixed(5)}),C('R1','R',570,210,{R:8},{rot:1,label:'R'}),
     J('J3',100,270),J('J4',230,270),J('J5',350,270),J('J6',490,270),C('PWM1','PWM',230,60,{fs:100e3,D})],
    [['V1:p','L1:a',[[100,150]]],['L1:b','JA'],['JA','S1:d'],['JA','C1:p'],['C1:n','JB'],['JB','D1:a'],['JB','L2:a'],['L2:b','JO',[],{name:'v_o'}],['JO','C2:p'],['JO','R1:a',[[570,150]]],
     ['V1:n','J3'],['J3','G1:g'],['J3','J4'],['J4','S1:s'],['J4','J5'],['J5','D1:k'],['J5','J6'],['J6','C2:n'],['J6','R1:b',[[570,270]]]],
    {sim:{hDiv:200,speed:200,stopT:0},scope:{panes:[[['I:L1','i_L1'],['I:L2','i_L2']],[['V:C1','v_C1']],[['V:C2','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ SEPIC
 T.push({id:'sepic',group:'DC-DC χωρίς απομόνωση',title:'SEPIC',theory:'formula',topology:'sepic',
  options:[{k:'D',label:'Duty',options:[['0.4','D = 0,4 · V_o < V_in'],['0.6','D = 0,6 · V_o > V_in']],def:'0.6'}],
  desc:'Μη αναστρέφουσα έξοδος που μπορεί να είναι μεγαλύτερη ή μικρότερη από την είσοδο: V_o = V_in·D/(1−D). Ο C1 φορτίζεται μέσα στην περίοδο στη V_in.',
  tasks:['Scope τάσης C1: μέση τιμή V_in.','Δες ότι το ρεύμα της διόδου είναι i_L1 + i_L2 όταν ο S1 είναι OFF.'],
  build(o){const D=+o.D,Vo=12*D/(1-D),Io=Vo/18;
   return project([C('V1','VDC',100,210,{V:12},{label:'V_in'}),gnd(100,300),C('L1','L',170,150,{L:200e-6,i0:+(Io*D/(1-D)).toFixed(5)}),J('JA',230,150),C('S1','SW',230,200,{pwm:'PWM1',out:'a',body:false}),C('C1','C',290,150,{C:10e-6,v0:12},{rot:3}),
     J('JB',350,150),C('L2','L',350,210,{L:200e-6,i0:+(-Io).toFixed(5)},{rot:1}),C('D1','D',410,150),J('JO',480,150),C('C2','C',480,210,{C:100e-6,v0:+Vo.toFixed(5)}),C('R1','R',560,210,{R:18},{rot:1,label:'R'}),
     J('J3',100,270),J('J4',230,270),J('J5',350,270),J('J6',480,270),C('PWM1','PWM',230,60,{fs:100e3,D})],
    [['V1:p','L1:a',[[100,150]]],['L1:b','JA'],['JA','S1:d'],['JA','C1:p'],['C1:n','JB'],['JB','L2:a'],['JB','D1:a'],['D1:k','JO',[],{name:'v_o'}],['JO','C2:p'],['JO','R1:a',[[560,150]]],
     ['V1:n','J3'],['J3','G1:g'],['J3','J4'],['J4','S1:s'],['J4','J5'],['J5','L2:b'],['J5','J6'],['J6','C2:n'],['J6','R1:b',[[560,270]]]],
    {sim:{hDiv:200,speed:200,stopT:0},scope:{panes:[[['I:L1','i_L1'],['I:L2','i_L2']],[['V:C1','v_C1']],[['V:C2','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ Flyback
 T.push({id:'flyback',group:'DC-DC με απομόνωση',title:'Flyback',theory:'v1',topology:'flyback',
  options:[{k:'R',label:'Φορτίο',options:[['8','R = 8 Ω · CCM'],['40','R = 40 Ω · DCM']],def:'8'}],
  desc:'Ο μετασχηματιστής είναι συζευγμένα πηνία: όταν άγει ο S1 αποθηκεύεται ενέργεια στη μαγνήτιση L_m, όταν σβήνει μεταφέρεται στο δευτερεύον μέσω της D1. Σε CCM V_o = V_in·n·D/(1−D), με n = N₂/N₁.',
  tasks:['Scope: ρεύμα μαγνήτισης (Im) και ρεύματα πρωτεύοντος/δευτερεύοντος του T1.','Τάση του διακόπτη: V_in + V_o/n όταν σβήνει.','Με R = 40 Ω το ρεύμα μαγνήτισης μηδενίζεται: DCM.'],
  build(o){const R=+o.R;
   return project([C('V1','VDC',100,210,{V:24},{label:'V_in'}),gnd(100,370),C('T1','XFMR',220,200,{n:.5,Lm:200e-6,pol:'opp'}),C('S1','SW',190,280,{pwm:'PWM1',out:'a',body:false}),
     C('D1','D',310,170),J('JO',380,170),C('C1','C',380,230,{C:220e-6}),C('R1','R',460,230,{R},{rot:1,label:'R'}),
     J('J3',100,340),J('J5',250,290),C('G2','GND',250,320,{},{label:'0 V′'}),J('J6',380,290),C('PWM1','PWM',100,60,{fs:100e3,D:.4})],
    [['V1:p','T1:p1'],['T1:p2','S1:d'],['V1:n','J3'],['J3','G1:g'],['J3','S1:s',[[190,340]]],['T1:s1','D1:a'],['D1:k','JO',[],{name:'v_o'}],['JO','C1:p'],['JO','R1:a',[[460,170]]],
     ['T1:s2','J5'],['J5','G2:g'],['J5','J6'],['J6','C1:n'],['J6','R1:b',[[460,290]]]],
    {sim:{hDiv:200,speed:200,stopT:0},scope:{panes:[[['Im:T1','i_m'],['I2:T1','i_sec']],[['V:S1','v_S1']],[['V:C1','v_o']]],window:{unit:'T',n:10}}});}});
 // ------------------------------------------------------------------ H-bridge DC-DC
 function hbridge(o,inv){
  const comps=[C('V1','VDC',60,220,{V:inv?400:48},{label:'V_d'}),C('S1','SW',180,150,{}),J('JA',180,220),C('S2','SW',180,280,{}),C('S3','SW',380,150,{}),J('JB',380,220),C('S4','SW',380,280,{}),
   C('R1','R',250,220,{R:inv?10:2},{label:'R'}),C('L1','L',320,220,{L:inv?10e-3:2e-3}),J('JT',180,110),J('J0',60,330),gnd(60,350),J('JBt',180,330)];
  const uni=o.pwm==='uni';
  const g={S1:'a',S2:'na',S3:uni?'b':'na',S4:uni?'nb':'a'};for(const k of Object.keys(g)){const c=comps.find(x=>x.id===k);c.params={pwm:'PWM1',out:g[k],body:true};}
  comps.push(C('PWM1','PWM',280,50,inv?{fs:5e3,mode:'spwm',m:+o.m,fref:50,refphase:0}:uni?{fs:20e3,mode:'spwm',m:+o.m,fref:0,refphase:90}:{fs:20e3,mode:'fixed',D:(1+ +o.m)/2}));
  return project(comps,[['V1:p','JT',[[60,110]]],['JT','S1:d'],['JT','S3:d',[[380,110]]],['S1:s','JA'],['JA','S2:d'],['S3:s','JB'],['JB','S4:d'],['JA','R1:a',[],{name:'A'}],['R1:b','L1:a'],['L1:b','JB',[],{name:'B'}],
    ['V1:n','J0'],['J0','G1:g'],['J0','JBt'],['JBt','S2:s'],['JBt','S4:s',[[380,330]]]],
   {sim:inv?{hDiv:100,speed:500,stopT:0}:{hDiv:200,speed:100,stopT:0},scope:{panes:[[['V:R1','v_R'],['VN:JA:j','v_A']],[['I:L1','i_o']]],window:inv?{unit:'T',n:200}:{unit:'T',n:6}}});}
 T.push({id:'hbridge',group:'Γέφυρες',title:'Full-bridge DC-DC (H-γέφυρα)',theory:'formula',topology:'hbridge',
  options:[{k:'pwm',label:'Διαμόρφωση',options:[['bi','Διπολική (S1,S4 | S2,S3)'],['uni','Μονοπολική (δύο σκέλη)']],def:'bi'},{k:'m',label:'v_control / V_tri',options:[['0.5','0,5'],['0.2','0,2'],['-0.5','−0,5']],def:'0.5'}],
  desc:'Τετράγωνη γέφυρα με φορτίο R–L. Στη διπολική διαμόρφωση η v_AB εναλλάσσεται ±V_d. Στη μονοπολική παίρνει 0 και ±V_d με διπλάσια φαινόμενη συχνότητα. Σε κάθε περίπτωση V_o = (v_control/V_tri)·V_d.',
  tasks:['Σύγκρινε την κυμάτωση του ρεύματος στη διπολική και στη μονοπολική για το ίδιο m.','Με αρνητικό m η μέση τάση αλλάζει πρόσημο: λειτουργία δύο τεταρτημορίων τάσης.'],
  build(o){const p=hbridge(o,false);p.scope.panes=[[['VN:JA:j','v_A'],['VN:JB:j','v_B']],[['I:L1','i_o']]];return p;}});
 T.push({id:'inverter',group:'Γέφυρες',title:'Μονοφασικός αντιστροφέας SPWM',theory:'formula',topology:'inverter',
  options:[{k:'pwm',label:'Διαμόρφωση',options:[['bi','Διπολική'],['uni','Μονοπολική']],def:'uni'},{k:'m',label:'Δείκτης m',options:[['0.8','0,8'],['0.5','0,5'],['1','1,0']],def:'0.8'}],
  desc:'Ημιτονοειδής αναφορά 50 Hz συγκρίνεται με τριγωνικό φορέα 5 kHz. Το πλάτος της θεμελιώδους στη γραμμική περιοχή είναι m·V_d.',
  tasks:['Παράθυρο 20 ms (100 περίοδοι φορέα): το ρεύμα του R–L φορτίου είναι σχεδόν ημιτονοειδές.','Σύγκρινε την κορυφή του ρεύματος με m·V_d/|R + jωL|.'],
  build(o){const p=hbridge(o,true);p.scope.panes=[[['V:R1','v_R'],['VN:JA:j','v_A']],[['I:L1','i_o']]];return p;}});
 // ------------------------------------------------------------------ rectifier
 T.push({id:'rectifier',group:'Ανορθωτές',title:'Ανορθωτής γέφυρας → μπαταρία',theory:'formula',topology:'rectifier',
  options:[{k:'Ls',label:'Αυτεπαγωγή πηγής',options:[['0','L_s = 0'],['0.002','L_s = 2 mH']],def:'0'},{k:'E',label:'Μπαταρία E',options:[['200','E = 200 V'],['150','E = 150 V']],def:'200'}],
  desc:'Πηγή 230 V / 50 Hz, μονοφασική γέφυρα διόδων, φορτίο μπαταρίας E σε σειρά με R = 2 Ω (Θέμα 2). Ρεύμα υπάρχει μόνο όταν |v_s| > E.',
  tasks:['Scope ρεύματος στο R: παλμοί γύρω από τις κορυφές της τάσης.','Μέτρησε μέση και RMS τιμή στο παράθυρο μίας περιόδου και σύγκρινε με τη θεωρία.','Με L_s = 2 mH οι παλμοί διευρύνονται και η κορυφή μειώνεται.'],
  build(o){
   return project([C('V1','VAC',260,210,{Vpk:230*Math.SQRT2,f:50,Ls:+o.Ls},{rot:1,label:'v_s',lbl:'below'}),C('D1','D',200,160,{},{rot:3}),C('D3','D',200,260,{},{rot:3}),J('JA',200,210),C('D2','D',320,160,{},{rot:3}),C('D4','D',320,260,{},{rot:3}),J('JB',320,210),
     J('JP',200,110),J('JPR',320,110),J('JN',200,310),J('JNR',320,310),C('R1','R',440,170,{R:2},{rot:1,label:'R'}),C('E1','VDC',440,260,{V:+o.E},{label:'E'}),gnd(200,340)],
    [['JA','V1:n'],['V1:p','JB'],['D1:a','JA'],['JA','D3:k'],['D2:a','JB'],['JB','D4:k'],['D1:k','JP'],['JP','JPR',[],{name:'v_d+'}],['JPR','D2:k'],['JPR','R1:a',[[440,110]]],['R1:b','E1:p'],
     ['D3:a','JN'],['JN','JNR'],['JNR','D4:a'],['JNR','E1:n',[[440,310]]],['JN','G1:g']],
    {sim:{hDiv:2000,speed:2,stopT:0},scope:{panes:[[['V:V1','v_s']],[['I:R1','i_o']]],window:{unit:'T',n:2}}});}});
 // ------------------------------------------------------------------ bidirectional battery (PE2)
 T.push({id:'battery',group:'Αμφίδρομος · μπαταρία (PE2)',title:'Αμφίδρομος μετατροπέας μπαταρίας',theory:'bidir',topology:'bidir',
  options:[{k:'pos',label:'Θέση αποθήκευσης',options:[['above','> 50 V (60–100 V)'],['below','< 50 V (25–40 V)']],def:'above'},
   {k:'vst',label:'V_st',options:[['min','ελάχιστη'],['mid','μέση'],['max','μέγιστη']],def:'max'},
   {k:'dir',label:'Ισχύς',options:[['dis','Εκφόρτιση +40 kW'],['chg','Φόρτιση −40 kW']],def:'dis'},
   {k:'bus',label:'Ζυγός',options:[['ideal','Ιδανική πηγή 50 V (ερ. 5)'],['system','Πηγή 50 V/1 mΩ + C + φορτίο']],def:'ideal'},
   {k:'ctrl',label:'Έλεγχος',options:[['fixed','Σταθερό D = D₀ (χειροκίνητα ζωντανά)'],['zero','D₀ με i_L(0) = 0'],['pulse','Παλμός ΔD: φόρτιση ↔ εκφόρτιση'],['pi','PI ρεύματος + αναστροφή στα 3 ms']],def:'fixed'}],
  desc:'Σύγχρονη ημιγέφυρα ανάμεσα σε ζυγό 50 V και αποθήκευση. Το πηνίο είναι πάντα στη χαμηλή πλευρά και D είναι το duty του κάτω S2. Με αποθήκευση > 50 V η εκφόρτιση είναι buck, με < 50 V είναι boost. Η φορά της ισχύος αλλάζει μόνο μέσω του ρεύματος: στο D₀ = 1 − V_lo/V_hi το ρεύμα μένει όπου είναι.',
  tasks:['«Σταθερό D»: μετακίνησε ζωντανά το D λίγο πάνω ή κάτω από το D₀. Το ρεύμα περνά από το μηδέν και η ισχύς αλλάζει φορά, και όταν επιστρέψεις στο D₀ μένει εκεί.','«i_L(0) = 0»: χωρίς σωστό αρχικό ρεύμα το κύκλωμα δεν πάει ποτέ στα 40 kW.','«Πηγή + C + φορτίο»: στα 5 ms το φορτίο πέφτει 60 → 30 kW, η μονόδρομη πηγή μπλοκάρει και ο ζυγός ανεβαίνει.'],
  build(o){
   const above=o.pos!=='below',win=above?{min:60,mid:80,max:100}:{min:25,mid:32.5,max:40},vst=win[o.vst]||win.max,P=o.dir==='chg'?-40e3:40e3,fs=20e3,L=5.6e-6;
   const vbus=50,vlo=above?vbus:vst,vhi=above?vst:vbus,D0=1-vlo/vhi,I=above?-P/vbus:P/vst,sys=o.bus==='system';
   const g=piGains(L,vhi,fs);const dt=L*Math.abs(2*I)/(vhi*.05);
   let pwm={fs,mode:'fixed',D:+D0.toFixed(6)},i0=o.ctrl==='zero'?0:I;
   if(o.ctrl==='pulse'){const sgn=Math.sign(-2*I);const t1=1e-3,t2=t1+Math.round(dt*fs)/fs;pwm.dsched=`0:${D0.toFixed(6)}, ${t1}:${(D0+sgn*.05).toFixed(6)}, ${t2.toFixed(6)}:${D0.toFixed(6)}`;}
   if(o.ctrl==='pi'){pwm={fs,mode:'pi',sensor:'L1',qty:'I',ref:sys?`0:${I.toFixed(3)}`:`0:${I.toFixed(3)}, 0.003:${(-I).toFixed(3)}`,Kp:+g.kp.toPrecision(5),Ki:+g.ki.toPrecision(5),ff:'ratio',ffA:above?(sys?'CB':'VB'):'VS',ffB:above?'VS':(sys?'CB':'VB'),dmin:.01,dmax:.99};i0=sys?I:0;}
   if(sys&&o.ctrl!=='pi')i0=I;
   const sw={Ron:1e-7,body:true};
   const comps=[C('L1','L',360,170,{L,i0:+i0.toFixed(4)}),J('JM',430,170),C('S1','SW',430,100,{pwm:'PWM1',out:'na',...sw}),C('S2','SW',430,220,{pwm:'PWM1',out:'a',...sw}),J('J2',430,300),C('PWM1','PWM',200,60,pwm)];
   const wires=[['L1:b','JM'],['S1:s','JM'],['JM','S2:d'],['J2','S2:s']];
   const bus=(x)=>{ // bus side, either ideal or full system; x = connection point column
    if(!sys){comps.push(C('VB','VDC',x,230,{V:vbus},{label:'V_bus'}));return ['VB','VB'];}
    const vb0=(50+Math.sqrt(Math.max(0,2500-4e-3*(60e3-(above?P:P)))))/2;
    comps.push(C('VSRC','VDC',x-140,230,{V:50,Rs:1e-3,uni:true},{label:'V_src'}),C('CB','C',x,230,{C:.1,esr:2e-4,v0:+vb0.toFixed(4)},{label:'C_bus'}),C('LD','CPL',x+100,230,{P:60e3,sched:'0:60000, 0.005:30000'},{label:'Φορτίο'}));
    return ['VSRC','CB','LD'];};
   if(above){ // bus low (left), storage high (right)
    const ids=bus(sys?190:100);comps.push(C('VS','VDC',540,190,{V:vst},{label:'V_st'}),gnd(sys?100:100,330));
    wires.push(['S1:d','VS:p',[[430,60],[540,60]]],['J2','VS:n',[[540,300]]]);
    if(!sys){wires.push(['VB:p','L1:a',[[100,170]],{name:'v_bus'}],['VB:n','J1'],['J1','G1:g'],['J1','J2']);comps.push(J('J1',100,300));comps.find(c=>c.id==='G1').y=330;}
    else{comps.push(J('JC',190,170),J('JL',290,170),J('J1',50,300),J('JC2',190,300),J('JL2',290,300));comps.find(c=>c.id==='G1').x=50;
     wires.push(['VSRC:p','JC',[[50,170]]],['JC','CB:p'],['JC','JL',[],{name:'v_bus'}],['JL','LD:p'],['JL','L1:a'],['VSRC:n','J1'],['J1','G1:g'],['J1','JC2'],['JC2','CB:n'],['JC2','JL2'],['JL2','LD:n'],['JL2','J2']);}
    void ids;
   }else{ // storage low (left), bus high (right)
    comps.push(C('VS','VDC',100,230,{V:vst},{label:'V_st'}),J('J1',100,300),gnd(100,330));
    wires.push(['VS:p','L1:a',[[100,170]]],['VS:n','J1'],['J1','G1:g'],['J1','J2']);
    if(!sys){comps.push(C('VB','VDC',540,190,{V:vbus},{label:'V_bus'}));wires.push(['S1:d','VB:p',[[430,60],[540,60]],{name:'v_bus'}],['J2','VB:n',[[540,300]]]);}
    else{comps.push(C('CB','C',540,190,{C:.1,esr:2e-4,v0:+((50+Math.sqrt(Math.max(0,2500-4e-3*(60e3-P))))/2).toFixed(4)},{label:'C_bus'}),C('LD','CPL',650,190,{P:60e3,sched:'0:60000, 0.005:30000'},{label:'Φορτίο'}),C('VSRC','VDC',760,190,{V:50,Rs:1e-3,uni:true},{label:'V_src'}),
      J('JH1',540,60),J('JH2',650,60),J('JR1',540,300),J('JR2',650,300));
     wires.push(['S1:d','JH1',[[430,60]],{name:'v_bus'}],['JH1','CB:p'],['JH1','JH2'],['JH2','LD:p'],['JH2','VSRC:p',[[760,60]]],['J2','JR1'],['JR1','CB:n'],['JR1','JR2'],['JR2','LD:n'],['JR2','VSRC:n',[[760,300]]]);}
   }
   const busId=sys?'CB':'VB';
   const panes=[[['I:L1','i_L'],...(o.ctrl==='pi'?[['REF:PWM1','I_ref']]:[])],[['V:'+busId,'v_bus'],...(sys?[['I:VSRC','i_src']]:[])],[['D:PWM1','D']]];
   if(sys)panes[1]=[['V:'+busId,'v_bus']],panes.splice(2,0,[['I:VSRC','i_src'],['I:LD','i_φορτίου']]);
   return project(comps,wires,{sim:{hDiv:500,speed:o.ctrl==='fixed'?100:400,stopT:sys?7e-3:0},scope:{panes,window:{unit:'T',n:o.ctrl==='fixed'||o.ctrl==='zero'?20:200}},
    meta:{above,vst,vbus,P,D0,I,vlo,vhi,pi:g,pulse:dt}});}});
 // ------------------------------------------------------------------ empty
 T.push({id:'empty',group:'Νέο',title:'Κενό κύκλωμα',theory:null,options:[],desc:'Ξεκίνα από την αρχή: πρόσθεσε στοιχεία από τη βιβλιοθήκη (κλικ ή σύρσιμο), ένωσε ακροδέκτες και πάτα ▶.',tasks:['Χρειάζεται γείωση (σύμβολο 0 V) και μπλοκ PWM για τους διακόπτες.'],
  build(){return project([gnd(200,300),C('PWM1','PWM',200,80,{fs:20e3,D:.5})],[],{sim:{hDiv:200,speed:100,stopT:0},scope:{panes:[[]],window:{unit:'T',n:10}}});}});
 root.Tutorials={list:T,piGains,get:id=>T.find(t=>t.id===id)};
})(window);
