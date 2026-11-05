'use strict';
// PE2 bidirectional converter lab: one converter, every question, live simulation.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const colors=['#147966','#c78126','#4d79ac','#aa5f76','#8267aa'];
const WINDOWS={above:{vst_min:60,vst_mid:80,vst_max:100},below:{vst_min:25,vst_mid:32.5,vst_max:40}};
const state={tab:'q2',result:null,dirty:true,charts:[],inspect:null,openDetails:new Set(),renderToken:0,
 params:{position:'above',vbus_nom:50,vbus_min:49,vbus_max:51,...WINDOWS.above,p_nom:40e3,p_over:60e3,fs:20e3,L:5.6e-6,ripple_ratio:.3,
  C_bus:.1,ESR:.2e-3,R_src:1e-3,V_src:50,load_min:30e3,load_max:60e3,fc_ratio:.05,pm_deg:60,
  profile:[[0,30],[10,30],[10,60],[30,60],[30,30],[60,30],[90,60],[90,30],[120,30]]},
 simcfg:{scenario:'test',test:'Β',carrier:'triangle',delta:.001,dD:.05,ff:true,P_load:60e3,load_type:'cpl'}};
const FIELDS={vbus_nom:['Ονομαστική τάση ζυγού','V',1],vbus_min:['Ελάχιστη τάση ζυγού','V',1],vbus_max:['Μέγιστη τάση ζυγού','V',1],
 V_src:['Τάση κύριας πηγής','V',1],R_src:['Αντίσταση σειράς πηγής','mΩ',1e3],C_bus:['Πυκνωτής ζυγού','mF',1e3],ESR:['ESR πυκνωτή','mΩ',1e3],
 load_min:['Ελάχιστο φορτίο συστήματος','kW',1e-3],load_max:['Μέγιστο φορτίο συστήματος','kW',1e-3],
 vst_min:['Ελάχιστη τάση αποθήκευσης','V',1],vst_mid:['Ενδιάμεση τάση αποθήκευσης','V',1],vst_max:['Μέγιστη τάση αποθήκευσης','V',1],
 p_nom:['Ονομαστική ισχύς','kW',1e-3],p_over:['Ισχύς υπερφόρτισης','kW',1e-3],fs:['Διακοπτική συχνότητα','kHz',1e-3],L:['Αυτεπαγωγή (επιλογή)','μH',1e6],
 ripple_ratio:['Μέγιστο Δi/|I| στα 40 kW','',1],fc_ratio:['Συχνότητα διέλευσης PI / f_s','',1],pm_deg:['Περιθώριο φάσης PI','°',1]};
const PARTS={src:['vbus_nom','vbus_min','vbus_max','V_src'],rsrc:['R_src','V_src'],cbus:['C_bus','ESR'],load:['load_min','load_max'],
 L:['L','ripple_ratio','fs'],S1:['fs','fc_ratio','pm_deg'],S2:['fs','fc_ratio','pm_deg'],st:['vst_min','vst_mid','vst_max','p_nom','p_over']};
const PART_NAMES={src:'Πλευρά ζυγού · πηγή',rsrc:'Αντίσταση πηγής',cbus:'Πυκνωτής ζυγού',load:'Φορτίο συστήματος',L:'Πηνίο',S1:'Διακόπτης S1 (πάνω)',S2:'Διακόπτης S2 (κάτω)',st:'Αποθήκευση'};
let schematic=null,health={version:'1.0.0'};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=4)=>Number.isFinite(v)?Number(v.toPrecision(d)).toLocaleString('el-GR',{maximumFractionDigits:8}):'—';
const plain=v=>Number.isFinite(v)?String(Number(v.toPrecision(7))):'';
const eng=v=>Math.abs(v)<.0001&&v!==0?v.toExponential(3):fmt(v);
function si(v,unit,d=4){if(!Number.isFinite(v))return '—';const a=Math.abs(v);const p=a===0?['',1]:a>=1e3?['k',1e-3]:a>=1?['',1]:a>=1e-3?['m',1e3]:a>=1e-6?['μ',1e6]:['n',1e9];return fmt(v*p[1],d)+' '+p[0]+unit;}
function notice(t,err=false){$('#notice').hidden=!t;$('#notice').textContent=t;$('#notice').className=err?'error':'';}
let queue=Promise.resolve(),active=0;
function api(action,data){const run=async()=>{active++;document.body.classList.add('busy');$('#connection').textContent='Υπολογισμός…';try{const r=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const out=await r.json();if(!r.ok)throw Error(out.error||'Σφάλμα engine.');return out;}finally{active--;if(!active){document.body.classList.remove('busy');$('#connection').textContent='Engine συνδεδεμένο';}}};const p=queue.then(run,run);queue=p.catch(()=>{});return p;}
const above=()=>state.params.position==='above';
const lab=()=>above()?{lo:'V_bus',hi:'V_st'}:{lo:'V_st',hi:'V_bus'};

// ---------- calculation ----------
let calcTimer=null,calcToken=0;
async function calculate(){
 const token=++calcToken;
 try{
  const r=await api('solve',state.params);if(token!==calcToken)return false;
  state.result=r;state.dirty=false;notice('');saveLocal();
  $('#content').classList.remove('stale');$('#content').removeAttribute('inert');
  $('#mode-badge').textContent='CCM · '+(above()?'buck ↔ boost':'boost ↔ buck');$('#mode-badge').className='mode';
  $('#heading').textContent=above()?`Ζυγός ${r.config.vbus_nom} V ↔ αποθήκευση ${r.config.vst_min}–${r.config.vst_max} V`:`Αποθήκευση ${r.config.vst_min}–${r.config.vst_max} V ↔ ζυγός ${r.config.vbus_nom} V`;
  renderChips();drawSchematic();buildScenarioUI();simSetup(false);refreshInspector();return true;
 }catch(e){if(token!==calcToken)return false;notice(e.message,true);$('#mode-badge').textContent='Μη έγκυρο';$('#mode-badge').className='mode invalid';return false;}
}
function markDirty(){state.dirty=true;$('#content').classList.add('stale');$('#content').setAttribute('inert','');clearTimeout(calcTimer);calcTimer=setTimeout(async()=>{if(await calculate())await showTab(state.tab);},250);}
async function applyParams(partial){Object.assign(state.params,partial);if(['vst_min','vst_mid','vst_max'].some(k=>k in partial))WINDOWS[state.params.position]={vst_min:state.params.vst_min,vst_mid:state.params.vst_mid,vst_max:state.params.vst_max};state.dirty=true;if(await calculate())await showTab(state.tab);}
function saveLocal(){try{localStorage.setItem('pe2-bidir',JSON.stringify({params:state.params,simcfg:state.simcfg}));}catch{}}

// ---------- chips ----------
function renderChips(){
 const r=state.result,c=r.config,q4=r.q4;const chips=[];
 const chip=(part,sym,val,unit,out=false)=>chips.push(`<button class="chip${out?' out':''}" data-part="${part}"><span>${esc(sym)}</span><b>${esc(val)}</b>${unit?`<i>${esc(unit)}</i>`:''}</button>`);
 chip('src','V_bus',`${fmt(c.vbus_nom)} (${fmt(c.vbus_min)}–${fmt(c.vbus_max)})`,'V');chip('st','V_st',`${fmt(c.vst_min)} / ${fmt(c.vst_mid)} / ${fmt(c.vst_max)}`,'V');
 chip('st','P',`±${fmt(c.p_nom/1e3)} · ±${fmt(c.p_over/1e3)}`,'kW');chip('S2','f_s',fmt(c.fs/1e3),'kHz');chip('L','L',fmt(c.L*1e6),'μH');
 chip('cbus','C_bus',fmt(c.C_bus*1e3),'mF');chip('rsrc','R_src',fmt(c.R_src*1e3),'mΩ');chip('load','Φορτίο',`${fmt(c.load_min/1e3)}–${fmt(c.load_max/1e3)}`,'kW');
 chips.push('<span class="chip-sep">→</span>');
 chip('S2','D₀',`${fmt(Math.min(...q4.duty.map(d=>d.D)),3)}–${fmt(Math.max(...q4.duty.map(d=>d.D)),3)}`,'',true);
 chip('L','L_min',fmt(q4.L_min*1e6),'μH',true);chip('L','Δi_max',fmt(q4.ripple_max.dI),'A',true);chip('L','I_pk 60 kW',fmt(q4.peak.over.I),'A',true);
 chip('load','P̄_load',fmt(r.q2.load_avg_kW),'kW',true);
 $('#spec-chips').innerHTML=chips.join('');
 $$('#spec-chips [data-part]').forEach(b=>b.onclick=()=>openInspector(b.dataset.part,b.getBoundingClientRect()));
}

