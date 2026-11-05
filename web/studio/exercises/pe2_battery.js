'use strict';
// Exercise template: PE2 · Άσκηση 1, αμφίδρομος μετατροπέας μπαταρίας.
//
// An exercise template says which engine solves the exercise, which sections
// the "Υπολογισμοί & μαθηματικά" panel shows and how the PLECS suggestions are
// produced. It is deliberately separate from the circuit: the exercise answers
// come from the exercise data (window, powers, profile), the circuit only picks
// the operating point. The same structure can later be filled by a Java worker
// or a JSON template instead of these functions.
//
// Contract:
//   id, tutorial          template id and the tutorial it attaches to
//   engine.action         API action (POST /api/<action>)
//   engine.request(meta)  request body from the tutorial meta/options
//   sections[]            {id, title, html(r, ctx, h)}  h = rendering helpers
//   pickTest(r, ctx)      default PLECS test for the current operating point
(function(root){
 const reg=root.Exercises=root.Exercises||{list:[],register(t){this.list.push(t);},forTutorial(id){return this.list.find(t=>t.tutorial===id);}};
 const plain=v=>Number(Number(v).toPrecision(6)).toString();
 function script(r,t,above){
  const c=r.config,lo=above?'Vbus':'Vst',hi=above?'Vst':'Vbus';
  return `% PE2 Άσκηση 1 · δοκιμή ${t.id}: V_st = ${plain(t.vst)} V, P_bus = ${t.p_bus>0?'+':''}${t.p_bus/1e3} kW (${t.mode})
% D = duty του κάτω διακόπτη S2 · iL > 0 από ${above?'τον ζυγό':'την αποθήκευση'} προς το μέσο της ημιγέφυρας
Vbus = ${plain(t.vbus)};        % V
Vst  = ${plain(t.vst)};        % V
L    = ${plain(c.L)};     % H
fs   = ${plain(c.fs)};      % Hz
Ts   = 1/fs;
Cbus = ${plain(c.C_bus)};  ESR = ${plain(c.ESR)};
P    = ${plain(t.p_bus)};     % W, θετικό = εκφόρτιση
D    = 1 - ${lo}/${hi};    % = ${plain(t.D)}
IL   = ${above?'-P/Vbus':'P/Vst'};     % = ${plain(t.IL)} A
dI   = ${lo}*D/(L*fs);    % = ${plain(t.dI)} A p-p
iL0_sym = IL;             % συμμετρικός φορέας, t = 0 στο μέσο του S1
iL0_saw = IL - dI/2;      % πριονωτός φορέας, S2 ON στην αρχή της περιόδου
iL0 = iL0_saw;            % διάλεξε σύμφωνα με τον φορέα
Tstop = 100*Ts;`;}
 function plecs(r,ctx,h){
  const above=ctx.meta.above,tests=r.q5.tests,cur=ctx.test||tests[1];const c=r.config;
  const opts=tests.map(t=>`<option value="${t.id}" ${t.id===cur.id?'selected':''}>${t.id} · V_st = ${h.fmt(t.vst,4)} V · ${t.p_bus>0?'+':''}${h.fmt(t.p_bus/1e3)} kW${t.covered_by?' (= '+t.covered_by.join('/')+')':''}</option>`).join('');
  const Ts=1/c.fs;
  const rows=[
   ['Simulation → Parameters','Start time 0, Stop time <code>100*Ts</code> = '+h.eng(100*Ts,'s')],
   ['Solver','Variable-step, stiff (<b>RADAU</b>), ή DOPRI. Ιδανικοί διακόπτες: ο variable-step βρίσκει ακριβώς τις μεταβάσεις.'],
   ['Max step size','<code>Ts/200</code> = '+h.eng(Ts/200,'s')+' (γωνίες χωρίς στρογγύλεμα)'],
   ['Relative tolerance','1e-6 για μέσες τιμές στο 0,1 %, αλλιώς το default 1e-3'],
   ['Initialization','Simulation Parameters → Initialization: το script της δοκιμής (παρακάτω). Τα πεδία των blocks γράφονται με ονόματα: L, D, iL0, Vbus, Vst.'],
   ['Πηγές','«DC Voltage Source» <code>Vbus</code> στον ζυγό και <code>Vst</code> στην αποθήκευση. Ιδανικές, όπως ζητά το ερώτημα 5.'],
   ['Πηνίο','«Inductor» <code>L</code>, Initial current <code>iL0</code>, από '+(above?'τον ζυγό':'την αποθήκευση')+' (χαμηλή πλευρά) προς το μέσο. Έλεγξε τη φορά με Ammeter.'],
   ['Ημιγέφυρα','Δύο «MOSFET with Diode» ιδανικά: S1 μέσο → +'+(above?'αποθήκευσης':'ζυγού')+', S2 μέσο → κοινή επιστροφή.'],
   ['Οδήγηση','«Constant» <code>D</code> → PWM (φορέας <code>fs</code>) → S2 · NOT → S1, χωρίς dead time. Συμμετρικός φορέας → iL0 = IL, πριονωτός → iL0 = IL − dI/2.'],
   ['Μετρήσεις','Ammeter i_L, Voltmeter v_L, v_bus·i_bus → «Periodic Average» (Ts) για P_bus. Μέσο/κυμάτωση στην τελευταία ακέραιη περίοδο.'],
   ['Έλεγχος','⟨i_L⟩ = '+h.eng(cur.IL,'A')+', Δi = '+h.eng(cur.dI,'A')+', i_min/i_max = '+h.eng(cur.imin,'A')+' / '+h.eng(cur.imax,'A')+', P_bus = '+h.eng(cur.p_bus,'W')+'.'],
   ['Συχνά λάθη','D του S1 αντί του S2 (D_S1 = 1 − D) · iL0 για λάθος φορέα (μετατόπιση Δi/2) · στρογγυλοποιημένο D αντί του τύπου 1 − V_lo/V_hi · μέσες τιμές σε μη ακέραιο αριθμό περιόδων.']];
  return `<div class="ex-row"><label>Δοκιμή<select data-ex-test>${opts}</select></label><button data-ex-load="${cur.id}" ${ctx.canLoad(cur)?'':'disabled'} title="Φόρτωσε το ίδιο σημείο λειτουργίας στο studio">▶ Ίδια δοκιμή στο studio</button></div>
   <table class="plecs">${rows.map(([a,b])=>`<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
   <h4>Script αρχικοποίησης · δοκιμή ${h.esc(cur.id)}</h4><div class="copy-box"><pre data-ex-script>${h.esc(script(r,cur,above))}</pre><button data-ex-copy>Αντιγραφή</button></div>
   <p class="muted small">Οι προτάσεις προκύπτουν από τα δεδομένα της άσκησης (παράθυρο, ισχύς, f_s, L) και όχι μόνο από το σχέδιο. Τα ονόματα blocks αντιστοιχούν στη βιβλιοθήκη του PLECS και μπορεί να διαφέρουν ελαφρά ανά έκδοση.</p>`;}
 reg.register({
  id:'pe2_battery',tutorial:'battery',title:'PE2 · Άσκηση 1 · αμφίδρομος μετατροπέας μπαταρίας',
  engine:{action:'bidir',request:meta=>({position:meta.above?'above':'below'})},
  pickTest(r,ctx){const m=ctx.meta;return r.q5.tests.find(t=>Math.abs(t.vst-m.vst)<1e-9&&Math.sign(t.p_bus)===Math.sign(m.P)&&Math.abs(t.vbus-50)<1e-9)||r.q5.tests[1];},
  sections:[
   {id:'q2',title:'2 · Ισχύς & παράθυρο',html:(r,ctx,h)=>`<div class="kv">${h.kv([['Μέση ισχύς φορτίου',h.fmt(r.q2.load_avg_kW)+' kW'],['Ενέργεια κύκλου',h.fmt(r.q2.energy_kJ)+' kJ'],['Παράθυρο αποθήκευσης',`${r.config.vst_min}–${r.config.vst_max} V`],['Ζυγός',`${r.config.vbus_min}–${r.config.vbus_max} V`]])}</div>`+
     h.table(['Ισχύς','Λειτουργία','Φορά','I ζυγού (49/50/51 V)','I αποθήκευσης (min/mid/max)'],r.q2.ports.map(p=>[h.fmt(p.P_kW)+' kW',p.mode,p.direction,p.bus.map(b=>h.fmt(b.I,4)).join(' / ')+' A',p.st.map(b=>h.fmt(b.I,4)).join(' / ')+' A']))+h.steps(r.q2.steps)},
   {id:'q3',title:'3 · Τοπολογία & καταπονήσεις',html:(r,ctx,h)=>h.table(['Λειτουργία','Ενεργός','Ανορθωτής','Φορά'],r.q3.modes.map(m=>[m.name,m.active,m.rectifier,m.direction]))+h.table(['Καταπόνηση','Περίπτωση','Τιμή','Σημείο'],r.q3.stresses.map(s=>[s.name,s.which,h.eng(s.value,s.unit||''),s.at||'']))+h.steps(r.q3.steps)},
   {id:'q4',title:'4 · Αυτεπαγωγή & κυμάτωση',html:(r,ctx,h)=>`<div class="kv">${h.kv([['L_min (Δi ≤ 30 % στα 40 kW)',h.eng(r.q4.L_min,'H')],['Τυποποιημένη E12',h.eng(r.q4.L_std,'H')],['Μέγιστη Δi',h.eng(r.q4.ripple_max.dI,'A')+' @ '+h.fmt(r.q4.ripple_max.vst)+' V ('+r.q4.ripple_max.kind+')'],['Μέγιστη Δi/|I|',h.fmt(100*r.q4.relative_max.ratio,3)+' % @ '+h.fmt(r.q4.relative_max.vst,4)+' V'],['Κορυφή 40 / 60 kW',h.eng(r.q4.peak.nom.I,'A')+' / '+h.eng(r.q4.peak.over.I,'A')],['D σε όλο το εύρος',h.fmt(r.q4.duty_range_bus[0],3)+' … '+h.fmt(r.q4.duty_range_bus[1],3)]])}</div>`+h.steps(r.q4.steps)},
   {id:'q5',title:'5 · Δοκιμές PLECS',html:(r,ctx,h)=>h.table(['Δοκ.','Περιγραφή','V_st','P','Λειτ.','D (S2)','I_L','Δi','i_L(0) συμμ.','i_L(0) S2 πρώτα',''],r.q5.tests.map(t=>[`<b>${t.id}</b>`,t.desc+(t.covered_by?` <small>(= ${t.covered_by.join(', ')})</small>`:''),h.fmt(t.vst,4)+' V',(t.p_bus>0?'+':'')+h.fmt(t.p_bus/1e3)+' kW',t.mode,h.fmt(t.D,5),h.fmt(t.IL,5),h.fmt(t.dI,5),h.fmt(t.iL0_symmetric,5),h.fmt(t.iL0_S2_first,5),`<button data-ex-load="${t.id}" ${ctx.canLoad(t)?'':'disabled'} title="Φόρτωσε τη δοκιμή στο studio">▶</button>`]),true)+h.steps(r.q5.steps)},
   {id:'plecs',title:'Ρυθμίσεις PLECS',html:plecs},
   {id:'control',title:'Έλεγχος & σύγκλιση',html:(r,ctx,h)=>`<div class="kv">${h.kv([['Ολίσθηση για δ = 0,001',h.eng(r.control.drift_A_per_s,'A/s')],['Μετάβαση ±I με ΔD = 0,05',h.eng(r.control.transition.t,'s')+' ('+h.fmt(r.control.transition.periods,4)+' περίοδοι)'],['PI: K_p',h.eng(r.control.pi.kp)],['PI: K_i',h.eng(r.control.pi.ki)],['f_c / PM',h.fmt(r.control.pi.fc)+' Hz / '+r.control.pi.pm_deg+'°']])}</div>`+h.steps(r.control.steps)},
   {id:'system',title:'Φορτίο & σύστημα',html:(r,ctx,h)=>`<div class="kv">${h.kv([['Μέγιστη ισχύς μονόδρομης πηγής (V_bus ≥ 49 V)',h.eng(r.system.P_src_max,'W')],['Ελάχιστη εκφόρτιση στο μέγιστο φορτίο',h.eng(r.system.min_discharge_at_max_load,'W')],['Άνοδος ζυγού 50 → 51 V με 10 kW πλεόνασμα',h.eng(r.system.t_rise_10kW,'s')],['Διακύμανση ενέργειας αποθήκευσης / κύκλο',h.fmt(r.system.swing_kJ)+' kJ']])}</div>`+h.steps(r.system.steps)},
  ]});
})(window);
