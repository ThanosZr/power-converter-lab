'use strict';
// Component catalog shared by the editor (symbols, pins, parameter forms) and
// the simulator (pin names, parameter defaults). Local coordinates use a 10-unit
// grid; pins always sit on grid points so wires stay orthogonal.
(function(root){
 const num=(k,label,unit,def,extra={})=>({k,label,unit,def,type:'num',...extra});
 const sel=(k,label,options,def,extra={})=>({k,label,type:'select',options,def,...extra});
 const txt=(k,label,def,extra={})=>({k,label,type:'text',def,...extra});
 const ref=(k,label,kinds,extra={})=>({k,label,type:'ref',kinds,def:'',...extra});
 const bool=(k,label,def,extra={})=>({k,label,type:'bool',def,...extra});
 const SCHED='Πρόγραμμα: ζεύγη «t:τιμή» χωρισμένα με κόμμα, π.χ. 0:60000, 0.005:30000. Κενό = σταθερή τιμή.';
 const PARTS={
  R:{name:'Αντίσταση',prefix:'R',group:'Παθητικά',pins:{a:[-30,0],b:[30,0]},box:[-22,-8,44,16],
   params:[num('R','Αντίσταση','Ω',10),txt('sched','R(t)','',{hint:SCHED})],
   value:p=>p.R,unit:'Ω',
   draw:()=>'<path d="M-30,0 H-20 l2.5,-7 5,14 5,-14 5,14 5,-14 5,14 5,-14 5,14 2.5,-7 H30"/>'},
  L:{name:'Πηνίο',prefix:'L',group:'Παθητικά',pins:{a:[-30,0],b:[30,0]},box:[-24,-9,48,11],
   params:[num('L','Αυτεπαγωγή','H',100e-6),num('i0','Αρχικό ρεύμα a→b','A',0,{signed:true,hint:'i_L(0): ρεύμα από τον ακροδέκτη a προς τον b.'}),num('Rs','Αντίσταση τυλίγματος','Ω',0,{zero:true})],
   value:p=>p.L,unit:'H',
   draw:()=>'<path d="M-30,0 H-24 a6,6 0 0,1 12,0 a6,6 0 0,1 12,0 a6,6 0 0,1 12,0 a6,6 0 0,1 12,0 H30"/>'},
  C:{name:'Πυκνωτής',prefix:'C',group:'Παθητικά',pins:{p:[0,-30],n:[0,30]},box:[-15,-7,30,14],
   params:[num('C','Χωρητικότητα','F',100e-6),num('v0','Αρχική τάση p−n','V',0,{signed:true}),num('esr','ESR','Ω',0,{zero:true})],
   value:p=>p.C,unit:'F',
   draw:()=>'<path d="M0,-30 V-5 M-15,-5 H15 M-15,5 H15 M0,5 V30"/><path class="thin" d="M8,-14 h6 M11,-17 v6"/>'},
  VDC:{name:'Πηγή DC / μπαταρία',prefix:'V',group:'Πηγές',pins:{p:[0,-40],n:[0,40]},box:[-17,-17,34,34],
   params:[num('V','Τάση','V',12,{signed:true}),num('Rs','Εσωτερική αντίσταση','Ω',0,{zero:true}),bool('uni','Μονόδρομη (δίοδος σε σειρά)',false),txt('sched','V(t)','',{hint:SCHED})],
   value:p=>p.V,unit:'V',
   draw:p=>p.uni?'<path d="M0,-40 V-34 M0,-24 V-16 M0,16 V40"/><path class="fill" d="M-5,-24 L5,-24 L0,-33 Z"/><path d="M-6,-34 H6"/><circle r="16"/><path class="thin" d="M-4,-7 h8 M0,-11 v8 M-4,8 h8"/>':'<path d="M0,-40 V-16 M0,16 V40"/><circle r="16"/><path class="thin" d="M-4,-7 h8 M0,-11 v8 M-4,8 h8"/>'},
  VAC:{name:'Πηγή AC',prefix:'V',group:'Πηγές',pins:{p:[0,-40],n:[0,40]},box:[-17,-17,34,34],
   params:[num('Vpk','Πλάτος','V',325),num('f','Συχνότητα','Hz',50),num('phase','Φάση','°',0,{signed:true,zero:true}),num('off','DC offset','V',0,{signed:true,zero:true}),num('Rs','Εσωτερική αντίσταση','Ω',0,{zero:true}),num('Ls','Εσωτερική αυτεπαγωγή','H',0,{zero:true})],
   value:p=>p.Vpk,unit:'V',
   draw:()=>'<path d="M0,-40 V-16 M0,16 V40"/><circle r="16"/><path class="thin" d="M-9,0 c3,-10 6,-10 9,0 c3,10 6,10 9,0"/>'},
  VAC3:{name:'Τριφασική πηγή (Y)',prefix:'V',group:'Πηγές',pins:{a:[40,-20],b:[40,0],c:[40,20],n:[0,40]},box:[-20,-30,40,60],
   params:[num('Vpk','Πλάτος φασικής τάσης','V',325),num('f','Συχνότητα','Hz',50),num('phase','Φάση της a','°',0,{signed:true,zero:true}),
    sel('seq','Διαδοχή φάσεων',[['abc','a → b → c'],['acb','a → c → b']],'abc'),num('Rs','Αντίσταση ανά φάση','Ω',0,{zero:true}),num('Ls','Αυτεπαγωγή ανά φάση','H',0,{zero:true})],
   value:p=>p.Vpk,unit:'V',
   draw:()=>'<rect class="block" x="-20" y="-30" width="40" height="60" rx="6"/><path d="M20,-20 H40 M20,0 H40 M20,20 H40 M0,30 V40"/><path class="thin" d="M-11,-20 c2,-7 5,-7 7,0 c2,7 5,7 7,0 M-11,0 c2,-7 5,-7 7,0 c2,7 5,7 7,0 M-11,20 c2,-7 5,-7 7,0 c2,7 5,7 7,0"/>'},
  IDC:{name:'Πηγή ρεύματος',prefix:'I',group:'Πηγές',pins:{p:[0,-40],n:[0,40]},box:[-17,-17,34,34],
   params:[num('I','Ρεύμα (βγαίνει από το p)','A',1,{signed:true}),txt('sched','I(t)','',{hint:SCHED})],
   value:p=>p.I,unit:'A',
   draw:()=>'<path d="M0,-40 V-16 M0,16 V40"/><circle r="16"/><path class="thin" d="M0,10 V-9 M-5,-3 L0,-10 L5,-3"/>'},
  SW:{name:'Διακόπτης (MOSFET / IGBT)',prefix:'S',group:'Ημιαγωγοί',pins:{d:[0,-30],s:[0,30]},box:[-16,-17,43,34],
   params:[sel('gate','Οδήγηση',[['pwm','Από PWM'],['on','Πάντα ON'],['off','Πάντα OFF']],'pwm'),ref('pwm','Μπλοκ PWM',['PWM'],{show:p=>p.gate==='pwm'}),
    sel('out','Έξοδος PWM',[['a','g (κύρια)'],['na','ḡ (συμπληρωματική)'],['b','g₂ (2ο σκέλος)'],['nb','ḡ₂']],'a',{show:p=>p.gate==='pwm'}),
    sel('model','Μοντέλο',[['mos','MOSFET: R_on, άγει και ανάστροφα'],['igbt','IGBT: V_ce0 + R_on, μόνο ορθή φορά']],'mos'),
    num('Ron','R_on','Ω',1e-3),num('Vce0','V_ce0 (κατώφλι αγωγής)','V',1,{zero:true,show:p=>p.model==='igbt'}),num('Roff','R_off','Ω',1e6),
    bool('body','Αντιπαράλληλη δίοδος',true),num('Vfd','V_f διόδου','V',0,{zero:true,show:p=>p.body}),num('Rd','R_on διόδου','Ω',0,{zero:true,show:p=>p.body,hint:'0 = ίδια με το R_on του διακόπτη.'}),
    num('Eon','E_on (ενέργεια ανοίγματος)','J',0,{zero:true,hint:'Μετρημένη στις V_ref, I_ref. Κλιμακώνεται με |v|·|i| τη στιγμή της μεταγωγής. 0 = χωρίς απώλειες μεταγωγής.'}),num('Eoff','E_off (ενέργεια σβέσης)','J',0,{zero:true}),
    num('Vref','V_ref','V',600,{show:p=>+p.Eon>0||+p.Eoff>0}),num('Iref','I_ref','A',100,{show:p=>+p.Eon>0||+p.Eoff>0})],
   value:()=>null,
   draw:p=>{const d=p.body?(p.model==='igbt'?'<path class="thin" d="M0,-20 H20 V-5 M0,20 H20 V5 M15,5 H25 M15,-4 H25 L20,5 Z"/>':'<path class="thin" d="M8,-12 H20 V-5 M8,12 H20 V5 M15,5 H25 M15,-4 H25 L20,5 Z"/>'):'';
    return p.model==='igbt'?`<path d="M0,-30 V-14 L8,-8 M8,8 L0,14 V30 M8,-13 V13 M2,-12 V12 M2,0 H-14"/><path class="fill" d="M1.2,14.6 l1.6,-6.2 l4.4,4.4 z"/>${d}`
     :`<path d="M0,-30 V-12 H8 M0,30 V12 H8 M8,-17 V-7 M8,-3 V3 M8,7 V17 M2,-15 V15 M2,0 H-14"/><path class="fill" d="M8,12 l-6,-3.5 v7 z"/>${d}`;}},
  D:{name:'Δίοδος',prefix:'D',group:'Ημιαγωγοί',pins:{a:[-30,0],k:[30,0]},box:[-10,-11,20,22],
   params:[num('Ron','R_on','Ω',1e-3),num('Vf','Τάση γονάτου V_f','V',0,{zero:true}),num('Roff','R_off','Ω',1e6)],
   value:()=>null,
   draw:()=>'<path d="M-30,0 H-9 M9,0 H30 M9,-10 V10"/><path class="fill" d="M-9,-10 L9,0 L-9,10 Z"/>'},
  SCR:{name:'Θυρίστορ (SCR)',prefix:'Q',group:'Ημιαγωγοί',pins:{a:[-30,0],k:[30,0]},box:[-10,-11,29,26],
   params:[sel('fire','Έναυση',[['alpha','Γωνία α ως προς πηγή AC'],['pwm','Από PWM'],['on','Συνεχώς (σαν δίοδος)']],'alpha'),
    ref('refsrc','Πηγή αναφοράς',['VAC','VAC3'],{show:p=>p.fire==='alpha',hint:'Η α μετριέται από τη θετική διάβαση από το μηδέν της τάσης αναφοράς (φάση a στην τριφασική).'}),
    num('alpha','Γωνία έναυσης α','°',30,{zero:true,show:p=>p.fire==='alpha'}),
    num('shift','Μετατόπιση','°',0,{signed:true,zero:true,show:p=>p.fire==='alpha',hint:'Προστίθεται στην α: 180° για τα θυρίστορ της αρνητικής ημιπεριόδου, 30° + 60°·k στις τριφασικές γέφυρες.'}),
    num('pw','Διάρκεια παλμού','°',20,{show:p=>p.fire==='alpha'}),num('fref','Συχνότητα (χωρίς πηγή αναφοράς)','Hz',50,{show:p=>p.fire==='alpha'&&!p.refsrc}),
    ref('pwm','Μπλοκ PWM',['PWM'],{show:p=>p.fire==='pwm'}),sel('out','Έξοδος PWM',[['a','g'],['na','ḡ'],['b','g₂'],['nb','ḡ₂']],'a',{show:p=>p.fire==='pwm'}),
    num('Ron','R_on','Ω',1e-3),num('Vf','Τάση γονάτου V_f','V',0,{zero:true}),num('Roff','R_off','Ω',1e6)],
   value:()=>null,
   draw:()=>'<path d="M-30,0 H-9 M9,0 H30 M9,-10 V10 M9,5 L18,14"/><path class="fill" d="M-9,-10 L9,0 L-9,10 Z"/>'},
  XFMR:{name:'Μετασχηματιστής',prefix:'T',group:'Μαγνητικά',pins:{p1:[-30,-30],p2:[-30,30],s1:[30,-30],s2:[30,30]},box:[-20,-26,40,52],
   params:[num('n','Λόγος N₂/N₁','',1),num('Lm','Αυτεπαγωγή μαγνήτισης (πρωτεύον)','H',1e-3),num('im0','Αρχικό ρεύμα μαγνήτισης','A',0,{signed:true,zero:true}),
    num('Llk1','Σκέδαση πρωτεύοντος L_lk1','H',0,{zero:true,hint:'Σε σειρά με το πρωτεύον, έξω από την L_m. Στο flyback χρειάζεται κύκλωμα clamp (RCD).'}),num('Llk2','Σκέδαση δευτερεύοντος L_lk2','H',0,{zero:true}),
    num('R1','Αντίσταση πρωτεύοντος','Ω',0,{zero:true}),num('R2','Αντίσταση δευτερεύοντος','Ω',0,{zero:true}),
    sel('pol','Πολικότητα',[['same','Τελείες p1 και s1'],['opp','Τελείες p1 και s2 (flyback)']],'same')],
   value:p=>p.n,unit:'',
   draw:p=>`<path d="M-30,-30 H-14 V-24 a6,6 0 0,1 0,12 a6,6 0 0,1 0,12 a6,6 0 0,1 0,12 a6,6 0 0,1 0,12 V30 H-30 M30,-30 H14 V-24 a6,6 0 0,0 0,12 a6,6 0 0,0 0,12 a6,6 0 0,0 0,12 a6,6 0 0,0 0,12 V30 H30"/><path class="thin" d="M-3,-26 V26 M3,-26 V26"/><circle class="dot" cx="-20" cy="-26" r="2.6"/><circle class="dot" cx="20" cy="${p.pol==='opp'?26:-26}" r="2.6"/>`},
  CPL:{name:'Φορτίο σταθερής ισχύος',prefix:'P',group:'Φορτία',pins:{p:[0,-30],n:[0,30]},box:[-12,-17,24,34],
   params:[num('P','Ισχύς','W',1000,{signed:true}),num('Vmin','Τάση κάτω από την οποία γίνεται ωμικό','V',5),txt('sched','P(t)','',{hint:SCHED})],
   value:p=>p.P,unit:'W',
   draw:()=>'<path d="M0,-30 V-16 M0,16 V30"/><rect x="-11" y="-16" width="22" height="32" rx="2"/><path class="thin" d="M-4,6 V-6 h5 a3.5,3.5 0 0,1 0,7 h-5"/>'},
  GND:{name:'Γείωση',prefix:'G',group:'Βασικά',pins:{g:[0,0]},box:[-11,2,22,16],params:[],value:()=>null,
   draw:()=>'<path d="M0,0 V8 M-11,8 H11 M-7,13 H7 M-3,18 H3"/>'},
  JUNC:{name:'Κόμβος',prefix:'J',group:'Βασικά',pins:{j:[0,0]},box:[-4,-4,8,8],params:[],hidden:true,value:()=>null,draw:()=>''},
  PWM:{name:'PWM / έλεγχος',prefix:'PWM',group:'Έλεγχος',pins:{},box:[-34,-20,68,40],
   params:[num('fs','Συχνότητα','Hz',20e3),
    sel('mode','Τρόπος',[['fixed','Σταθερό D (ανοικτός βρόχος)'],['pi','Βρόχος PI / PID'],['spwm','Ημιτονοειδές SPWM'],['pp','Δύο εξόδων (full-bridge)']],'fixed'),
    num('D','Duty D','',0.5,{zero:true,show:p=>p.mode==='fixed'||p.mode==='pp'}),
    txt('dsched','D(t)','',{hint:SCHED+' Για παλμό ΔD: 0:0.5, 0.001:0.55, 0.0028:0.5',show:p=>p.mode==='fixed'}),
    sel('carrier','Φορέας',[['triangle','Τριγωνικός (συμμετρικός)'],['saw','Πριονωτός (ON πρώτα)']],'triangle',{show:p=>p.mode!=='spwm'&&p.mode!=='pp'}),
    num('phase','Μετατόπιση φορέα','°',0,{signed:true,zero:true}),
    num('dt','Νεκρός χρόνος','s',0,{zero:true,hint:'Καθυστερεί το άνοιγμα κάθε εξόδου (g, ḡ, g₂, ḡ₂). Στο διάστημα αυτό το ρεύμα περνά από τις διόδους.'}),
    ref('sensor','Μετρούμενο στοιχείο',['L','R','C','VDC','CPL','SW','D','SCR','XFMR','IDC','VAC','VAC3'],{show:p=>p.mode==='pi'}),
    sel('qty','Μέγεθος',[['I','Ρεύμα'],['V','Τάση']],'I',{show:p=>p.mode==='pi'}),
    txt('ref','Αναφορά (τιμή ή πρόγραμμα)','0',{hint:'Σταθερή τιμή ή «t:τιμή», π.χ. 0:-800, 0.003:800',show:p=>p.mode==='pi'}),
    num('Kp','K_p','',1e-3,{zero:true,signed:true,show:p=>p.mode==='pi'}),num('Ki','K_i','1/s',1,{zero:true,signed:true,show:p=>p.mode==='pi'}),num('Kd','K_d (0 = PI)','s',0,{zero:true,signed:true,show:p=>p.mode==='pi',hint:'d = D₀ + K_p·e + K_i·T_s·Σe + K_d·de/dt, με δειγματοληψία μία φορά ανά περίοδο.'}),num('Tf','Φίλτρο παραγώγου T_f','s',0,{zero:true,show:p=>p.mode==='pi'&&+p.Kd!==0,hint:'Πρώτης τάξης φίλτρο στον παράγωγο όρο, π.χ. 2·T_s. 0 = χωρίς φίλτρο.'}),
    sel('ff','Feedforward',[['none','Χωρίς'],['ratio','D₀ = 1 − V(A)/V(B)'],['const','Σταθερό D₀']],'none',{show:p=>p.mode==='pi'}),
    ref('ffA','V(A)',['VDC','C','CPL','R','VAC'],{show:p=>p.mode==='pi'&&p.ff==='ratio'}),ref('ffB','V(B)',['VDC','C','CPL','R','VAC'],{show:p=>p.mode==='pi'&&p.ff==='ratio'}),
    num('D0','D₀','',0.5,{zero:true,show:p=>p.mode==='pi'&&p.ff==='const'}),
    num('dmin','D_min','',0.01,{zero:true,show:p=>p.mode==='pi'}),num('dmax','D_max','',0.99,{show:p=>p.mode==='pi'}),
    num('m','Δείκτης διαμόρφωσης m','',0.8,{show:p=>p.mode==='spwm'}),num('fref','Συχνότητα αναφοράς','Hz',50,{show:p=>p.mode==='spwm'}),
    num('refphase','Φάση αναφοράς','°',0,{signed:true,zero:true,show:p=>p.mode==='spwm'})],
   value:p=>p.fs,unit:'Hz',
   draw:()=>'<rect class="block" x="-34" y="-20" width="68" height="40" rx="6"/><path class="thin" d="M-24,8 L-14,-8 L-4,8 L6,-8 L16,8 L24,-4"/><path class="thin accent" d="M-26,-2 H26"/>'},
 };
 const GROUPS=['Πηγές','Παθητικά','Ημιαγωγοί','Μαγνητικά','Φορτία','Έλεγχος','Βασικά'];
 function defaults(type){const o={};for(const p of PARTS[type].params)o[p.k]=p.def;return o;}
 // rotation (0..3 quarter turns) and mirror applied to a local point
 function xf(c,[x,y]){if(c.flip)x=-x;for(let i=0;i<(c.rot||0);i++)[x,y]=[-y,x];return [c.x+x,c.y+y];}
 function pinPos(c,pin){return xf(c,PARTS[c.type].pins[pin]);}
 // outward direction of a pin (unit vector), for wire escape
 function pinDir(c,pin){const [x,y]=PARTS[c.type].pins[pin];let d=Math.abs(x)>=Math.abs(y)?[Math.sign(x)||1,0]:[0,Math.sign(y)||1];
  if(c.type==='GND')d=[0,-1];if(c.type==='JUNC')d=[0,0];
  const o=xf({x:0,y:0,rot:c.rot,flip:c.flip},d);return o;}
 function bbox(c){const [bx,by,bw,bh]=PARTS[c.type].box;const pts=[[bx,by],[bx+bw,by],[bx,by+bh],[bx+bw,by+bh]].map(p=>xf(c,p));
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
 // engineering notation
 const PRE=[[1e9,'G'],[1e6,'M'],[1e3,'k'],[1,''],[1e-3,'m'],[1e-6,'μ'],[1e-9,'n'],[1e-12,'p']];
 function eng(v,unit='',d=3){if(v===null||v===undefined||!Number.isFinite(v))return '—';if(Math.abs(v)<1e-13)return '0'+(unit?' '+unit:'');const a=Math.abs(v);
  for(const [k,p] of PRE)if(a>=k*.9995){const s=Number((v/k).toPrecision(d)).toLocaleString('el-GR',{maximumFractionDigits:6});return s+(unit||p?' '+p+unit:'');}
  return v.toExponential(2)+' '+unit;}
 const PFX={G:1e9,M:1e6,k:1e3,K:1e3,m:1e-3,u:1e-6,'μ':1e-6,'µ':1e-6,n:1e-9,p:1e-12};
 function parseEng(s){if(typeof s==='number')return s;s=String(s).trim().replace(',','.').replace(/\s+/g,'');if(!s)return NaN;
  const m=s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([GMkKmuμµnp]?)[A-Za-zΩ°]*$/);if(!m)return NaN;return Number(m[1])*(m[2]?PFX[m[2]]:1);}
 // "t:v, t:v" schedules
 function parseSched(s){if(s===undefined||s===null)return null;s=String(s).trim();if(!s)return null;
  if(!s.includes(':')){const v=parseEng(s);return Number.isFinite(v)?[[0,v]]:null;}
  const out=[];for(const part of s.split(/[;,]\s*(?=[-+.\d])/)){const [a,b]=part.split(':');const t=parseEng(a),v=parseEng(b);if(!Number.isFinite(t)||!Number.isFinite(v))return null;out.push([t,v]);}
  out.sort((x,y)=>x[0]-y[0]);return out.length?out:null;}
 const api={PARTS,GROUPS,defaults,xf,pinPos,pinDir,bbox,eng,parseEng,parseSched};
 root.Parts=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