// ---------- inspector ----------
function openInspector(part,anchor){state.inspect={part,anchor,draft:{...state.params}};renderInspector();placeInspector();setTimeout(()=>$('#inspector input')?.select?.(),0);}
function closeInspector(){state.inspect=null;$('#inspector').hidden=true;$('#inspector').innerHTML='';}
function readInspector(){const s=state.inspect;let ok=true;$$('#inspector [data-key]').forEach(inp=>{const k=inp.dataset.key,v=Number(inp.value)/FIELDS[k][2];const good=Number.isFinite(v)&&(v>0||k==='ESR'&&v>=0);inp.closest('.input-unit').classList.toggle('invalid',!good);if(good)s.draft[k]=v;else ok=false;});return ok;}
function partResults(part){
 const r=state.result;if(!r)return [];const c=r.config,q3=r.q3.stresses,q4=r.q4,rows=[];const row=(a,b)=>rows.push([a,b]);
 const st=n=>q3.find(x=>x.name===n&&x.which==='με υπερφόρτιση');
 if(part==='L'){row('L_min (30 % στα 40 kW)',fmt(q4.L_min*1e6)+' μH');row('Επόμενη τιμή E12',fmt(q4.L_std*1e6)+' μH');row('Επιλογή',fmt(c.L*1e6)+' μH '+(q4.L_ok?'✓':'✗'));row('Μέγιστη Δi',fmt(q4.ripple_max.dI)+` A @ V_st = ${fmt(q4.ripple_max.vst)} V`);row('Μέγιστη Δi/|I|',fmt(q4.relative_max.ratio*100)+` % @ ${fmt(q4.relative_max.vst)} V`);row('I_L,peak 40 / 60 kW',fmt(q4.peak.nom.I)+' / '+fmt(q4.peak.over.I)+' A');}
 if(part==='S1'||part==='S2'){row('Τάση αποκοπής',fmt(st('Τάση αποκοπής S1, S2').value)+' V');row(`Μέσο ρεύμα ${part} (60 kW)`,fmt(st(`Μέσο ρεύμα ${part}`).value)+' A');row(`RMS ${part} (60 kW, Δi≈0)`,fmt(st(`RMS ρεύμα ${part}`).value)+' A');row('Ρεύμα κορυφής με κυμάτωση',fmt(q4.peak.over.I)+' A');row('PI: K_p / K_i',`${eng(r.control.pi.kp)} / ${fmt(r.control.pi.ki)}`);}
 if(part==='st'){for(const t of r.q5.tests.slice(0,3))row(`D₀ @ ${fmt(t.vst)} V`,fmt(t.D,4));row('Μέγιστο ρεύμα θύρας (60 kW)',fmt(st('Ρεύμα θύρας αποθήκευσης').value)+' A');}
 if(part==='src'||part==='rsrc'){row('P_src,max (V_bus ≥ '+c.vbus_min+' V)',fmt(r.system.P_src_max/1e3)+' kW');row('Ελάχιστη εκφόρτιση στο μέγιστο φορτίο',fmt(r.system.min_discharge_at_max_load/1e3)+' kW');row('Μέγιστο ρεύμα θύρας ζυγού (60 kW)',fmt(st('Ρεύμα θύρας ζυγού').value)+' A');}
 if(part==='cbus')row('Άνοδος 50→51 V με περίσσευμα 10 kW',fmt(r.system.t_rise_10kW*1e3)+' ms');
 if(part==='load'){row('Μέση ισχύς κύκλου',fmt(r.q2.load_avg_kW)+' kW');row('Ενέργεια αποθήκευσης για εξομάλυνση',fmt(r.system.swing_kJ)+' kJ');}
 return rows;
}
function renderInspector(){
 const s=state.inspect;if(!s)return;const keys=PARTS[s.part]||[];
 const field=k=>{const [name,unit,f]=FIELDS[k];return `<label class="insp-field"><span>${esc(name)} <em>${esc(k)}</em></span><div class="input-unit"><input data-key="${k}" type="number" step="any" value="${plain(s.draft[k]*f)}"><b>${esc(unit)}</b></div></label>`;};
 const rows=partResults(s.part);
 let extra='';
 if(s.part==='load')extra=`<p class="insp-note">Το προφίλ του κύκλου των 120 s αλλάζει στην καρτέλα «2 · Ισχύς & παράθυρο». Στο ερώτημα 5 (δοκιμή PLECS) φορτίο δεν χρειάζεται.</p>`;
 if(s.part==='S1'||s.part==='S2')extra=`<p class="insp-note">${s.part==='S2'?'D είναι το duty αυτού του διακόπτη.':'Ο S1 οδηγείται συμπληρωματικά: 1 − D.'} Στην εκφόρτιση ο ενεργός διακόπτης είναι ο ${state.result?.q3.modes[0].active}, στη φόρτιση ο ${state.result?.q3.modes[1].active}.</p>`;
 if(s.part==='st')extra=`<p class="insp-note">Παράθυρο εντός 10–100 V και ${above()?'πάνω':'κάτω'} από τον ζυγό (αλλιώς άλλαξε θέση στην επάνω μπάρα).</p>`;
 $('#inspector').innerHTML=`<header><div><small>${esc(s.part)}</small><b>${esc(PART_NAMES[s.part]||s.part)}</b></div><button class="icon" id="insp-close">✕</button></header><div class="insp-body">${keys.map(field).join('')}${extra}</div>${rows.length?`<div class="insp-results"><div class="eyebrow">ΑΠΟΤΕΛΕΣΜΑΤΑ</div><table>${rows.map(([a,b])=>`<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table></div>`:''}${keys.length?'<footer><button id="insp-apply" class="primary">Εφαρμογή ↵</button><button id="insp-cancel" class="secondary">Άκυρο</button></footer>':''}`;
 $('#inspector').hidden=false;$('#insp-close').onclick=closeInspector;if($('#insp-cancel'))$('#insp-cancel').onclick=closeInspector;
 if($('#insp-apply'))$('#insp-apply').onclick=()=>{if(!readInspector())return;const d=state.inspect.draft,ch={};for(const k of keys)if(d[k]!==state.params[k])ch[k]=d[k];closeInspector();if(Object.keys(ch).length)applyParams(ch);};
 $('#inspector').onkeydown=e=>{if(e.key==='Escape')closeInspector();if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();$('#insp-apply')?.click();}};
}
function refreshInspector(){if(!state.inspect)return;readInspector();renderInspector();placeInspector();}
function placeInspector(){const s=state.inspect,box=$('#inspector');if(!s||box.hidden)return;const a=s.anchor,w=box.offsetWidth,h=box.offsetHeight;let left=a.right+12;if(left+w>innerWidth-12)left=a.left-w-12;if(left<12)left=Math.max(12,Math.min(innerWidth-w-12,a.left));let top=Math.min(Math.max(12,a.top),innerHeight-h-12);box.style.left=(left+scrollX)+'px';box.style.top=(top+scrollY)+'px';}

// ---------- schematic ----------
function simPoint(){const r=state.result;return r?.q5.tests.find(t=>t.id===state.simcfg.test)||r?.q5.tests[1];}
function drawSchematic(){
 if(!state.result)return;const c=state.result.config,t=simPoint(),sc=SCN[state.simcfg.scenario];
 schematic.render({position:c.position,bus:sc.bus,V_src:c.V_src,vbus_sim:c.vbus_nom,vst_sim:fmt(t.vst),R_src:c.R_src,C_bus:c.C_bus,ESR:c.ESR,L:c.L,P_load:state.simcfg.P_load});
 $$('[data-bus]').forEach(b=>b.classList.toggle('active',b.dataset.bus===sc.bus));
 simLive(true);
}

// ---------- scenarios ----------
const vbusFromSource=(c,p)=>{const d=c.V_src**2-4*c.R_src*p;return d<0?NaN:(c.V_src+Math.sqrt(d))/2;};
const iFromP=(c,p,vbus,vst)=>above()?-p/vbus:p/vst;
const SCN={
 test:{name:'Ερ. 5 · σταθερό D και σωστό i_L(0)',bus:'ideal',fields:['test','carrier'],build(r,o){const t=o.point;const i0=o.carrier==='saw'?t.iL0_S2_first:t.iL0_symmetric;
  return {sim:{control:{mode:'open',D:t.D}},init:{i0},target:t,text:`D = D₀ = ${fmt(t.D,5)} και i_L(0) = ${fmt(i0,5)} A (${o.carrier==='saw'?'πριονωτός φορέας, S2 πρώτα ON: I − Δi/2':'συμμετρικός φορέας: i_L(0) = I_avg'}). Το ρεύμα ξεκινά κατευθείαν περιοδικό: αυτό ζητά η εκφώνηση.`};}},
 zero:{name:'Σταθερό D, i_L(0) = 0 · δεν συγκλίνει',bus:'ideal',fields:['test'],build(r,o){const t=o.point;return {sim:{control:{mode:'open',D:t.D}},init:{i0:0},target:t,text:'Ίδιο D₀ αλλά αρχικό ρεύμα 0: η μέση τάση του πηνίου είναι μηδέν, οπότε το ρεύμα μένει γύρω από το 0 για πάντα. Το D δεν «τραβάει» το ρεύμα στα ±40 kW.'};}},
 drift:{name:'D = D₀ + δ · ολίσθηση',bus:'ideal',fields:['test','delta'],build(r,o){const t=o.point,d=o.delta;return {sim:{control:{mode:'open',D:t.D+d}},init:{i0:t.iL0_symmetric},target:t,text:`Σφάλμα duty δ = ${d}: μέση τάση πηνίου V_hi·δ = ${fmt(t.vhi*d,4)} V, άρα κλίση ${fmt(t.vhi*d/r.config.L/1e3,4)} A/ms. Το μέσο ρεύμα δεν σταθεροποιείται.`};}},
 dd:{name:'Μετάβαση με ΔD · ανοικτός βρόχος',bus:'ideal',fields:['test','dD'],build(r,o){const t=o.point,c=r.config,dI=-2*t.IL,dD=Math.sign(dI)*Math.abs(o.dD),tt=c.L*Math.abs(dI)/(t.vhi*Math.abs(dD)),N=Math.round(tt*c.fs);
  return {sim:{control:{mode:'dd',D:t.D,dD,N,k0:5}},init:{i0:t.iL0_symmetric},target:{...t,IL:-t.IL,imin:-t.IL-t.dI/2,imax:-t.IL+t.dI/2,p_bus:-t.p_bus},text:`Από ${fmt(t.IL)} A σε ${fmt(-t.IL)} A: D = D₀ ${dD>0?'+':'−'} ${Math.abs(dD)} για t = L·ΔI/(V_hi·ΔD) = ${fmt(tt*1e3,4)} ms ≈ ${N} περίοδοι, μετά πάλι D₀. Η στρογγυλοποίηση σε ακέραιες περιόδους αφήνει μικρό σφάλμα: γι’ αυτό στην πράξη μπαίνει κλειστός βρόχος.`};}},
 manual:{name:'Χειροκίνητο D · αλλαγή φοράς ζωντανά',bus:'ideal',fields:['test','manual'],build(r,o){const t=o.point,up=above()?'φόρτιση':'εκφόρτιση',dn=above()?'εκφόρτιση':'φόρτιση';
  return {sim:{control:{mode:'open',D:t.D}},init:{i0:t.iL0_symmetric},target:null,
   text:`Ξεκινά στο σημείο ${t.id} (⟨i_L⟩ = ${fmt(t.IL)} A, ${t.p_bus>0?'εκφόρτιση':'φόρτιση'}) με D = D₀ = ${fmt(t.D,5)}. Άλλαξε το D όσο τρέχει: ⟨v_L⟩ = V_hi·(D − D₀), άρα d⟨i_L⟩/dt = V_hi·(D − D₀)/L. Με D > D₀ το ρεύμα ανεβαίνει (προς ${up}), με D < D₀ κατεβαίνει (προς ${dn}). Όταν φτάσει όπου θες, πάτα «D = D₀» και το ρεύμα μένει εκεί, γιατί το D₀ δεν ορίζει φορά. Η αλλαγή εφαρμόζεται στην αρχή της επόμενης περιόδου.`};}},
 pi:{name:'Κλειστός βρόχος PI · εκκίνηση από 0 A',bus:'ideal',fields:['test','ff'],build(r,o){const t=o.point,pi=gains(r,t);return {sim:{carrier:'triangle',control:{mode:'pi',Kp:pi.kp,Ki:pi.ki,ff:o.ff,ref:[{t:0,I:t.IL}]}},init:{i0:0},target:t,text:`Αναφορά I_ref = ${fmt(t.IL)} A. d = ${o.ff?'D₀ + ':''}K_p·e + K_i·T_s·Σe με K_p = ${eng(pi.kp)} 1/A, K_i = ${fmt(pi.ki)} 1/(A·s) (f_c = ${fmt(pi.fc)} Hz). Δειγματοληψία στο μέσο του S1, άρα μετράται η μέση τιμή.${o.ff?'':' Χωρίς feedforward ο ολοκληρωτής πρέπει να «βρει» μόνος του το D₀: πιο αργή σύγκλιση.'}`};}},
 pirev:{name:'Κλειστός βρόχος PI · αναστροφή ισχύος',bus:'ideal',fields:['test','ff'],build(r,o){const t=o.point,pi=gains(r,t),T=1/r.config.fs;return {sim:{carrier:'triangle',control:{mode:'pi',Kp:pi.kp,Ki:pi.ki,ff:o.ff,ref:[{t:0,I:t.IL},{t:60*T,I:-t.IL}]}},init:{i0:t.iL0_symmetric},target:{...t,IL:-t.IL,imin:-t.IL-t.dI/2,imax:-t.IL+t.dI/2,p_bus:-t.p_bus},text:`${t.p_bus>0?'Εκφόρτιση → φόρτιση':'Φόρτιση → εκφόρτιση'} στο t = 3 ms: η αναφορά αλλάζει από ${fmt(t.IL)} σε ${fmt(-t.IL)} A. Ο PI αλλάζει προσωρινά το D, το ρεύμα περνά από το μηδέν και το D επιστρέφει στο ίδιο D₀ = ${fmt(t.D,4)}: το D₀ δεν αλλάζει με τη φορά.`};}},
 sys_surplus:{name:'Σύστημα · εκφόρτιση 40 kW, φορτίο 60 → 30 kW',bus:'system',fields:['test'],build(r,o){const c=r.config,t=o.point,pi=gains(r,t),T=1/c.fs,v0=vbusFromSource(c,state.simcfg.P_load-c.p_nom),I=iFromP(c,c.p_nom,v0,t.vst);
  return {sim:{carrier:'triangle',load:{type:'cpl',P:60e3},loadSchedule:[{t:0,P:60e3},{t:100*T,P:30e3}],control:{mode:'pi',Kp:pi.kp,Ki:pi.ki,ff:true,ref:[{t:0,I}]}},init:{i0:I,vC0:v0},target:null,stopAt:140*T,
   text:`Η αποθήκευση δίνει 40 kW με έλεγχο ρεύματος. Με φορτίο 60 kW η πηγή δίνει 20 kW και V_bus ≈ ${fmt(v0,4)} V. Στα 5 ms το φορτίο πέφτει στα 30 kW: περισσεύουν 10 kW, η μονόδρομη πηγή κλείνει (i_src = 0) και ο πυκνωτής φορτίζεται: ο ζυγός ξεπερνά τα 51 V μέσα σε ~0,5 ms. Η φορά του μετατροπέα δεν άλλαξε· το φορτίο άλλαξε μόνο το ισοζύγιο.`};}},
 sys_charge:{name:'Σύστημα · φόρτιση 40 kW με φορτίο 60 kW',bus:'system',fields:['test'],build(r,o){const c=r.config,t=o.point,pi=gains(r,t),v=vbusFromSource(c,60e3+c.p_nom),I=iFromP(c,-c.p_nom,v,t.vst);
  return {sim:{carrier:'triangle',load:{type:'cpl',P:60e3},control:{mode:'pi',Kp:pi.kp,Ki:pi.ki,ff:true,ref:[{t:0,I}]}},init:{i0:0,vC0:vbusFromSource(c,60e3)},target:null,
   text:`Φόρτιση 40 kW ενώ το φορτίο ζητά 60 kW: η πηγή πρέπει να δώσει ~100 kW. Με R_src = ${fmt(c.R_src*1e3)} mΩ ο ζυγός πέφτει στα ≈ ${fmt(v,4)} V, κάτω από ${c.vbus_min} V. Άρα σε υψηλό φορτίο η αποθήκευση δεν πρέπει να φορτίζει.`};}},
 sys_shave:{name:'Σύστημα · εξομάλυνση (πηγή = μέση ισχύς)',bus:'system',fields:['test'],build(r,o){const c=r.config,t=o.point,pi=gains(r,t),pbar=r.q2.load_avg_kW*1e3,pb=60e3-pbar,v=vbusFromSource(c,pbar),I=iFromP(c,pb,v,t.vst);
  return {sim:{carrier:'triangle',load:{type:'cpl',P:60e3},control:{mode:'pi',Kp:pi.kp,Ki:pi.ki,ff:true,ref:[{t:0,I}]}},init:{i0:I,vC0:v},target:null,
   text:`Η πηγή δίνει τη μέση ισχύ ${fmt(pbar/1e3)} kW και η αποθήκευση το υπόλοιπο ${fmt(pb/1e3)} kW στο μέγιστο φορτίο 60 kW. Ο ζυγός μένει ≈ ${fmt(v,4)} V, εντός ${c.vbus_min}–${c.vbus_max} V.`};}},
};
function gains(r,t){const c=r.config,fs=c.fs,wc=2*Math.PI*c.fc_ratio*fs,phid=wc/fs,pm=c.pm_deg*Math.PI/180;let th=Math.PI/2-pm-phid;if(th<=0)th=5*Math.PI/180;const wz=wc*Math.tan(th),kp=wc*c.L*Math.cos(th)/t.vhi;return {kp,ki:kp*wz,fc:wc/2/Math.PI};}
function buildScenarioUI(){
 const r=state.result,cfg=state.simcfg;
 $('#sc-select').innerHTML=Object.entries(SCN).map(([k,s])=>`<option value="${k}" ${k===cfg.scenario?'selected':''}>${esc(s.name)}</option>`).join('');
 const sc=SCN[cfg.scenario],f=[];
 if(sc.fields.includes('test'))f.push(`<label>Σημείο λειτουργίας<select id="sc-test">${r.q5.tests.map(t=>`<option value="${t.id}" ${t.id===cfg.test?'selected':''}>${t.id} · V_st = ${fmt(t.vst,4)} V · ${t.p_bus>0?'+':'−'}${fmt(Math.abs(t.p_bus)/1e3)} kW${t.covered_by?' (= '+t.covered_by.join('/')+')':''}</option>`).join('')}</select></label>`);
 if(sc.fields.includes('carrier'))f.push(`<label>Φορέας PWM<select id="sc-carrier"><option value="triangle" ${cfg.carrier==='triangle'?'selected':''}>Συμμετρικός (τριγωνικός)</option><option value="saw" ${cfg.carrier==='saw'?'selected':''}>Πριονωτός · S2 πρώτα ON</option></select></label>`);
 if(sc.fields.includes('delta'))f.push(`<label>Σφάλμα duty δ<input id="sc-delta" type="number" step="0.0005" value="${cfg.delta}"></label>`);
 if(sc.fields.includes('dD'))f.push(`<label>Μέτρο ΔD<input id="sc-dD" type="number" step="0.01" min="0.005" value="${cfg.dD}"></label>`);
 if(sc.fields.includes('ff'))f.push(`<label>Feedforward D₀<select id="sc-ff"><option value="1" ${cfg.ff?'selected':''}>Ναι · d = D₀ + PI</option><option value="0" ${cfg.ff?'':'selected'}>Όχι · μόνο PI</option></select></label>`);
 if(sc.fields.includes('manual')){const t=simPoint(),lo=Math.max(.01,t.D-.12),hi=Math.min(.99,t.D+.12);
  f.push(`<div class="manual-d"><label>D (duty S2) · αλλάζει ζωντανά<input id="sc-D" type="range" min="${lo.toFixed(3)}" max="${hi.toFixed(3)}" step="0.001" value="${t.D}"></label><div class="manual-btns"><button class="secondary" data-dset="-0.02">D₀ − 0,02</button><button class="secondary" data-dset="0">D = D₀</button><button class="secondary" data-dset="0.02">D₀ + 0,02</button></div><output id="sc-D-out"></output></div>`);}
 $('#sc-fields').innerHTML=f.join('');
 $('#sc-D')&&($('#sc-D').oninput=e=>setManualD(Number(e.target.value)));
 $$('#sc-fields [data-dset]').forEach(b=>b.onclick=()=>{const d=simPoint().D+Number(b.dataset.dset);$('#sc-D').value=d;setManualD(d);});
 $('#sc-test')&&($('#sc-test').onchange=e=>{cfg.test=e.target.value;drawSchematic();simSetup(true);});
 $('#sc-carrier')&&($('#sc-carrier').onchange=e=>{cfg.carrier=e.target.value;simSetup(true);});
 $('#sc-delta')&&($('#sc-delta').onchange=e=>{cfg.delta=Number(e.target.value)||0;simSetup(true);});
 $('#sc-dD')&&($('#sc-dD').onchange=e=>{cfg.dD=Math.abs(Number(e.target.value))||.05;simSetup(true);});
 $('#sc-ff')&&($('#sc-ff').onchange=e=>{cfg.ff=e.target.value==='1';simSetup(true);});
}
function setManualD(d){
 const e=sim.engine,t=simPoint();if(!e||!t||e.p.control.mode!=='open')return;e.p.control.D=d;
 const dd=d-t.D,vl=t.vhi*dd,rate=vl/state.result.config.L,dir=Math.abs(dd)<5e-4?'το ρεύμα μένει σταθερό':`το ⟨i_L⟩ ${rate>0?'ανεβαίνει':'κατεβαίνει'} ${fmt(Math.abs(rate)/1e3,4)} A/ms = ${fmt(Math.abs(rate)/state.result.config.fs,4)} A ανά περίοδο`;
 const o=$('#sc-D-out');if(o)o.innerHTML=`D = <b>${fmt(d,4)}</b> · D − D₀ = ${dd>=0?'+':'−'}${fmt(Math.abs(dd),4)} · ⟨v_L⟩ = ${fmt(vl,4)} V → ${dir}`;
}
function selectScenario(key,test,scroll=false){state.simcfg.scenario=key;if(test)state.simcfg.test=test;buildScenarioUI();drawSchematic();simSetup(true);if(scroll)$('.bench').scrollIntoView({behavior:'smooth',block:'start'});}

// ---------- simulation ----------
const sim={engine:null,running:false,raf:0,last:0,frame:0,limited:false,target:null,traces:{i:true,iref:true,isrc:true,lower:true,g:true}};
const speed=()=>Number($('#sim-speed').value);
function simSetup(reset=true){
 const r=state.result;if(!r)return;const c=r.config,cfg=state.simcfg,sc=SCN[cfg.scenario],t=simPoint();
 const b=sc.build(r,{point:t,carrier:cfg.carrier,delta:cfg.delta,dD:cfg.dD,ff:cfg.ff});
 const T=1/c.fs;
 const p={pos:c.position,Vst:t.vst,Vbus:c.vbus_nom,bus:sc.bus,Vsrc:c.V_src,Rsrc:c.R_src,C:c.C_bus,ESR:c.ESR,L:c.L,fs:c.fs,h:T/Number($('#sim-step').value),carrier:b.sim.carrier||cfg.carrier,
  load:b.sim.load||{type:'cpl',P:0},loadSchedule:b.sim.loadSchedule||null,control:b.sim.control};
 const wasRunning=sim.running;
 if(!sim.engine||reset){sim.engine=new BidirSim(p);sim.engine.reset(b.init);}else{sim.engine.configure(p);}
 sim.target=b.target;sim.stopAt=b.stopAt||null;$('#sc-desc').textContent=b.text+(b.stopAt?` Αυτόματη παύση στα ${fmt(b.stopAt*1e3)} ms· ▶ για συνέχεια.`:'');
 if($('#sc-D')){$('#sc-D').value=sim.engine.p.control.D;setManualD(sim.engine.p.control.D);}
 simNotes();drawScope();simLive(true);simReadout();simCompare();if(!wasRunning)simPause();
}
function simPlay(){if(!sim.engine)return;sim.running=true;sim.last=performance.now();$('#sim-play').textContent='❚❚ Παύση';$('#sim-play').classList.add('running');cancelAnimationFrame(sim.raf);sim.raf=requestAnimationFrame(simLoop);}
function simPause(){sim.running=false;cancelAnimationFrame(sim.raf);$('#sim-play').textContent='▶ Προσομοίωση';$('#sim-play').classList.remove('running');simLive(true);simReadout();simCompare();drawScope();}
function simLoop(ts){if(!sim.running)return;const dt=Math.min(.05,Math.max(0,(ts-sim.last)/1000));sim.last=ts;let want=dt*speed()*sim.engine.T;if(sim.stopAt&&sim.engine.t<sim.stopAt)want=Math.min(want,sim.stopAt-sim.engine.t);const r=sim.engine.play(want,60000);if(sim.stopAt&&sim.engine.t>=sim.stopAt*(1-1e-9)){sim.stopAt=null;simPause();return;}sim.limited=r.limited;sim.frame++;drawScope();if(sim.frame%3===0){simLive();simReadout();}if(sim.frame%15===0)simCompare();sim.raf=requestAnimationFrame(simLoop);}
function simNotes(){if(!sim.engine)return;const T=sim.engine.T,pps=speed();$('#sim-speed-note').textContent=`${fmt(pps,3)} περίοδοι/s · ${si(pps*T,'s',3)}/s`;$('#sim-step-note').textContent=`Δt = ${si(sim.engine.h,'s',4)}`;}
function simLive(force){
 const e=sim.engine;if(!e||!schematic?.geo)return;const n=e.now(),L=e.last,slow=speed()<=5||!sim.running;
 const c=state.result.config;
 if(e.t===0&&!sim.running){const t=sim.target,ref=e.p.control.mode==='pi'?e.p.control.ref?.[0]?.I:undefined,I=t?t.IL:(ref??e.i),pb=t?t.p_bus:(above()?-I*c.vbus_nom:I*e.p.Vst);
  schematic.update({i:I,s2:null,pbus:pb,ibus:pb/c.vbus_nom,ist:pb/e.p.Vst,isrc:0,iload:0,vL:NaN,mode:'avg',modeName:modeName(pb)});return;}
 const pbus=L?L.pbus:n.vbus*n.icb,vb=L?L.vbus:n.vbus;
 schematic.update({i:slow?n.i:(L?L.iavg:n.i),s2:slow?n.s2:null,pbus,ibus:pbus/vb,ist:pbus/e.p.Vst,isrc:L&&!slow?L.isrc:n.isrc,iload:n.iload,vL:slow?n.vL:NaN,mode:slow?'inst':'avg',modeName:modeName(pbus)});
}
function modeName(p){if(Math.abs(p)<1)return '';const dis=p>0;return above()?(dis?'Buck':'Boost'):(dis?'Boost':'Buck');}
function simReadout(){
 const e=sim.engine;if(!e)return;const n=e.now();$('#sim-clock').textContent='t = '+si(e.t,'s',5);
 $('#sim-readout').innerHTML=`<span>περίοδος <b>${e.k}</b></span><span class="state ${n.s2?'st-ON':'st-OFF'}">${n.s2?'S2 ON':'S1 ON'}</span><span>i_L <b>${fmt(n.i,5)} A</b></span><span>v_L <b>${fmt(n.vL,4)} V</b></span><span>v_bus <b>${fmt(n.vbus,5)} V</b></span><span>D <b>${fmt(n.d,5)}</b></span>${n.iref!==null&&e.p.control.mode==='pi'?`<span>I_ref <b>${fmt(n.iref,5)} A</b></span>`:''}${e.p.bus==='system'?`<span>i_src <b>${fmt(n.isrc,4)} A</b></span>`:''}${sim.limited?'<span class="warn-text">⚠ όριο CPU</span>':''}`;
}
function simCompare(){
 const e=sim.engine,t=sim.target;if(!e){return;}const L=e.last;
 if(!L){$('#sim-compare').innerHTML='<p class="muted">Η σύγκριση εμφανίζεται μετά την πρώτη περίοδο.</p>';return;}
 const h=e.history,prev=h.length>1?h[h.length-2]:null,settled=prev&&Math.abs(L.iavg-prev.iavg)<1e-4*Math.max(1,Math.abs(L.iavg))&&Math.abs(L.vbus-prev.vbus)<1e-5*L.vbus;
 const rows=[['⟨i_L⟩',L.iavg,t?.IL,'A'],['Δi_L,pp',L.imax-L.imin,t?.dI,'A'],['i_L,min',L.imin,t?.imin,'A'],['i_L,max',L.imax,t?.imax,'A'],['P_bus',L.pbus,t?.p_bus,'W'],['⟨v_bus⟩',L.vbus,t?state.result.config.vbus_nom:undefined,'V']];
 if(e.p.bus==='system')rows.push(['⟨i_src⟩',L.isrc,undefined,'A'],['P_load',L.pload,undefined,'W']);
 const diff=(a,b)=>b===undefined||!Number.isFinite(b)?'':Math.abs(b)<1e-9?si(a-b,'',3):fmt(100*(a/b-1),3)+' %';
 $('#sim-compare').innerHTML=`<table><thead><tr><th>Τελευταία περίοδος</th><th>Προσομοίωση</th><th>${t?'Ανάλυση':''}</th><th>${t?'Διαφορά':''}</th></tr></thead><tbody>${rows.map(([nm,a,b,u])=>`<tr><td>${nm}</td><td>${si(a,u,5)}</td><td>${b===undefined?'':si(b,u,5)}</td><td>${diff(a,b)}</td></tr>`).join('')}</tbody></table><p class="${settled?'good':'muted'}">${settled?'✓ Περιοδική μόνιμη κατάσταση.':'Η μέση τιμή αλλάζει ακόμη από περίοδο σε περίοδο.'}${e.p.bus==='system'&&(L.vbus>state.result.config.vbus_max||L.vbus<state.result.config.vbus_min)?` <span class="bad">⚠ V_bus εκτός ${state.result.config.vbus_min}–${state.result.config.vbus_max} V</span>`:''}</p>`;
}
const TRACE={i:['i_L','#147966'],iref:['I_ref','#c78126'],isrc:['i_src','#7a6a1d'],lower:['κάτω','#2f5fa0'],g:['S2 ON','#c78126']};
function oscLegend(){$('#osc-legend').innerHTML=Object.entries(TRACE).map(([k,[n,c]])=>`<label class="trace" style="--c:${c}"><input type="checkbox" data-trace="${k}" ${sim.traces[k]?'checked':''}><i></i>${k==='lower'?'κάτω διάγραμμα':n}</label>`).join('')+'<span class="muted">διακεκομμένες: τιμές ανάλυσης</span>';$$('#osc-legend [data-trace]').forEach(x=>x.onchange=()=>{sim.traces[x.dataset.trace]=x.checked;drawScope();});}
function drawScope(){
 const canvas=$('#osc-canvas');if(!canvas)return;const holder=canvas.parentElement,w=holder.clientWidth,h=holder.clientHeight;if(!w||!h)return;
 const ratio=devicePixelRatio||1;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.font='10px Inter, Segoe UI, Arial';
 const e=sim.engine;if(!e)return;
 const pad={l:54,r:10,t:8,b:22},gap=16,pw=w-pad.l-pad.r,h1=(h-pad.t-pad.b-gap)*.58,h2=(h-pad.t-pad.b-gap)-h1,top={y:pad.t,h:h1},bot={y:pad.t+h1+gap,h:h2};
 const pane=(p,r,label)=>{ctx.fillStyle='#fbfcfa';ctx.fillRect(pad.l,p.y,pw,p.h);ctx.strokeStyle='#e3e9e3';ctx.strokeRect(pad.l+.5,p.y+.5,pw-1,p.h-1);if(!r)return null;const py=v=>p.y+(r[1]-v)/(r[1]-r[0])*p.h;ctx.fillStyle='#87938d';ctx.textAlign='right';for(let j=0;j<=3;j++){const v=r[0]+(r[1]-r[0])*j/3,y=py(v);ctx.strokeStyle='#edf1ec';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+pw,y);ctx.stroke();ctx.fillText(eng(v),pad.l-6,y+3);}if(r[0]<0&&r[1]>0){ctx.strokeStyle='#c6d4cb';ctx.beginPath();ctx.moveTo(pad.l,py(0));ctx.lineTo(pad.l+pw,py(0));ctx.stroke();}ctx.save();ctx.translate(11,p.y+p.h/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillStyle='#6d7c7f';ctx.fillText(label,0,0);ctx.restore();return py;};
 const lower=$('#sim-lower').value,lowerLabel={vL:'v_L (V)',vbus:'v_bus (V)',d:'D'}[lower];
 if(e.t===0){pane(top,null,'A');pane(bot,null,lowerLabel);ctx.fillStyle='#6d7c7f';ctx.textAlign='center';ctx.font='12px Inter, Segoe UI, Arial';ctx.fillText('▶ Προσομοίωση ή Space',pad.l+pw/2,top.y+top.h/2);return;}
 const win=$('#sim-window').value,T=e.T,columns=Math.max(10,Math.floor(pw));let t0,t1,env=false;
 if(win==='all'){env=true;t0=0;t1=Math.max(e.t,T);}else{const W=Number(win)*T;t1=Math.max(e.t,W);t0=t1-W;}
 const keys=['i','iref','isrc','lower','g'],B={};for(const k of keys)B[k]={f:new Float64Array(columns).fill(NaN),mn:new Float64Array(columns).fill(Infinity),mx:new Float64Array(columns).fill(-Infinity),l:new Float64Array(columns).fill(NaN)};
 const put=(k,col,v)=>{const b=B[k];if(Number.isNaN(b.f[col]))b.f[col]=v;if(v<b.mn[col])b.mn[col]=v;if(v>b.mx[col])b.mx[col]=v;b.l[col]=v;};
 const colOf=t=>Math.min(columns-1,Math.max(0,Math.floor((t-t0)/(t1-t0)*columns)));
 const pos=e.p.pos,Vst=e.p.Vst,pi=e.p.control.mode==='pi',sys=e.p.bus==='system';
 if(env){for(const row of e.history){const col=colOf(row.t);put('i',col,row.imin);put('i',col,row.imax);if(pi)put('iref',col,row.iref);if(sys)put('isrc',col,row.isrc);put('lower',col,lower==='d'?row.d:lower==='vbus'?row.vbus:row.vbus);}}
 else{const stride=Math.max(1,Math.ceil((t1-t0)/e.h/250000));e.each(t0,t1,(t,i,vb,g,d,ir,is)=>{const col=colOf(t);put('i',col,i);if(pi)put('iref',col,ir);if(sys)put('isrc',col,is);const vlo=pos==='above'?vb:Vst,vhi=pos==='above'?Vst:vb;put('lower',col,lower==='d'?d:lower==='vbus'?vb:(g?vlo:vlo-vhi));put('g',col,g);},stride);}
 const range=(ks,zero)=>{let lo=Infinity,hi=-Infinity;for(const k of ks){if(!sim.traces[k]&&k!=='lower')continue;const b=B[k];for(let j=0;j<columns;j++){if(b.mn[j]<lo)lo=b.mn[j];if(b.mx[j]>hi)hi=b.mx[j];}}if(!Number.isFinite(lo))return null;const tg=sim.target;if(tg&&ks.includes('i')){lo=Math.min(lo,tg.imin);hi=Math.max(hi,tg.imax);}if(zero){lo=Math.min(lo,0);hi=Math.max(hi,0);}let s=hi-lo;if(s<1e-9)s=Math.max(Math.abs(hi)*.02,1e-3);return [lo-s*.08,hi+s*.08];};
 const pyI=pane(top,range(['i','iref','isrc'],false),'A'),pyL=pane(bot,range(['lower'],lower==='vL'),lowerLabel);
 const xpx=j=>pad.l+(j+.5)*pw/columns;
 const draw=(k,py,color,width)=>{const b=B[k];if(!py)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let st=false;for(let j=0;j<columns;j++){if(Number.isNaN(b.f[j]))continue;const x=xpx(j);if(!st){ctx.moveTo(x,py(b.f[j]));st=true;}else ctx.lineTo(x,py(b.f[j]));ctx.lineTo(x,py(b.mn[j]));ctx.lineTo(x,py(b.mx[j]));ctx.lineTo(x,py(b.l[j]));}ctx.stroke();};
 ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,h-pad.t-pad.b);ctx.clip();
 if(sim.traces.g&&!env&&pyI){const b=B.g;ctx.fillStyle='#c7812620';let g=0;for(let j=0;j<columns;j++){const has=!Number.isNaN(b.f[j]);const on=has?b.mx[j]>0:g>0;if(has)g=b.l[j];if(on)ctx.fillRect(pad.l+j*pw/columns,top.y,pw/columns+.6,top.h);}}
 const tg=sim.target;if(tg&&pyI){ctx.setLineDash([4,4]);ctx.lineWidth=1;ctx.strokeStyle='#14796699';for(const v of [tg.imin,tg.IL,tg.imax]){ctx.beginPath();ctx.moveTo(pad.l,pyI(v));ctx.lineTo(pad.l+pw,pyI(v));ctx.stroke();}ctx.setLineDash([]);}
 if(sim.traces.isrc&&sys)draw('isrc',pyI,TRACE.isrc[1],1.4);if(sim.traces.iref&&pi)draw('iref',pyI,TRACE.iref[1],1.4);if(sim.traces.i)draw('i',pyI,TRACE.i[1],1.9);
 if(sim.traces.lower)draw('lower',pyL,TRACE.lower[1],1.6);
 if(sys&&lower==='vbus'&&pyL){const c=state.result.config;ctx.setLineDash([5,4]);ctx.strokeStyle='#b4484888';for(const v of [c.vbus_min,c.vbus_max]){ctx.beginPath();ctx.moveTo(pad.l,pyL(v));ctx.lineTo(pad.l+pw,pyL(v));ctx.stroke();}ctx.setLineDash([]);}
 ctx.restore();
 ctx.fillStyle='#87938d';const span=t1-t0,unit=t1>=1e-3?['ms',1e3]:['μs',1e6],dec=Math.min(6,Math.max(0,Math.ceil(-Math.log10(span*unit[1]/5))+1));
 for(let j=0;j<=5;j++){const t=t0+span*j/5;ctx.textAlign=j===0?'left':j===5?'right':'center';ctx.fillText((t*unit[1]).toLocaleString('el-GR',{minimumFractionDigits:dec,maximumFractionDigits:dec,useGrouping:false}),pad.l+pw*j/5,h-6);}
 ctx.textAlign='right';ctx.fillText('t ('+unit[0]+')'+(env?' · min–max ανά περίοδο':''),pad.l+pw,bot.y-4);
}

// ---------- charts, math helpers ----------
function metric(label,value,unit,detail='',accent=false){return `<div class="metric ${accent?'accent':''}"><small>${label}</small><strong>${value} <span>${unit}</span></strong><p>${detail}</p></div>`;}
function table(rows,head=['Μέγεθος','Τιμή']){return `<table class="table"><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function mathView(m){return m?`<div class="math">${m.mathml}</div>`:'';}
function detailedStep(s){return `<article class="step"><h3>${esc(s.title)}</h3><p>${esc(s.explanation)}</p>${s.math?mathView(s.math):''}${s.numeric?'<div class="eyebrow">ΑΡΙΘΜΗΤΙΚΗ ΑΝΤΙΚΑΤΑΣΤΑΣΗ</div>'+mathView(s.numeric):''}${s.result?`<div class="numeric-result">${mathView(s.result)}${s.unit?`<p class="scope">μονάδα: ${esc(s.unit)}</p>`:''}</div>`:''}</article>`;}
function steps(list){return `<div class="steps">${list.map(detailedStep).join('')}</div>`;}
function plotBox(id,tall=false){return `<div id="${id}" class="plot ${tall?'tall':''}"><canvas role="img" aria-label="${id}"></canvas></div>`;}
function legend(s){return `<div class="legend">${s.map((x,i)=>`<span><i style="background:${x.color||colors[i]}"></i>${x.name}</span>`).join('')}</div>`;}
function clearCharts(){state.charts.forEach(c=>c.destroy());state.charts=[];}
function plot(id,x,series,o={}){const h=$('#'+id);if(!h)return;const c=new Chart(h,x,series,o);state.charts.push(c);return c;}
class Chart{
 constructor(holder,x,series,o){this.holder=holder;this.canvas=holder.querySelector('canvas');this.x=x;this.series=series;this.o=o;this.obs=new ResizeObserver(()=>this.draw());this.obs.observe(holder);this.mv=e=>this.hover(e);this.lv=()=>$('#tooltip').hidden=true;this.canvas.addEventListener('mousemove',this.mv);this.canvas.addEventListener('mouseleave',this.lv);this.draw();}
 destroy(){this.obs.disconnect();$('#tooltip').hidden=true;}
 draw(){const w=this.holder.clientWidth,h=this.holder.clientHeight;if(!w)return;const r=devicePixelRatio||1;this.canvas.width=w*r;this.canvas.height=h*r;const ctx=this.canvas.getContext('2d');ctx.scale(r,r);ctx.clearRect(0,0,w,h);
  const pad={l:58,r:17,t:17,b:37},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,x0=this.x[0],x1=this.x.at(-1);let lo=Infinity,hi=-Infinity;for(const s of this.series)for(const v of s.y)if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}if(!Number.isFinite(lo))return;if(this.o.zero){lo=Math.min(lo,0);hi=Math.max(hi,0);}let sp=hi-lo;if(sp<1e-12)sp=Math.max(Math.abs(hi)*.1,.1);lo-=sp*.1;hi+=sp*.1;
  const px=v=>pad.l+(v-x0)/(x1-x0||1)*pw,py=v=>pad.t+(hi-v)/(hi-lo)*ph;this.dim={pad,pw,w,x0,x1};ctx.font='10px Inter, Segoe UI, Arial';
  if(this.o.bands)for(const b of this.o.bands){ctx.fillStyle=b.color;ctx.fillRect(px(b.x0),pad.t,px(b.x1)-px(b.x0),ph);}
  for(let j=0;j<=4;j++){const y=pad.t+j*ph/4,v=hi-(hi-lo)*j/4;ctx.strokeStyle='#e8ede7';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillStyle='#87938d';ctx.textAlign='right';ctx.fillText(eng(v),pad.l-8,y+3);}
  for(let j=0;j<=5;j++){const v=x0+(x1-x0)*j/5;ctx.fillStyle='#87938d';ctx.textAlign='center';ctx.fillText(eng(v),pad.l+pw*j/5,h-17);}
  ctx.textAlign='left';ctx.fillStyle='#6d7c7f';ctx.fillText(this.o.yLabel||'',3,10);ctx.textAlign='right';ctx.fillText(this.o.xLabel||'',w-pad.r,h-2);
  if(lo<0&&hi>0){ctx.strokeStyle='#c6d4cb';ctx.beginPath();ctx.moveTo(pad.l,py(0));ctx.lineTo(w-pad.r,py(0));ctx.stroke();}
  ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,ph);ctx.clip();
  this.series.forEach((s,i)=>{ctx.strokeStyle=s.color||colors[i];ctx.lineWidth=s.width||2;ctx.setLineDash(s.dashed?[5,4]:[]);ctx.beginPath();let st=false;for(let j=0;j<this.x.length;j++){if(!Number.isFinite(s.y[j])){st=false;continue;}const X=px(this.x[j]),Y=py(s.y[j]);if(!st){ctx.moveTo(X,Y);st=true;}else ctx.lineTo(X,Y);}ctx.stroke();});
  if(this.o.markers)for(const m of this.o.markers){ctx.setLineDash([3,3]);ctx.strokeStyle='#b96d27';ctx.beginPath();ctx.moveTo(px(m),pad.t);ctx.lineTo(px(m),pad.t+ph);ctx.stroke();}
  ctx.restore();}
 hover(e){if(!this.dim)return;const r=this.canvas.getBoundingClientRect(),d=this.dim,p=e.clientX-r.left;if(p<d.pad.l||p>d.w-d.pad.r)return this.lv();const x=d.x0+(p-d.pad.l)/d.pw*(d.x1-d.x0);let j=0;while(j<this.x.length-1&&this.x[j]<x)j++;const t=$('#tooltip');t.textContent=`${this.o.xLabel||'x'}: ${fmt(this.x[j],5)}\n`+this.series.map(s=>`${s.name}: ${fmt(s.y[j],5)}`).join('\n');t.hidden=false;t.style.left=Math.min(e.clientX+13,innerWidth-220)+'px';t.style.top=Math.min(e.clientY+12,innerHeight-120)+'px';}
}

// ---------- tabs ----------
async function showTab(tab){
 const token=++state.renderToken,content=$('#content');
 $$('#content details[open]>summary').forEach(s=>state.openDetails.add(s.textContent.trim()));$$('#content details:not([open])>summary').forEach(s=>state.openDetails.delete(s.textContent.trim()));
 content.style.minHeight=content.offsetHeight+'px';state.tab=tab;clearCharts();$$('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));content.innerHTML='';
 try{RENDER[tab]();}catch(e){notice(e.message,true);}
 $$('#content details>summary').forEach(s=>{if(state.openDetails.has(s.textContent.trim()))s.parentElement.open=true;});requestAnimationFrame(()=>content.style.minHeight='');
 $$('#content [data-load-scenario]').forEach(b=>b.onclick=()=>selectScenario(b.dataset.loadScenario,b.dataset.test||undefined,true));
}
const loadBtn=(sc,test,text)=>`<button class="secondary" data-load-scenario="${sc}" ${test?`data-test="${test}"`:''}>▶ ${esc(text)}</button>`;
const RENDER={
 q2(){
  const r=state.result,q=r.q2,c=r.config,prof=c.profile;
  $('#content').innerHTML=`<div class="metrics">${metric('ΜΕΣΗ ΙΣΧΥΣ ΦΟΡΤΙΟΥ',fmt(q.load_avg_kW),'kW',`κύκλος ${prof.at(-1)[0]} s · ${fmt(q.energy_kJ)} kJ`,true)}${metric('ΠΑΡΑΘΥΡΟ ΑΠΟΘΗΚΕΥΣΗΣ',`${fmt(c.vst_min)}–${fmt(c.vst_max)}`,'V',`ενδιάμεση ${fmt(c.vst_mid)} V · ${above()?'πάνω':'κάτω'} από τον ζυγό`)}${metric('ΡΕΥΜΑ ΖΥΓΟΥ',`${fmt(c.p_nom/c.vbus_min)} / ${fmt(c.p_over/c.vbus_min)}`,'A',`40 / 60 kW στα ${c.vbus_min} V`)}${metric('ΡΕΥΜΑ ΑΠΟΘΗΚΕΥΣΗΣ',`${fmt(c.p_nom/c.vst_min)} / ${fmt(c.p_over/c.vst_min)}`,'A',`40 / 60 kW στα ${c.vst_min} V`)}</div>
  <section class="panel"><h2>Προφίλ φορτίου του κύκλου</h2><p class="subtle">Από τις σημειώσεις του φοιτητή (μέση τιμή 38,75 kW). Έλεγξε τη μορφή με τη Γενική Εκφώνηση: η μέση τιμή εξαρτάται μόνο από τα εμβαδά, όχι από τη σειρά των τμημάτων. Μορφή: ένα σημείο ανά γραμμή «t (s), P (kW)»· κατακόρυφο σκαλοπάτι = ίδιο t δύο φορές.</p>
   <div class="split-half"><div>${plotBox('q2-profile')}</div><div><textarea id="profile-text" rows="10" style="width:100%;font-family:Consolas,monospace;font-size:12px;border:1px solid var(--line);border-radius:7px;padding:10px">${prof.map(p=>p.join(', ')).join('\n')}</textarea><button id="profile-apply" class="secondary">Εφαρμογή προφίλ</button></div></div></section>
  <section class="panel"><h2>Μέση ισχύς και ρεύματα θυρών</h2>${steps(q.steps)}</section>
  <section class="panel"><h2>Ρεύματα θυρών για όλο το παράθυρο</h2><p class="subtle">Ιδανικός μετατροπέας (η = 1). Θετική P_bus = εκφόρτιση (αποθήκευση → ζυγός).</p><div class="wrap-table">${table(q.ports.map(row=>[`${row.P_kW>0?'+':''}${fmt(row.P_kW)} kW · ${row.which}`,`${row.mode} · ${row.direction}`,row.bus.map(b=>`${fmt(b.I)} A @ ${b.V} V`).join('<br>'),row.st.map(s=>`${fmt(s.I)} A @ ${s.V} V`).join('<br>')]),['Ισχύς','Λειτουργία','Θύρα ζυγού','Θύρα αποθήκευσης'])}</div></section>`;
  plot('q2-profile',prof.map(p=>p[0]),[{name:'P_load (kW)',y:prof.map(p=>p[1])},{name:'μέση',y:prof.map(()=>q.load_avg_kW),dashed:true,color:colors[1]}],{xLabel:'t (s)',yLabel:'kW',zero:true});
  $('#profile-apply').onclick=()=>{try{const pts=$('#profile-text').value.trim().split(/\n+/).map(l=>l.split(/[,;\s]+/).filter(Boolean).map(Number));if(pts.some(p=>p.length!==2||p.some(x=>!Number.isFinite(x))))throw Error('Κάθε γραμμή: t, P');applyParams({profile:pts});}catch(e){notice(e.message,true);}};
 },
 q3(){
  const r=state.result,q=r.q3;const groups={};for(const s of q.stresses)(groups[s.name]??=[]).push(s);
  $('#content').innerHTML=`<section class="panel"><h2>Τοπολογία, καταστάσεις διακοπτών και λειτουργίες</h2><p class="subtle">Πρώτη εκτίμηση των καταπονήσεων με Δi_L ≈ 0 και Δv_C ≈ 0 (όχι «άπειρο L»: απλώς αγνοούμε προς το παρόν την κυμάτωση), σε όλο το εύρος V_bus ${r.config.vbus_min}–${r.config.vbus_max} V, V_st ${r.config.vst_min}–${r.config.vst_max} V, ισχύ ±${r.config.p_nom/1e3} και ±${r.config.p_over/1e3} kW.</p>
   ${table([['Εκφόρτιση (P_bus > 0)',`${q.modes[0].name} · ενεργός ${q.modes[0].active} · ανορθωτής ${q.modes[0].rectifier} · i_L ${above()?'< 0':'> 0'}`],['Φόρτιση (P_bus < 0)',`${q.modes[1].name} · ενεργός ${q.modes[1].active} · ανορθωτής ${q.modes[1].rectifier} · i_L ${above()?'> 0':'< 0'}`]],['Κατεύθυνση','Λειτουργία'])}
   <div class="toolbar">${loadBtn('test','Α','Δες την εκφόρτιση στο κύκλωμα')}${loadBtn('test','Δ','Δες τη φόρτιση')}</div></section>
  <section class="panel"><h2>Πίνακας καταπονήσεων (Δi ≈ 0)</h2><div class="wrap-table">${table(Object.entries(groups).map(([n,list])=>[esc(n),...['ονομαστική','με υπερφόρτιση','όλο το εύρος'].map(w=>{const s=list.find(x=>x.which===w);return s?`<b>${fmt(s.value)} ${s.unit}</b><br><small class="muted">${esc(s.at)}</small>`:'';})]),['Μέγεθος','40 kW','έως 60 kW','όλο το εύρος'])}</div></section>
  <section class="panel"><h2>Ανάπτυξη</h2>${steps(q.steps)}</section>`;
 },
 q4(){
  const r=state.result,q=r.q4,c=r.config;
  $('#content').innerHTML=`<div class="metrics">${metric('L_min (Δi ≤ 30 %·|I| στα 40 kW)',fmt(q.L_min*1e6),'μH',`στο V_st = ${fmt(q.Lreq_candidates.reduce((a,b)=>b.f>a.f?b:a).x)} V`,true)}${metric('ΕΠΙΛΕΓΜΕΝΟ L',fmt(c.L*1e6),'μH',q.L_ok?'<span class="good">ικανοποιεί</span>':'<span class="bad">μικρότερο από L_min</span>')}${metric('ΜΕΓΙΣΤΗ Δi_L',fmt(q.ripple_max.dI),'A',`V_st = ${fmt(q.ripple_max.vst)} V (${q.ripple_max.kind}) · σχετική ${fmt(q.relative_max.ratio*100)} % @ ${fmt(q.relative_max.vst)} V`)}${metric('I_L,peak',`${fmt(q.peak.nom.I)} / ${fmt(q.peak.over.I)}`,'A','40 / 60 kW, με κυμάτωση')}</div>
  <section class="panel"><div class="split-half"><div><h3>Κυμάτωση και όριο 30 % (40 kW, V_bus = ${c.vbus_nom} V)</h3>${plotBox('q4-ripple')}${legend([{name:'Δi_L,pp με το επιλεγμένο L'},{name:'0,3·|I_L,avg|',color:colors[1]}])}</div><div><h3>Απαιτούμενο L ανά σημείο</h3>${plotBox('q4-lreq')}${legend([{name:'L_req(V_st)'},{name:'επιλεγμένο L',color:colors[1]}])}</div></div>
   <div class="toolbar">${loadBtn('test',r.q5.tests.find(t=>t.id==='Ζ').covered_by?.[0]||'Ζ','Δες το σημείο μέγιστης κυμάτωσης στην προσομοίωση')}</div></section>
  <section class="panel"><h2>Duty και μέσο ρεύμα πηνίου (V_bus = ${c.vbus_nom} V)</h2><div class="split-half">${table(q.duty.map(d=>[`V_st,${d.which} = ${fmt(d.vst)} V`,`D = ${fmt(d.D,5)} · D_S1 = ${fmt(d.D_S1,5)}`]),['Σημείο','Duty'])}${table(q.il.map(x=>[`${fmt(x.vst)} V · ${x.P_kW>0?'+':''}${x.P_kW} kW`,`${fmt(x.IL)} A · ${x.mode}`]),['Σημείο','I_L,avg'])}</div><p class="scope">Με το εύρος ζυγού 49–51 V: D από ${fmt(q.duty_range_bus[0],4)} έως ${fmt(q.duty_range_bus[1],4)}.</p></section>
  <section class="panel"><h2>Ανάπτυξη</h2>${steps(q.steps)}</section>
  <section class="panel"><h2>Όλα τα σημεία (V_bus = ${c.vbus_nom} V)</h2><div class="wrap-table">${table(q.table.map(t=>[`${fmt(t.vst)} V · ${t.p_bus>0?'+':''}${t.p_bus/1e3} kW`,t.mode,fmt(t.D,4),fmt(t.IL),fmt(t.dI),`${fmt(t.imin)} / ${fmt(t.imax)}`,fmt(t.ratio*100,3)+' %',fmt(t.IL_rms),`${fmt(t.IS1_rms)} / ${fmt(t.IS2_rms)}`]),['Σημείο','Λειτ.','D','I_L (A)','Δi (A)','i_min / i_max','Δi/|I|','I_L,rms','I_S1 / I_S2 rms'])}</div></section>`;
  const N=81,xs=[...Array(N)].map((_,k)=>c.vst_min+(c.vst_max-c.vst_min)*k/(N-1)),vb=c.vbus_nom;
  const di=xs.map(v=>{const lo=above()?vb:v,hi=above()?v:vb;return lo*(1-lo/hi)/(c.L*c.fs);}),lim=xs.map(v=>c.ripple_ratio*c.p_nom/(above()?vb:v));
  const lreq=xs.map((v,k)=>di[k]*c.L/lim[k]*1e6);
  plot('q4-ripple',xs,[{name:'Δi_L',y:di},{name:'0,3|I|',y:lim,color:colors[1],dashed:true}],{xLabel:'V_st (V)',yLabel:'A',zero:true,markers:[q.ripple_max.vst]});
  plot('q4-lreq',xs,[{name:'L_req (μH)',y:lreq},{name:'L (μH)',y:xs.map(()=>c.L*1e6),color:colors[1],dashed:true}],{xLabel:'V_st (V)',yLabel:'μH',zero:true});
 },
 q5(){
  const r=state.result,q=r.q5,c=r.config,t=simPoint();
  const rows=q.tests.map(x=>`<tr class="${x.covered_by?'covered':''}"><td><b>${x.id}</b></td><td>${esc(x.desc)}${x.covered_by?`<br><small>ίδιο με ${x.covered_by.join(', ')}</small>`:''}</td><td>${fmt(x.vst,4)}</td><td>${x.p_bus>0?'+':''}${fmt(x.p_bus/1e3)}</td><td>${x.mode}</td><td>${fmt(x.D,5)}</td><td>${fmt(x.IL,5)}</td><td>${fmt(x.dI,5)}</td><td>${fmt(x.imin,5)} / ${fmt(x.imax,5)}</td><td>${fmt(x.iL0_symmetric,5)}</td><td>${fmt(x.iL0_S2_first,5)}</td><td>${fmt(x.iL0_S1_first,5)}</td><td>${fmt(x.I_st,4)}</td><td><button class="secondary" data-load-scenario="test" data-test="${x.id}">▶</button></td></tr>`).join('');
  const script=initScript(r,t);
  $('#content').innerHTML=`<section class="panel"><h2>Δοκιμές του Πίνακα 2</h2><p class="subtle">V_bus = ${c.vbus_nom} V (ιδανική πηγή), L = ${fmt(c.L*1e6)} μH, f_s = ${fmt(c.fs/1e3)} kHz. D = duty του κάτω διακόπτη S2. i_L θετικό από ${above()?'τον ζυγό':'την αποθήκευση'} προς το μέσο του half-bridge. Το i_L(0) εξαρτάται από το ποιο διάστημα είναι ενεργό στο t = 0.</p>
   <div class="wrap-table"><table class="test-table"><thead><tr><th>Δοκ.</th><th>Περιγραφή</th><th>V_st (V)</th><th>P_bus (kW)</th><th>Λειτ.</th><th>D (S2)</th><th>I_L,avg (A)</th><th>Δi_pp (A)</th><th>i_min / i_max (A)</th><th>i_L(0) συμμετρ.</th><th>i_L(0) S2 πρώτα</th><th>i_L(0) S1 πρώτα</th><th>I_st (A)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <section class="panel guide"><h2>Οδηγός PLECS, βήμα-βήμα</h2>${plecsGuide(r)}</section>
  <section class="panel"><h2>Script αρχικοποίησης · δοκιμή ${t.id}</h2><p class="subtle">Simulation → Simulation Parameters → Initialization. Τα πεδία των στοιχείων γράφονται με τα ονόματα μεταβλητών (π.χ. L, D, iL0). Αλλάζεις δοκιμή από τον πίνακα (▶) ή από το σενάριο της προσομοίωσης.</p><div class="copy-box"><pre id="init-script">${esc(script)}</pre><button id="copy-script">Αντιγραφή</button></div></section>
  <section class="panel"><h2>Γιατί αρχικό ρεύμα: ανάπτυξη</h2>${steps(q.steps)}<div class="toolbar">${loadBtn('test',t.id,'Σωστό i_L(0)')}${loadBtn('zero',t.id,'i_L(0) = 0')}${loadBtn('drift',t.id,'Λάθος D')}</div></section>`;
  $('#copy-script').onclick=async()=>{try{await navigator.clipboard.writeText(script);$('#copy-script').textContent='✓ Αντιγράφηκε';}catch{$('#copy-script').textContent='Επίλεξε και αντέγραψε';}};
 },
 control(){
  const r=state.result,cr=r.control,pi=cr.pi,t=simPoint();
  $('#content').innerHTML=`<div class="metrics">${metric('ΟΛΙΣΘΗΣΗ ΓΙΑ δ = 0,001',fmt(cr.drift_A_per_s/1e3),'A/ms',`σημείο V_hi = ${fmt(cr.point.vhi)} V`,true)}${metric('ΜΕΤΑΒΑΣΗ ΜΕ ΔD = 0,05',fmt(cr.transition.t*1e3),'ms',`${fmt(cr.transition.periods)} περίοδοι για ΔI = ${fmt(cr.transition.dI)} A`)}${metric('PI · K_p',eng(pi.kp),'1/A',`f_c = ${fmt(pi.fc)} Hz · PM ${pi.pm_deg}° · φ_d = ${fmt(pi.phi_d_deg)}°`)}${metric('PI · K_i',fmt(pi.ki),'1/(A·s)',`ω_z = ${fmt(pi.wz)} rad/s`)}</div>
  <section class="panel"><h2>Δύο τρόποι να φτάσεις στο σημείο λειτουργίας</h2><div class="split-half"><div><h3>1 · Απευθείας αρχική συνθήκη (ερώτημα 5)</h3><p class="subtle">Σταθερό D = D₀ και i_L(0) ίσο με την τιμή του σημείου λειτουργίας στο t = 0. Το κύκλωμα ξεκινά ήδη περιοδικό. Δεν υπάρχει μηχανισμός σύγκλισης: αν το i_L(0) είναι λάθος, το λάθος μένει.</p><div class="toolbar">${loadBtn('test',t.id,'Σωστό i_L(0)')}${loadBtn('zero',t.id,'i_L(0) = 0')}${loadBtn('drift',t.id,'D = D₀ + δ')}</div></div>
   <div><h3>2 · Έλεγχος και μετάβαση</h3><p class="subtle">Αλλάζεις προσωρινά το D ώστε ⟨v_L⟩ ≠ 0 και το ρεύμα να κινηθεί: είτε με υπολογισμένο χρόνο ΔD (ανοικτός βρόχος), είτε αυτόματα με κλειστό βρόχο PI που συγκλίνει στην αναφορά από οποιαδήποτε αρχή.</p><div class="toolbar">${loadBtn('manual',t.id,'Χειροκίνητο D (ζωντανά)')}${loadBtn('dd',t.id,'Μετάβαση με ΔD')}${loadBtn('pi',t.id,'PI από 0 A')}${loadBtn('pirev',t.id,'PI: αναστροφή ισχύος')}</div></div></div></section>
  <section class="panel"><h2>Μαθηματικά</h2>${steps(cr.steps)}</section>
  <section class="panel"><h2>Μετάβαση φόρτιση ↔ εκφόρτιση στο PLECS με το D (ανοικτός βρόχος)</h2><ol class="guide">
   <li>Ξεκίνα όπως στο ερώτημα 5: D = D₀ = ${fmt(cr.point.D,5)} και i_L(0) = ${fmt(cr.point.IL)} A (V_st = ${fmt(cr.point.vst)} V, ${cr.point.p_bus>0?'εκφόρτιση':'φόρτιση'} ${fmt(Math.abs(cr.point.p_bus)/1e3)} kW).</li>
   <li>Το duty γίνεται άθροισμα: <code>Constant</code> D₀ + <code>Step</code> (step time t₁ = 1 ms, initial 0, final ${cr.point.IL>0?'−':'+'}0,05) + <code>Step</code> (step time t₂ = t₁ + ${fmt(cr.transition.t*1e3,4)} ms, initial 0, final ${cr.point.IL>0?'+':'−'}0,05) → PWM του S2.</li>
   <li>Ο παλμός ΔD διαρκεί t = L·ΔI/(V_hi·ΔD) = ${fmt(cr.transition.t*1e3,4)} ms (${fmt(cr.transition.periods)} περίοδοι) και πάει το ρεύμα από ${fmt(cr.point.IL)} σε ${fmt(-cr.point.IL)} A. Βάλε το t₂ σε ακέραιο πολλαπλάσιο του Ts, αλλιώς μένει μικρό σφάλμα.</li>
   <li>Το ρεύμα περνά από το μηδέν και η ισχύς αλλάζει φορά. Μετά το t₂ το D είναι πάλι D₀ και το νέο ρεύμα μένει σταθερό.</li></ol></section>
  <section class="panel"><h2>Κλειστός βρόχος στο PLECS (προαιρετικό)</h2><ol class="guide">
   <li>Ammeter σε σειρά με το πηνίο → <code>Zero-Order Hold</code> με περίοδο <code>Ts</code>, δειγματοληψία στο μέσο του S1 (με συμμετρικό φορέα: στην κορυφή του).</li>
   <li><code>Sum</code>: e = I_ref − i_L → <code>Discrete PI</code> (ή PID με D = 0) με K_p = ${eng(pi.kp)}, K_i = ${fmt(pi.ki)}, περίοδος Ts.</li>
   <li><code>Sum</code> με το feedforward D₀ = 1 − V_lo/V_hi (σταθερά ή από μετρήσεις τάσης) → <code>Saturation</code> [0,01 … 0,99] → PWM → S2· S1 μέσω NOT.</li>
   <li>Ξεκίνα με i_L(0) = 0 και έλεγξε ότι το ⟨i_L⟩ πάει στο I_ref σε ~2 ms. Για αναστροφή, βήμα στο I_ref (<code>Step</code>).</li></ol></section>`;
 },
 system(){
  const r=state.result,s=r.system,c=r.config,se=s.series;
  $('#content').innerHTML=`<div class="metrics">${metric('P_src,max (V_bus ≥ '+c.vbus_min+' V)',fmt(s.P_src_max/1e3),'kW',`R_src = ${fmt(c.R_src*1e3)} mΩ`,true)}${metric('ΕΛΑΧΙΣΤΗ ΕΚΦΟΡΤΙΣΗ ΣΤΟ ΜΕΓΙΣΤΟ ΦΟΡΤΙΟ',fmt(s.min_discharge_at_max_load/1e3),'kW',`φορτίο ${fmt(c.load_max/1e3)} kW`)}${metric('ΑΝΟΔΟΣ ΖΥΓΟΥ 50→51 V',fmt(s.t_rise_10kW*1e3),'ms','με περίσσευμα 10 kW και κλειστή πηγή')}${metric('ΕΝΕΡΓΕΙΑ ΓΙΑ ΕΞΟΜΑΛΥΝΣΗ',fmt(s.swing_kJ),'kJ',`${fmt(s.swing_kJ/3.6)} Wh ανά κύκλο`)}</div>
  <section class="panel"><h2>Το ζήτημα με το φορτίο</h2><p class="subtle">Στο τεστ του ερωτήματος 5 φορτίο δεν χρειάζεται. Στο πλήρες σύστημα όμως το φορτίο, η μονόδρομη πηγή με R_src και ο πυκνωτής του ζυγού ορίζουν τι επιτρέπεται να κάνει ο μετατροπέας.</p>
   <div class="toolbar">${loadBtn('sys_surplus',null,'Περίσσευμα: ο ζυγός ανεβαίνει')}${loadBtn('sys_charge',null,'Φόρτιση σε υψηλό φορτίο: ο ζυγός πέφτει')}${loadBtn('sys_shave',null,'Εξομάλυνση: ο ζυγός μένει εντός')}</div>
   <div class="split-half"><div><h3>Ισχύς στον κύκλο</h3>${plotBox('sys-p')}${legend([{name:'P_load'},{name:'P_bus με εξομάλυνση (> 0 εκφόρτιση)',color:colors[1]}])}</div><div><h3>Τάση ζυγού</h3>${plotBox('sys-v')}${legend([{name:'χωρίς αποθήκευση'},{name:'με εξομάλυνση',color:colors[1]},{name:'όρια 49 / 51 V',color:colors[3]}])}</div></div>
   <h3>Χάρτης: ποιο P_bus επιτρέπεται για κάθε φορτίο</h3>${fmap(s.map,c)}</section>
  <section class="panel"><h2>Ανάπτυξη</h2>${steps(s.steps)}${table(s.vtable.map(x=>[fmt(x.P_src_kW)+' kW',fmt(x.V_bus,5)+' V']),['P_src','V_bus'])}</section>`;
  plot('sys-p',se.t,[{name:'P_load',y:se.P_load},{name:'P_bus',y:se.P_bus_shave,color:colors[1]}],{xLabel:'t (s)',yLabel:'kW',zero:true});
  plot('sys-v',se.t,[{name:'χωρίς',y:se.V_none},{name:'εξομάλυνση',y:se.V_shave,color:colors[1]},{name:'49',y:se.t.map(()=>c.vbus_min),color:colors[3],dashed:true,width:1},{name:'51',y:se.t.map(()=>c.vbus_max),color:colors[3],dashed:true,width:1}],{xLabel:'t (s)',yLabel:'V'});
 }
};
function fmap(map,c){
 const loads=[...new Set(map.map(m=>m.P_load))],pbs=[...new Set(map.map(m=>m.P_bus))];const W=640,H=260,l=70,t=10,cw=W/pbs.length,ch=H/loads.length;
 const col={ok:'#72b196',under:'#e0b45c',absorb:'#d98b8b'};let cells='';
 for(const m of map){const i=pbs.indexOf(m.P_bus),j=loads.indexOf(m.P_load);cells+=`<rect x="${l+i*cw}" y="${t+(loads.length-1-j)*ch}" width="${cw}" height="${ch}" fill="${col[m.status]}"><title>P_load ${fmt(m.P_load)} kW · P_bus ${fmt(m.P_bus)} kW · ${m.status==='ok'?'OK, V_bus = '+fmt(m.V_bus,4)+' V':m.status==='under'?'V_bus = '+fmt(m.V_bus,4)+' V < '+c.vbus_min:'η πηγή θα έπρεπε να απορροφήσει → ο ζυγός ανεβαίνει'}</title></rect>`;}
 let ticks='';for(let k=0;k<=4;k++){const pb=pbs[0]+(pbs.at(-1)-pbs[0])*k/4;ticks+=`<text x="${l+(k/4)*(W-cw)+cw/2}" y="${t+H+16}" text-anchor="middle">${fmt(pb)}</text>`;}
 for(let k=0;k<=3;k++){const pl=loads[0]+(loads.at(-1)-loads[0])*k/3;ticks+=`<text x="${l-8}" y="${t+H-(k/3)*(H-ch)-ch/2+4}" text-anchor="end">${fmt(pl)}</text>`;}
 return `<div class="heatmap"><svg class="fmap" viewBox="0 0 760 310" role="img" aria-label="Χάρτης επιτρεπτής ισχύος"><g font-size="11" fill="#6d7c7f">${cells}${ticks}<text x="${l+W/2}" y="${t+H+34}" text-anchor="middle">P_bus (kW) · > 0 εκφόρτιση</text><text transform="translate(16 ${t+H/2}) rotate(-90)" text-anchor="middle">P_load (kW)</text></g></svg></div><div class="legend"><span><i style="background:#72b196"></i>επιτρεπτό · ${c.vbus_min} ≤ V_bus ≤ ${c.vbus_max} V</span><span><i style="background:#e0b45c"></i>V_bus &lt; ${c.vbus_min} V (υπερφόρτωση πηγής)</span><span><i style="background:#d98b8b"></i>P_bus &gt; P_load: η μονόδρομη πηγή δεν απορροφά, ο ζυγός ανεβαίνει</span></div>`;
}
function initScript(r,t){
 const c=r.config,lo=above()?'Vbus':'Vst',hi=above()?'Vst':'Vbus';
 return `% PE2 Άσκηση 1 · δοκιμή ${t.id}: V_st = ${fmt(t.vst,5)} V, P_bus = ${t.p_bus>0?'+':''}${t.p_bus/1e3} kW (${t.mode})
% Συμβάσεις: D = duty του κάτω διακόπτη S2, iL > 0 από ${above()?'τον ζυγό':'την αποθήκευση'} προς το μέσο του half-bridge
Vbus = ${c.vbus_nom};          % V, ιδανική πηγή ζυγού
Vst  = ${plain(t.vst)};          % V, πηγή αποθήκευσης
L    = ${plain(c.L)};       % H
fs   = ${plain(c.fs)};        % Hz
Ts   = 1/fs;
Cbus = ${plain(c.C_bus)};  ESR = ${plain(c.ESR)};   % πυκνωτής ζυγού (από τη Γενική Εκφώνηση)
P    = ${plain(t.p_bus)};       % W, θετικό = εκφόρτιση
D    = 1 - ${lo}/${hi};    % = ${plain(t.D)}
IL   = ${above()?'-P/Vbus':'P/Vst'};      % μέσο ρεύμα πηνίου = ${plain(t.IL)} A
dI   = ${lo}*D/(L*fs);     % κυμάτωση p-p = ${plain(t.dI)} A
iL0_sym = IL;              % συμμετρικός (τριγωνικός) φορέας, t = 0 στο μέσο του S1
iL0_saw = IL - dI/2;       % πριονωτός φορέας με S2 ON στην αρχή κάθε περιόδου
iL0 = iL0_saw;             % διάλεξε ανάλογα με τον φορέα που χρησιμοποιείς
Tstop = 100*Ts;            % 5 ms αρκούν για μετρήσεις στην τελευταία περίοδο`;
}
function plecsGuide(r){
 const c=r.config,ab=above();
 return `<ol>
  <li><b>Ισχύς.</b> Πηγή «DC Voltage Source» <code>Vbus</code> στη θύρα του ζυγού και «DC Voltage Source» <code>Vst</code> στη θύρα της αποθήκευσης (η εκφώνηση το επιτρέπει σε αυτό το στάδιο). Παράλληλα στον ζυγό: «Capacitor» <code>Cbus</code> σε σειρά με «Resistor» <code>ESR</code>, με αρχική τάση ίση με Vbus (με ιδανική πηγή παράλληλα δεν παίζει ρόλο, αλλά τον ζητά η εκφώνηση). Φορτίο δεν χρειάζεται.</li>
  <li><b>Πηνίο.</b> «Inductor» <code>L</code> στην πλευρά ${ab?'του ζυγού (χαμηλή τάση)':'της αποθήκευσης (χαμηλή τάση)'}, από τον θετικό ακροδέκτη προς το μέσο του κλάδου. Στο πεδίο <b>Initial current</b> γράψε <code>iL0</code>. Έλεγξε τη φορά αναφοράς του στοιχείου: αν το βάλεις ανάποδα, άλλαξε πρόσημο. Σιγουρέψου με ένα «Ammeter» σε σειρά, προσανατολισμένο από ${ab?'τον ζυγό':'την αποθήκευση'} προς το μέσο.</li>
  <li><b>Half-bridge.</b> Δύο ιδανικά «MOSFET with Diode» (ή IGBT με δίοδο): S1 από το μέσο προς τον θετικό ακροδέκτη ${ab?'της αποθήκευσης':'του ζυγού'}, S2 από το μέσο προς την κοινή επιστροφή.</li>
  <li><b>Οδήγηση.</b> «Constant» <code>D</code> → διαμορφωτής PWM με φορέα <code>fs</code> → gate του S2· το S1 μέσω «Logical Operator» NOT (συμπληρωματικά, χωρίς dead time). Αν ο φορέας είναι πριονωτός και ξεκινά από 0, το S2 είναι ON στην αρχή κάθε περιόδου → <code>iL0 = IL − dI/2</code>. Με συμμετρικό φορέα κεντραρισμένο έτσι ώστε το t = 0 να είναι στο μέσο του S1 → <code>iL0 = IL</code>. Αν δεν είσαι σίγουρος για τη φάση του φορέα, κοίτα την πρώτη περίοδο: σωστό iL0 δίνει την ίδια μέση τιμή από την πρώτη κιόλας περίοδο.</li>
  <li><b>Solver.</b> Simulation Parameters: variable-step (π.χ. DOPRI ή RADAU), Max step size ≈ <code>Ts/200</code>, Stop time ≈ <code>100*Ts</code>. Τα ιδανικά switches με variable-step solver εντοπίζουν ακριβώς τις μεταβάσεις.</li>
  <li><b>Μετρήσεις (για κάθε δοκιμή).</b> «Voltmeter» στο πηνίο (v_L = V_lo με S2 ON, V_lo − V_hi με S1 ON), «Ammeter» για i_L, «Ammeter» στη θύρα του ζυγού. Μέση ισχύς ζυγού: «Product» v_bus·i_bus → «Periodic Average» με περίοδο Ts. Μέσο και κυμάτωση i_L από την τελευταία περίοδο (Cursors στο Scope ή Periodic Average / max−min).</li>
  <li><b>Έλεγχος αποτελέσματος.</b> Σύγκρινε με τον πίνακα δοκιμών: ⟨i_L⟩, Δi_pp, i_min/i_max, P_bus = ±${c.p_nom/1e3} kW. Αν το ⟨i_L⟩ ολισθαίνει, το D δεν είναι ακριβώς D₀ (π.χ. στρογγυλοποιημένο): γράψε τον τύπο <code>1 - Vlo/Vhi</code>, όχι αριθμό.</li>
  <li><b>Συχνά λάθη.</b> D του S1 αντί του S2 (D_S1 = 1 − D)· iL0 για λάθος φορέα (μετατόπιση Δi/2)· μέση τιμή σε μη ακέραιο αριθμό περιόδων· πολύ μεγάλο max step size (στρογγυλεμένες γωνίες).</li></ol>
  <p class="scope">Τα ονόματα των blocks αντιστοιχούν στη βιβλιοθήκη του PLECS· μπορεί να διαφέρουν ελαφρά ανά έκδοση. Η προσομοίωση εδώ δίπλα χρησιμοποιεί ακριβώς τις ίδιες συμβάσεις για να συγκρίνεις κυματομορφές.</p>`;
}
function download(name,text,type='text/html'){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function exportReport(){
 const r=state.result;if(!r)return;const sec=(t,s)=>`<h2>${esc(t)}</h2>`+s.map(detailedStep).join('');
 const body=`<h1>Αμφίδρομος μετατροπέας · Ηλεκτρονική Ισχύος 2 · Άσκηση 1</h1><p>Θέση αποθήκευσης: ${above()?'πάνω':'κάτω'} από τον ζυγό · παράθυρο ${r.config.vst_min}–${r.config.vst_max} V · L = ${fmt(r.config.L*1e6)} μH · f_s = ${fmt(r.config.fs/1e3)} kHz.</p><ul>${r.assumptions.map(a=>'<li>'+esc(a)+'</li>').join('')}</ul>`+sec('2 · Ισχύς και παράθυρο',r.q2.steps)+sec('3 · Τοπολογία και καταπονήσεις',r.q3.steps)+sec('4 · Αυτεπαγωγή',r.q4.steps)+sec('5 · Δοκιμές PLECS',r.q5.steps)+`<table>${r.q5.tests.map(t=>`<tr><td>${t.id}</td><td>${fmt(t.vst)} V</td><td>${t.p_bus/1e3} kW</td><td>D = ${fmt(t.D,5)}</td><td>I_L = ${fmt(t.IL)} A</td><td>Δi = ${fmt(t.dI)} A</td><td>i_L(0) = ${fmt(t.iL0_S2_first)} / ${fmt(t.iL0_symmetric)} A</td></tr>`).join('')}</table>`+sec('Έλεγχος και σύγκλιση',r.control.steps)+sec('Φορτίο και σύστημα',r.system.steps);
 download('PE2_bidirectional_solution.html','<!doctype html><html lang="el"><meta charset="utf-8"><title>PE2 · Αμφίδρομος μετατροπέας</title><style>body{font:15px Segoe UI,Arial;max-width:950px;margin:40px auto;padding:20px;color:#18353a}h1,h2{color:#147966}h2{margin-top:36px}p,li{line-height:1.75}table{border-collapse:collapse;width:100%;font-size:13px}td{padding:6px;border-bottom:1px solid #ddd}.math{background:#f5f8f2;padding:14px;overflow-x:auto;margin:8px 0}.eyebrow{font-size:10px;letter-spacing:.12em;color:#6d7c7f}</style>'+body+'</html>');
}

async function boot(){
 try{
  health=await fetch('/api/health').then(r=>r.json());$('#connection').textContent='Engine συνδεδεμένο';
  try{const s=JSON.parse(localStorage.getItem('pe2-bidir'));if(s?.params)Object.assign(state.params,s.params);if(s?.simcfg)Object.assign(state.simcfg,s.simcfg);if(!SCN[state.simcfg.scenario])state.simcfg.scenario='test';}catch{}
  WINDOWS[state.params.position]={vst_min:state.params.vst_min,vst_mid:state.params.vst_mid,vst_max:state.params.vst_max};
  schematic=new Schematic($('#schematic'),{onedit:(part,rect)=>openInspector(part,rect)});
  $$('[data-position]').forEach(b=>{b.classList.toggle('active',b.dataset.position===state.params.position);b.onclick=()=>{if(b.dataset.position===state.params.position)return;$$('[data-position]').forEach(x=>x.classList.toggle('active',x===b));closeInspector();const pos=b.dataset.position;state.simcfg.test='Β';applyParams({position:pos,...WINDOWS[pos]}).then(()=>simSetup(true));};});
  $$('[data-bus]').forEach(b=>b.onclick=()=>{const want=b.dataset.bus;if(SCN[state.simcfg.scenario].bus===want)return;selectScenario(want==='system'?'sys_shave':'test');});
  $('#sc-select').onchange=e=>selectScenario(e.target.value);
  $('#sim-play').onclick=()=>sim.running?simPause():simPlay();
  $('#sim-reset').onclick=()=>simSetup(true);
  $('#sim-period').onclick=()=>{if(!sim.engine)return;if(sim.running)simPause();sim.engine.run(sim.engine.T);drawScope();simLive(true);simReadout();simCompare();};
  $('#sim-speed').onchange=()=>{simNotes();simLive(true);};
  $('#sim-step').onchange=()=>{if(sim.engine)sim.engine.setStep(sim.engine.T/Number($('#sim-step').value));simNotes();};
  $('#sim-window').onchange=drawScope;$('#sim-lower').onchange=drawScope;
  new ResizeObserver(()=>drawScope()).observe($('.osc'));oscLegend();
  $$('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  $('#save-project').onclick=()=>download('PE2_bidirectional_values.json',JSON.stringify({schema:'pe2-bidir-1',params:state.params,simcfg:state.simcfg},null,2),'application/json');
  $('#load-project').onclick=()=>$('#file-input').click();
  $('#file-input').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const d=JSON.parse(await f.text());if(d.schema!=='pe2-bidir-1')throw Error('Μη έγκυρο αρχείο.');Object.assign(state.simcfg,d.simcfg||{});$$('[data-position]').forEach(x=>x.classList.toggle('active',x.dataset.position===d.params.position));await applyParams(d.params);simSetup(true);}catch(err){notice(err.message,true);}finally{e.target.value='';}};
  $('#export-report').onclick=exportReport;
  document.addEventListener('pointerdown',e=>{if(state.inspect&&!e.target.closest('#inspector')&&!e.target.closest('[data-part]'))closeInspector();});
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest('input,select,textarea,button,#inspector,[data-part]')){e.preventDefault();$('#sim-play').click();}});
  if(await calculate())await showTab(state.tab);
 }catch(e){$('#connection').textContent='Engine εκτός σύνδεσης';notice('Δεν βρέθηκε ο Python server. Εκκίνησε με python run.py. '+e.message,true);}
}
boot();
