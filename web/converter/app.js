'use strict';
// Power Converter Lab 1.0 front end.
// Parameters live on the circuit: double-click a part to edit it. Every change
// recalculates automatically. The live simulation (sim.js) integrates the
// switched equations in the browser; analysis comes from the Python engine.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const colors=['#147966','#c78126','#4d79ac','#aa5f76','#8267aa'];
const state={topology:'buck_boost',tab:'workspace',interval:'ALL',result:null,dynamic:null,envelope:null,simulation:null,sweep:null,problem:null,curves:null,derivation:null,modelProof:null,boundary:null,
 rippleSpec:{task:'size',value:.1,unit:'V'},dirty:true,charts:[],calcToken:0,renderToken:0,inspect:null,openDetails:new Set(),
 params:{vin:8,vo:12,power:24,fs:100000,L:20e-6,C:100e-6,n:.5,duty_set:.5,resistance:6,load:'resistive',drive:'regulated'}};
const PARAM_KEYS=['vin','vo','power','fs','L','C','n','duty_set','resistance'];
// k converts SI to the displayed unit.
const META={vin:{name:'Τάση εισόδου',sym:'Vin',unit:'V',k:1},vo:{name:'Ρυθμιζόμενη έξοδος',sym:'|Vo|',unit:'V',k:1},power:{name:'Ισχύς φορτίου',sym:'Po',unit:'W',k:1},
 resistance:{name:'Αντίσταση φορτίου',sym:'R',unit:'Ω',k:1},fs:{name:'Συχνότητα διακοπτών',sym:'fs',unit:'kHz',k:1e-3},duty_set:{name:'Σταθερό duty',sym:'D',unit:'',k:1},
 L:{name:'Επαγωγή',sym:'L',unit:'μH',k:1e6},C:{name:'Χωρητικότητα',sym:'C',unit:'μF',k:1e6},n:{name:'Λόγος σπειρών',sym:'n = Ns/Np',unit:'',k:1}};
let editor=null,activeRequests=0,refreshBoundary=()=>{},catalog=[],health={version:'1.0.0'};
const presets={
 exam:{topology:'buck_boost',vin:8,vo:12,power:24,fs:100,L:20,C:100,n:.5},
 buck:{topology:'buck',vin:24,vo:12,power:24,fs:100,L:100,C:100,n:.5},
 boost:{topology:'boost',vin:12,vo:24,power:48,fs:100,L:100,C:100,n:.5},
 flyback:{topology:'flyback',vin:24,vo:12,power:24,fs:100,L:30,C:100,n:.5},
 flyback_ccm:{topology:'flyback',vin:24,vo:12,power:24,fs:100,L:100,C:100,n:.5},
 flyback_dcm:{topology:'flyback',vin:24,vo:12,power:24,fs:100,L:10,C:100,n:.5},
 dcm:{topology:'buck_boost',vin:8,vo:12,power:24,fs:100,L:2,C:100,n:.5}
};
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=4)=>Number.isFinite(v)?Number(v.toPrecision(d)).toLocaleString('el-GR',{maximumFractionDigits:8}):'—';
const eng=v=>Math.abs(v)<.0001&&v!==0?v.toExponential(3):fmt(v);
const plain=v=>Number.isFinite(v)?String(Number(v.toPrecision(7))):'';
// Engineering prefix formatting for live values.
function si(v,unit,d=4){if(!Number.isFinite(v))return '—';const a=Math.abs(v);const p=a===0?['',1]:a>=1e3?['k',1e-3]:a>=1?['',1]:a>=1e-3?['m',1e3]:a>=1e-6?['μ',1e6]:['n',1e9];return fmt(v*p[1],d)+' '+p[0]+unit;}
function notice(text,error=false){$('#notice').hidden=!text;$('#notice').textContent=text;$('#notice').className=error?'error':'';}

// Requests run one at a time: the engine allows two concurrent analyses and
// a fast sequence of edits must not interleave stale results.
let queue=Promise.resolve();
function api(action,data){
 const run=async()=>{
  activeRequests++;document.body.classList.add('busy');$('#connection').textContent='Υπολογισμός…';
  try{
   const r=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,...(editor?{circuit:editor.export()}:{})})});
   const out=await r.json();if(!r.ok)throw Error(out.error||'Σφάλμα engine.');return out;
  }finally{activeRequests--;if(activeRequests===0){document.body.classList.remove('busy');$('#connection').textContent='Engine συνδεδεμένο';}}
 };
 const p=queue.then(run,run);queue=p.catch(()=>{});return p;
}
const getParams=()=>({topology:state.topology,...state.params});
function getConfig(){const c=getParams();if(editor)c.circuit=editor.export();return c;}
function setValues(values,isSI=false,resetCircuit=false){
 const oldTopology=state.topology;if(values.topology)state.topology=values.topology;
 for(const key of PARAM_KEYS){const v=Number(values[key]);if(Number.isFinite(v)&&v>0)state.params[key]=isSI?v:v/META[key].k;}
 state.params.load=values.load==='constant_power'?'constant_power':'resistive';
 state.params.drive=values.drive==='fixed_duty'?'fixed_duty':'regulated';
 if(editor&&values.topology){if(values.circuit)editor.load(values.circuit);else if(resetCircuit||values.topology!==oldTopology)editor.template(values.topology);}
 updateTopology();markDirty(false);
}
async function applyParams(partial,tab=state.tab){
 Object.assign(state.params,partial);markDirty(false);
 if(await calculate())await showTab(tab);
}
let calcTimer=null;
function scheduleCalc(delay=300){clearTimeout(calcTimer);calcTimer=setTimeout(async()=>{if(await calculate())await showTab(state.tab);},delay);}
function markDirty(schedule=true){
 state.dirty=true;$('#mode-badge').textContent='Υπολογισμός…';$('#mode-badge').className='mode pending';
 $('#content').classList.add('stale');$('#content').setAttribute('inert','');
 if(editor)editor.render();renderChips();refreshBoundary();if(schedule)scheduleCalc();else clearTimeout(calcTimer);
}
function updateTopology(){
 const model=catalog.find(m=>m.key===state.topology);if(!model)return;
 $$('.topo-switch button').forEach(b=>{b.classList.toggle('active',b.dataset.key===state.topology);b.setAttribute('aria-pressed',b.dataset.key===state.topology);});
 $('#model-heading').textContent=model.name;
 $('#polarity-note').textContent=state.topology==='buck_boost'?'Vo < 0 · υπολογισμοί με |Vo|':state.topology==='flyback'?'n = Ns/Np · im αναγμένο στο πρωτεύον':'ιδανικά στοιχεία';
 drawCircuit();
}
async function calculate(){
 const token=++state.calcToken;clearTimeout(calcTimer);
 try{
  const c=getConfig();const result=await api('analyze',c);
  if(token!==state.calcToken)return false;
  state.result=result;state.dirty=false;state.dynamic=null;state.envelope=null;state.simulation=null;state.sweep=null;state.problem=null;state.curves=null;state.derivation=null;state.modelProof=null;
  $('#content').classList.remove('stale');$('#content').removeAttribute('inert');
  state.topology=result.config.topology;
  if(c.drive==='fixed_duty'){state.params.vo=result.config.vo;if(c.load==='resistive')state.params.power=result.config.power;}
  updateTopology();$('#circuit-status').textContent='✓ Αναγνωρίστηκε '+(catalog.find(m=>m.key===state.topology)?.name||state.topology)+' από τη συνδεσμολογία · '+result.mode;$('#circuit-status').className='circuit-status ok';
  refreshBoundary();saveLocal();notice('');
  $('#mode-badge').textContent=result.mode;$('#mode-badge').className='mode '+result.mode.toLowerCase();
  renderChips();simSync(result);refreshInspector();
  return true;
 }catch(e){
  if(token!==state.calcToken)return false;
  notice(e.message,true);$('#circuit-status').innerHTML='Δεν εκτελέστηκε: '+esc(e.message)+' <button id="reset-template" class="quiet">↺ Επαναφορά προτύπου</button> <a href="/" title="Το studio λύνει οποιοδήποτε κύκλωμα">Ελεύθερο κύκλωμα στο studio ↗</a>';$('#circuit-status').className='circuit-status bad';
  $('#reset-template')&&($('#reset-template').onclick=()=>{if(editor){editor.template(state.topology);markDirty();}});
  $('#mode-badge').textContent='Μη έγκυρο';$('#mode-badge').className='mode invalid';simInvalid(e.message);renderChips();return false;
 }
}
function saveLocal(){try{localStorage.setItem('pcl2-converter',JSON.stringify(getConfig()));}catch{}}

// ---------- spec chips: every known and the key results, one click away ----------
function partFor(type){
 if(!editor)return null;if(type==='inductor'&&state.topology==='flyback')type='transformer';
 return editor.find(type)||null;
}
function renderChips(){
 const holder=$('#spec-chips');if(!holder)return;
 const p=state.params,m=state.dirty?null:state.result?.metrics,cfg=state.dirty?null:state.result?.config;
 const fixed=p.drive==='fixed_duty',cpl=p.load==='constant_power',fly=state.topology==='flyback';
 const chips=[];
 const chip=(type,sym,value,unit,out=false,title='')=>chips.push(`<button class="chip${out?' out':''}" data-part="${type}" title="${esc(title||'Διπλό κλικ στο στοιχείο ή κλικ εδώ για αλλαγή')}"><span>${esc(sym)}</span><b>${esc(value)}</b>${unit?`<i>${esc(unit)}</i>`:''}</button>`);
 chip('source','Vin',fmt(p.vin,5),'V');
 if(fixed){chip('switch','D',fmt(p.duty_set,5),'');if(cpl)chip('resistor','Po',fmt(p.power,5),'W');else chip('resistor','R',fmt(p.resistance,5),'Ω');}
 else{chip('resistor','|Vo|',fmt(p.vo,5),'V');chip('resistor','Po',fmt(p.power,5),'W');}
 chip('switch','fs',fmt(p.fs/1000,5),'kHz');
 chip(fly?'transformer':'inductor',fly?'Lm':'L',fmt(p.L*1e6,5),'μH');
 chip('capacitor','C',fmt(p.C*1e6,5),'μF');
 if(fly)chip('transformer','n',fmt(p.n,5),'');
 chip('resistor','Φορτίο',cpl?'σταθ. ισχύς':'ωμικό','');
 chips.push('<span class="chip-sep">→</span>');
 if(fixed)chip('resistor','|Vo|',cfg?fmt(cfg.vo,5):'…','V',true,'Αποτέλεσμα');else chip('switch','D',m?fmt(m.duty,5):'…','',true,'Αποτέλεσμα');
 chip(fly?'transformer':'inductor','Lcrit',m?fmt(m.Lcrit*1e6,4):'…','μH',true,'Κρίσιμη επαγωγή');
 chip(fly?'transformer':'inductor','Ipk',m?fmt(m.Ipeak,4):'…','A',true,'Ρεύμα κορυφής');
 chip('capacitor','ΔVo,pp',m?fmt(m.Vripple_pp*1000,4):'…','mV',true,'Κυμάτωση τάσης εξόδου');
 holder.innerHTML=chips.join('');
 $$('#spec-chips [data-part]').forEach(b=>b.onclick=()=>{const part=partFor(b.dataset.part);if(part)openInspector(part,b.getBoundingClientRect());else notice('Δεν υπάρχει αντίστοιχο στοιχείο στο κύκλωμα.',true);});
}

// ---------- component inspector (double-click) ----------
function openInspector(comp,anchor){
 if(!comp)return;
 state.inspect={id:comp.id,type:comp.type,draft:{...state.params},anchor};
 renderInspector();placeInspector();
 setTimeout(()=>{$('#inspector input')?.focus();$('#inspector input')?.select?.();},0);
}
function closeInspector(){state.inspect=null;$('#inspector').hidden=true;$('#inspector').innerHTML='';editor?.svg.focus();}
function inspectorFields(type,d){
 const fly=state.topology==='flyback';
 if(type==='source')return ['vin'];
 if(type==='switch')return d.drive==='fixed_duty'?['fs','duty_set']:['fs'];
 if(type==='inductor')return ['L'];
 if(type==='transformer')return ['L','n'];
 if(type==='capacitor')return ['C'];
 if(type==='resistor')return d.drive==='fixed_duty'?(d.load==='constant_power'?['power']:['resistance']):['vo','power'];
 return fly?[]:[];
}
function readInspector(){
 const s=state.inspect;if(!s)return true;let ok=true;
 $$('#inspector [data-key]').forEach(input=>{
  const key=input.dataset.key,value=Number(input.value)/META[key].k;
  const valid=Number.isFinite(value)&&value>0&&(key!=='duty_set'||value<1);
  input.closest('.input-unit').classList.toggle('invalid',!valid);if(valid)s.draft[key]=value;else ok=false;
 });
 $$('#inspector [data-choice]').forEach(sel=>{s.draft[sel.dataset.choice]=sel.value;});
 return ok;
}
function renderInspector(){
 const s=state.inspect;if(!s)return;
 const {type,id,draft:d}=s,fly=state.topology==='flyback';
 const r=state.dirty?null:state.result,m=r?.metrics,c=r?.config;
 const field=key=>{const meta=META[key];const label=key==='L'&&fly?'Lm · πρωτεύον':meta.sym;return `<label class="insp-field"><span>${esc(meta.name)} <em>${esc(label)}</em></span><div class="input-unit"><input data-key="${key}" type="number" step="any" min="0" value="${plain(d[key]*meta.k)}"><b>${esc(meta.unit)}</b></div></label>`;};
 let body='';
 if(type==='switch')body+=`<label class="insp-field"><span>Τι ορίζεται</span><select data-choice="drive"><option value="regulated" ${d.drive==='regulated'?'selected':''}>Ρυθμιζόμενο |Vo| → υπολογίζεται D</option><option value="fixed_duty" ${d.drive==='fixed_duty'?'selected':''}>Σταθερό D → υπολογίζεται Vo</option></select></label>`;
 if(type==='resistor')body+=`<label class="insp-field"><span>Μοντέλο φορτίου</span><select data-choice="load"><option value="resistive" ${d.load==='resistive'?'selected':''}>Ωμικό · i = v/R</option><option value="constant_power" ${d.load==='constant_power'?'selected':''}>Σταθερή ισχύς · i = Po/v</option></select></label>`+(d.drive==='fixed_duty'?'<p class="insp-note">Σταθερό D (ορίζεται στον διακόπτη): το |Vo| είναι αποτέλεσμα.</p>':'<p class="insp-note">Ρυθμιζόμενη έξοδος: το D υπολογίζεται. R = |Vo|²/Po.</p>');
 body+=inspectorFields(type,d).map(field).join('');
 if(type==='diode')body+='<p class="insp-note">Ιδανική δίοδος: Vf = 0, trr = 0. Άγει όταν το ρεύμα του πηνίου (ή im/n στο δευτερεύον) είναι θετικό.</p>';
 if(type==='switch'&&d.drive==='regulated')body+=`<p class="insp-note">D = ${m?fmt(m.duty,6):'…'} (υπολογισμένο για |Vo| = ${fmt(state.params.vo,5)} V). Στην προσομοίωση κρατιέται σταθερό: ανοικτός βρόχος.</p>`;
 if(type==='capacitor')body+=`<div class="insp-quick"><label>Στόχος ΔVo,pp<div class="input-unit"><input id="insp-ripple" type="number" step="any" min="0" value="${plain((state.rippleSpec.unit==='mV'?state.rippleSpec.value/1000:state.rippleSpec.unit==='percent'?state.rippleSpec.value*state.params.vo/100:state.rippleSpec.value)*1000)}"><b>mV</b></div></label><button id="insp-cmin" class="secondary" ${m?'':'disabled'}>C = Δq / ΔV</button></div>`;
 if((type==='inductor'||type==='transformer')&&m)body+=`<div class="insp-quick buttons"><button class="secondary" data-lmul="0.5">½·Lcrit · DCM</button><button class="secondary" data-lmul="1">Lcrit · BCM</button><button class="secondary" data-lmul="1.2">1,2·Lcrit · CCM</button></div>`;
 const rows=[];const row=(a,b)=>rows.push(`<tr><td>${a}</td><td>${b}</td></tr>`);
 if(m){
  if(type==='source'){row('Μέσο ρεύμα εισόδου',fmt(m.Iin,5)+' A');row('Ισχύς εισόδου',fmt(c.vin*m.Iin,5)+' W');}
  if(type==='switch'){row('Duty D',fmt(m.duty,6));row('tON',fmt(m.duty/c.fs*1e6,5)+' μs');row('Μέγιστη τάση',fmt(m.Vswitch,5)+' V');row('Ρεύμα κορυφής',fmt(m.Ipeak,5)+' A');row('RMS ρεύμα',fmt(m.ISrms,5)+' A');}
  if(type==='diode'){row('Μέσο ρεύμα',fmt(m.IDmean,5)+' A');row('RMS ρεύμα',fmt(m.IDrms,5)+' A');row('Ανάστροφη τάση',fmt(m.Vdiode_reverse,5)+' V');row('Διάρκεια αγωγής δ',fmt(m.delta,5));}
  if(type==='inductor'||type==='transformer'){row('Κρίσιμη επαγωγή Lcrit',fmt(m.Lcrit*1e6,5)+' μH');row('L / Lcrit',fmt(m.L_margin,4)+' → '+r.mode);row('ΔiL,pp',fmt(m.Iripple_pp,5)+' A');row('Imin / Ipk',fmt(m.Ivalley,4)+' / '+fmt(m.Ipeak,4)+' A');row('Μέσο / RMS',fmt(m.ILmean,4)+' / '+fmt(m.ILrms,4)+' A');if(type==='transformer'){row('Τάση διακόπτη',fmt(m.Vswitch,5)+' V');row('Ανάστροφη τάση διόδου',fmt(m.Vdiode_reverse,5)+' V');}}
  if(type==='capacitor'){row('ΔVo,pp',fmt(m.Vripple_pp*1000,5)+' mV');row('Δq,pp',fmt(m.charge_pp*1e6,5)+' μC');row('RMS ρεύμα πυκνωτή',fmt(m.ICrms,5)+' A');row('Τάση',fmt(m.signed_output,5)+' V');}
  if(type==='resistor'){row('Τάση εξόδου',fmt(m.signed_output,5)+' V');row('Ρεύμα εξόδου',fmt(m.Iout,5)+' A');row('Ισχύς',fmt(c.power,5)+' W');row('R στο σημείο',fmt(m.R,5)+' Ω');}
 }
 $('#inspector').innerHTML=`<header><div><small>${esc(id)}</small><b>${esc(CircuitEditor.names[type]||type)}</b></div><button class="icon" id="insp-close" title="Κλείσιμο (Esc)">✕</button></header>
  <div class="insp-body">${body}</div>
  ${rows.length?`<div class="insp-results"><div class="eyebrow">ΑΠΟΤΕΛΕΣΜΑΤΑ ΣΤΟΙΧΕΙΟΥ · ${esc(r.mode)}</div><table>${rows.join('')}</table></div>`:state.dirty?'<p class="insp-note">Υπολογισμός…</p>':''}
  ${inspectorFields(type,d).length||type==='switch'||type==='resistor'?'<footer><button id="insp-apply" class="primary">Εφαρμογή ↵</button><button id="insp-cancel" class="secondary">Άκυρο</button></footer>':''}`;
 $('#inspector').hidden=false;
 $('#insp-close').onclick=closeInspector;if($('#insp-cancel'))$('#insp-cancel').onclick=closeInspector;
 $$('#inspector [data-choice]').forEach(sel=>sel.onchange=()=>{readInspector();renderInspector();placeInspector();});
 if($('#insp-apply'))$('#insp-apply').onclick=()=>{if(!readInspector())return;const d=state.inspect.draft;const changed={};for(const k of [...PARAM_KEYS,'load','drive'])if(d[k]!==state.params[k])changed[k]=d[k];closeInspector();if(Object.keys(changed).length)applyParams(changed);};
 $$('#inspector [data-lmul]').forEach(b=>b.onclick=()=>{const input=$('#inspector [data-key="L"]');input.value=plain(m.Lcrit*Number(b.dataset.lmul)*1e6);input.closest('.input-unit').classList.add('flash');setTimeout(()=>input.closest('.input-unit')?.classList.remove('flash'),600);});
 if($('#insp-cmin'))$('#insp-cmin').onclick=()=>{const target=Number($('#insp-ripple').value)/1000;if(!(target>0))return;state.rippleSpec={task:'size',value:target*1000,unit:'mV'};const input=$('#inspector [data-key="C"]');input.value=plain(m.charge_pp/target*1e6);input.closest('.input-unit').classList.add('flash');setTimeout(()=>input.closest('.input-unit')?.classList.remove('flash'),600);};
 $('#inspector').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closeInspector();}if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.id!=='insp-ripple'){e.preventDefault();$('#insp-apply')?.click();}if(e.key==='Enter'&&e.target.id==='insp-ripple'){e.preventDefault();$('#insp-cmin')?.click();}};
}
// Results changed underneath an open inspector: keep typed values and focus.
function refreshInspector(){
 if(!state.inspect)return;const focused=document.activeElement?.closest?.('#inspector')?document.activeElement:null;
 const key=focused?.dataset?.key,id=focused?.id,pos=focused?.selectionStart;
 readInspector();renderInspector();placeInspector();
 const again=key?$(`#inspector [data-key="${key}"]`):id?$('#'+id):null;if(again){again.focus();try{if(pos!=null)again.setSelectionRange(pos,pos);}catch{}}
}
function placeInspector(){
 const s=state.inspect,box=$('#inspector');if(!s||box.hidden)return;
 const a=s.anchor||{left:innerWidth/2,right:innerWidth/2,top:120,bottom:120};const w=box.offsetWidth,h=box.offsetHeight;
 let left=a.right+12;if(left+w>innerWidth-12)left=a.left-w-12;if(left<12)left=Math.min(innerWidth-w-12,Math.max(12,a.left));
 let top=a.top;if(top+h>innerHeight-12)top=innerHeight-h-12;if(top<12)top=12;
 box.style.left=(left+scrollX)+'px';box.style.top=(top+scrollY)+'px';
}

// ---------- live simulation and oscilloscope ----------
const sim={engine:null,running:false,raf:0,last:0,frame:0,limited:false,invalid:null,traces:{i:true,iS:false,iD:true,iC:false,v:true,g:true}};
const TRACE={i:{name:'iL',color:'#147966'},iS:{name:'iS',color:'#c78126'},iD:{name:'iD',color:'#4d79ac'},iC:{name:'iC',color:'#aa5f76'},v:{name:'|vo|',color:'#2f5fa0'},g:{name:'gate',color:'#c78126'}};
const speedPPS=()=>Number($('#sim-speed').value);
function stepSeconds(fs){const v=$('#sim-step').value;if(v==='custom'){const ns=Number($('#sim-step-custom').value);return ns>0?ns*1e-9:1/fs/500;}return 1/fs/Number(v);}
function simParams(r){const c=r.config,m=r.metrics;return {topology:c.topology,vin:c.vin,L:c.L,C:c.C,fs:c.fs,duty:m.duty,n:c.n,load:c.load,R:m.R,P:c.power,vref:c.vo,h:stepSeconds(c.fs)};}
function simSync(r){
 try{
  const p=simParams(r);sim.invalid=null;
  if(!sim.engine||sim.engine.p.topology!==p.topology){sim.engine=new SwitchedSim(p);simReset();}
  else{sim.engine.configure(p);}
  $('#sim-play').disabled=false;simNotes();drawScope();simReadout();
 }catch(e){simInvalid(e.message);}
}
function simInvalid(message){sim.invalid=message;simPause();$('#sim-play').disabled=true;$('#sim-readout').innerHTML=`<span class="bad">Η προσομοίωση περιμένει έγκυρο σημείο: ${esc(message)}</span>`;}
function simReset(){
 if(!sim.engine||!state.result)return;
 sim.engine.reset($('#sim-start').value,{i0:state.result.metrics.Ivalley,v0:state.result.config.vo});
 editor?.setInterval(state.interval);editor?.setLive(null);drawScope();simReadout();simCompare();
}
function simPlay(){if(!sim.engine||sim.invalid)return;sim.running=true;sim.last=performance.now();$('#sim-play').textContent='❚❚ Παύση';$('#sim-play').classList.add('running');cancelAnimationFrame(sim.raf);sim.raf=requestAnimationFrame(simLoop);}
function simPause(){sim.running=false;cancelAnimationFrame(sim.raf);$('#sim-play').textContent='▶ Προσομοίωση';$('#sim-play').classList.remove('running');simLive(true);simReadout();simCompare();drawScope();}
function simLoop(ts){
 if(!sim.running)return;
 const dt=Math.min(.05,Math.max(0,(ts-sim.last)/1000));sim.last=ts;
 const r=sim.engine.play(dt*speedPPS()*sim.engine.T,60000);sim.limited=r.limited;sim.frame++;
 drawScope();if(sim.frame%3===0){simLive();simReadout();}if(sim.frame%15===0)simCompare();
 sim.raf=requestAnimationFrame(simLoop);
}
function simNotes(){
 if(!sim.engine)return;const T=sim.engine.T,pps=speedPPS();
 $('#sim-speed-note').textContent=`${fmt(pps,3)} περίοδοι/s · ${si(pps*T,'s',3)} ανά s`;
 $('#sim-step-note').textContent=`Δt = ${si(sim.engine.h,'s',4)} · ${fmt(T/sim.engine.h,4)} βήματα/T`;
}
const slowMotion=()=>speedPPS()<=5;
function simLive(force=false){
 const e=sim.engine;if(!e||!editor)return;
 const b=e.branches(),L=e.last,neg=state.topology==='buck_boost'?-1:1,fly=state.topology==='flyback';
 const instant=slowMotion()||!sim.running||!L;
 if(instant&&e.t>0)editor.setInterval(b.state);else if(!instant)editor.setInterval('ALL');
 if(e.t===0&&!sim.running){editor.setLive(null);return;}
 const live={};
 for(const c of editor.components){
  let text='';
  if(instant){
   if(c.type==='source')text=`iin = ${fmt(b.iin,4)} A`;
   if(c.type==='switch')text=b.state==='ON'?`ON · iS = ${fmt(b.iS,4)} A`:'OFF';
   if(c.type==='diode')text=b.state==='OFF'?`ON · iD = ${fmt(b.iD,4)} A`:'OFF';
   if(c.type==='inductor')text=`iL = ${fmt(b.i,4)} A`;
   if(c.type==='transformer')text=`im = ${fmt(b.i,4)} A${b.state==='OFF'?' · is = '+fmt(b.iD,4)+' A':''}`;
   if(c.type==='capacitor')text=`vo = ${fmt(neg*b.v,5)} V`;
   if(c.type==='resistor')text=`io = ${fmt(b.io,4)} A`;
  }else{
   if(c.type==='source')text=`Iin ⌀ ${fmt(L.iinavg,4)} A`;
   if(c.type==='switch')text=`IS ⌀ ${fmt(L.isavg,4)} A`;
   if(c.type==='diode')text=`ID ⌀ ${fmt(L.idavg,4)} A`;
   if(c.type==='inductor'||c.type==='transformer')text=`${fly?'Im':'IL'} ⌀ ${fmt(L.iavg,4)} · pk ${fmt(L.imax,4)} A`;
   if(c.type==='capacitor')text=`Vo ⌀ ${fmt(neg*L.vavg,5)} V · Δ ${si(L.vmax-L.vmin,'V',3)}`;
   if(c.type==='resistor')text=`Io ⌀ ${fmt(L.ioavg,4)} A`;
  }
  live[c.id]=text;
 }
 editor.setLive(live);
}
function simReadout(){
 const e=sim.engine;if(!e||sim.invalid)return;const b=e.branches();
 $('#sim-clock').textContent='t = '+si(e.t,'s',5);
 $('#sim-readout').innerHTML=`<span>περίοδος <b>${e.k}</b></span><span class="state st-${b.state}">${b.state==='IDLE'?'iL = 0':b.state==='ON'?'S ON':'S OFF · D ON'}</span><span>${state.topology==='flyback'?'im':'iL'} <b>${fmt(b.i,4)} A</b></span><span>|vo| <b>${fmt(b.v,5)} V</b></span><span class="muted">D = ${fmt(e.p.duty,5)} σταθερό · ανοικτός βρόχος</span>${sim.limited?'<span class="warn-text">⚠ όριο CPU: ο πραγματικός ρυθμός είναι μικρότερος</span>':''}`;
}
function simCompare(){
 const e=sim.engine,r=state.result;if(!e||!r||sim.invalid){$('#sim-compare').innerHTML='';return;}
 const L=e.last,m=r.metrics,c=r.config;
 if(!L){$('#sim-compare').innerHTML='<p class="muted">Η σύγκριση με την ανάλυση εμφανίζεται μετά την πρώτη ολοκληρωμένη περίοδο.</p>';return;}
 const h=e.history,prev=h.length>1?h[h.length-2]:null;
 const settled=prev&&Math.abs(L.vavg-prev.vavg)<1e-5*c.vo&&Math.abs(L.imax-prev.imax)<1e-4*Math.max(1e-3,L.imax);
 const pct=(a,b)=>Number.isFinite(a)&&Math.abs(b)>1e-12?`${fmt(100*(a/b-1),3)} %`:'—';
 const rows=[['⟨|vo|⟩',L.vavg,c.vo,'V'],['ΔVo,pp',L.vmax-L.vmin,m.Vripple_pp,'V'],[(state.topology==='flyback'?'im':'iL')+',max',L.imax,m.Ipeak,'A'],[(state.topology==='flyback'?'im':'iL')+',min',L.imin,m.Ivalley,'A'],['⟨'+(state.topology==='flyback'?'im':'iL')+'⟩',L.iavg,m.ILmean,'A']];
 $('#sim-compare').innerHTML=`<table><thead><tr><th>Τελευταία περίοδος</th><th>Προσομοίωση</th><th>Ανάλυση</th><th>Διαφορά</th></tr></thead><tbody>${rows.map(([n,a,b,u])=>`<tr><td>${n}</td><td>${si(a,u,5)}</td><td>${si(b,u,5)}</td><td>${Math.abs(b)<1e-12&&Math.abs(a)<1e-9*Math.max(1,c.vo)?'0':Math.abs(b)<1e-12?si(a-b,u,3):pct(a,b)}</td></tr>`).join('')}</tbody></table><p class="${settled?'good':'muted'}">${settled?'✓ Περιοδική μόνιμη κατάσταση: η προσομοίωση επιβεβαιώνει την ανάλυση (η ανάλυση υποθέτει μικρή κυμάτωση).':'Μεταβατική κατάσταση σε εξέλιξη· η σύγκριση έχει νόημα όταν σταθεροποιηθεί.'}</p>`;
}
function oscLegend(){
 const keys=['i','iS','iD','iC','v','g'];const fly=state.topology==='flyback';
 $('#osc-legend').innerHTML=keys.map(k=>`<label class="trace" style="--c:${TRACE[k].color}"><input type="checkbox" data-trace="${k}" ${sim.traces[k]?'checked':''}><i></i>${k==='i'&&fly?'im':k==='iD'&&fly?'iD = im/n':TRACE[k].name}</label>`).join('')+'<span class="muted">πάνω: ρεύματα (A) · κάτω: |vo| (V) · διακεκομμένη: ανάλυση</span>';
 $$('#osc-legend [data-trace]').forEach(x=>x.onchange=()=>{sim.traces[x.dataset.trace]=x.checked;drawScope();});
}
function drawScope(){
 const canvas=$('#osc-canvas');if(!canvas)return;const holder=canvas.parentElement;const w=holder.clientWidth,h=holder.clientHeight;if(!w||!h)return;
 const ratio=devicePixelRatio||1;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
 const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);ctx.font='10px Inter, Segoe UI, Arial';
 const e=sim.engine;
 if(!e){ctx.fillStyle='#6d7c7f';ctx.textAlign='center';ctx.fillText('Η προσομοίωση ξεκινά μετά τον πρώτο υπολογισμό.',w/2,h/2);return;}
 const pad={l:52,r:10,t:8,b:22},gap=16,pw=w-pad.l-pad.r,h1=(h-pad.t-pad.b-gap)*.58,h2=(h-pad.t-pad.b-gap)-h1;
 const top={y:pad.t,h:h1},bot={y:pad.t+h1+gap,h:h2};
 const winSel=$('#sim-window').value,T=e.T,key=e.p.topology,fly=key==='flyback',n=e.p.n;
 const columns=Math.max(10,Math.floor(pw));
 const cur=['i','iS','iD','iC'].filter(k=>sim.traces[k]);
 const buckets={};for(const k of [...cur,'v','g'])buckets[k]={first:new Float64Array(columns).fill(NaN),min:new Float64Array(columns).fill(Infinity),max:new Float64Array(columns).fill(-Infinity),last:new Float64Array(columns).fill(NaN)};
 let t0,t1,envelope=false;
 if(winSel==='all'){envelope=true;t0=0;t1=Math.max(e.t,T);}
 else{const W=Number(winSel)*T;t1=Math.max(e.t,W);t0=t1-W;}
 const put=(k,col,val)=>{const b=buckets[k];if(Number.isNaN(b.first[col]))b.first[col]=val;if(val<b.min[col])b.min[col]=val;if(val>b.max[col])b.max[col]=val;b.last[col]=val;};
 const colOf=t=>Math.min(columns-1,Math.max(0,Math.floor((t-t0)/(t1-t0)*columns)));
 if(envelope){
  for(const row of e.history){const col=colOf(row.t);put('v',col,row.vmin);put('v',col,row.vmax);if(buckets.i){put('i',col,row.imin);put('i',col,row.imax);}}
 }else{
  const expected=(t1-t0)/e.h,stride=Math.max(1,Math.ceil(expected/250000));let count=0;
  e.each(t0,t1,(t,i,v,g)=>{
   if(stride>1&&(count++%stride))return;
   const col=colOf(t),iS=g===1?i:0,iD=g===2?(fly?i/n:i):0,io=e.iload(v),iC=(key==='buck'?i:iD)-io;
   if(buckets.i)put('i',col,i);if(buckets.iS)put('iS',col,iS);if(buckets.iD)put('iD',col,iD);if(buckets.iC)put('iC',col,iC);put('v',col,v);put('g',col,g===1?1:0);
  });
 }
 const range=(keys,withZero)=>{let lo=Infinity,hi=-Infinity;for(const k of keys){const b=buckets[k];if(!b)continue;for(let j=0;j<columns;j++){if(b.min[j]<lo)lo=b.min[j];if(b.max[j]>hi)hi=b.max[j];}}if(!Number.isFinite(lo))return null;if(withZero){lo=Math.min(lo,0);hi=Math.max(hi,0);}let span=hi-lo;if(span<1e-9)span=Math.max(Math.abs(hi)*.02,1e-3);return [lo-span*.08,hi+span*.08];};
 const ref=state.result&&!state.dirty?state.result:null;
 const rc=range(cur,true),rv0=range(['v'],false);let rv=rv0;
 if(rv&&ref){const vo=ref.config.vo;if(vo>rv[0]-(rv[1]-rv[0])&&vo<rv[1]+(rv[1]-rv[0])){rv=[Math.min(rv[0],vo),Math.max(rv[1],vo)];const s=rv[1]-rv[0];rv=[rv[0]-s*.05,rv[1]+s*.05];}}
 const xpx=j=>pad.l+(j+.5)*pw/columns;
 const pane=(p,r,label)=>{
  ctx.fillStyle='#fbfcfa';ctx.fillRect(pad.l,p.y,pw,p.h);ctx.strokeStyle='#e3e9e3';ctx.lineWidth=1;ctx.strokeRect(pad.l+.5,p.y+.5,pw-1,p.h-1);
  if(!r)return null;const py=v=>p.y+(r[1]-v)/(r[1]-r[0])*p.h;
  ctx.fillStyle='#87938d';ctx.textAlign='right';
  for(let j=0;j<=3;j++){const v=r[0]+(r[1]-r[0])*j/3,y=py(v);ctx.strokeStyle='#edf1ec';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+pw,y);ctx.stroke();ctx.fillText(eng(v),pad.l-6,y+3);}
  if(r[0]<0&&r[1]>0){ctx.strokeStyle='#c6d4cb';ctx.beginPath();ctx.moveTo(pad.l,py(0));ctx.lineTo(pad.l+pw,py(0));ctx.stroke();}
  ctx.save();ctx.translate(11,p.y+p.h/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillStyle='#6d7c7f';ctx.fillText(label,0,0);ctx.restore();
  return py;
 };
 const draw=(k,py,color,width=1.6)=>{
  const b=buckets[k];if(!b||!py)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let started=false;
  for(let j=0;j<columns;j++){if(Number.isNaN(b.first[j]))continue;const x=xpx(j);if(!started){ctx.moveTo(x,py(b.first[j]));started=true;}else ctx.lineTo(x,py(b.first[j]));ctx.lineTo(x,py(b.min[j]));ctx.lineTo(x,py(b.max[j]));ctx.lineTo(x,py(b.last[j]));}
  ctx.stroke();
 };
 if(e.t===0){pane(top,null,'A');pane(bot,null,'V');ctx.fillStyle='#6d7c7f';ctx.textAlign='center';ctx.font='12px Inter, Segoe UI, Arial';ctx.fillText('▶ Προσομοίωση ή Space: οι κυματομορφές εμφανίζονται εδώ',pad.l+pw/2,top.y+top.h/2);ctx.font='10px Inter, Segoe UI, Arial';ctx.fillText($('#sim-start').value==='zero'?'Αρχή από iL = 0, vo = 0 (εκκίνηση χωρίς ρυθμιστή)':'Αρχή από το αναλυτικό σημείο λειτουργίας',pad.l+pw/2,top.y+top.h/2+20);return;}
 const pyI=pane(top,rc,'A'),pyV=pane(bot,rv,'V');
 ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,h-pad.t-pad.b);ctx.clip();
 if(sim.traces.g&&!envelope&&pyI){
  // Gate band: a column is shaded if S was ON in it; empty columns (fewer
  // samples than pixels in slow motion) inherit the last known gate state.
  const b=buckets.g;ctx.fillStyle='#c7812622';let g=0;
  for(let j=0;j<columns;j++){const has=!Number.isNaN(b.first[j]);const on=has?b.max[j]>0:g>0;if(has)g=b.last[j];if(on){const x0=pad.l+j*pw/columns;ctx.fillRect(x0,top.y,pw/columns+.6,top.h);}}
 }
 if(ref&&pyI&&!envelope&&sim.traces.i){ctx.setLineDash([4,4]);ctx.strokeStyle='#14796699';ctx.lineWidth=1;for(const v of [ref.metrics.Ipeak,ref.metrics.Ivalley]){ctx.beginPath();ctx.moveTo(pad.l,pyI(v));ctx.lineTo(pad.l+pw,pyI(v));ctx.stroke();}ctx.setLineDash([]);}
 if(ref&&pyV){ctx.setLineDash([5,4]);ctx.strokeStyle='#2f5fa088';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,pyV(ref.config.vo));ctx.lineTo(pad.l+pw,pyV(ref.config.vo));ctx.stroke();ctx.setLineDash([]);}
 for(const k of ['iC','iS','iD','i'])if(sim.traces[k])draw(k,pyI,TRACE[k].color,k==='i'?1.9:1.4);
 draw('v',pyV,TRACE.v.color,1.8);
 ctx.restore();
 // time axis
 ctx.fillStyle='#87938d';ctx.textAlign='center';const span=t1-t0,unit=t1>=1e-3?['ms',1e3]:['μs',1e6];
 // Enough decimals that neighbouring ticks differ, without thousands grouping.
 const decimals=Math.min(6,Math.max(0,Math.ceil(-Math.log10(span*unit[1]/5))+1));
 for(let j=0;j<=5;j++){const t=t0+span*j/5;ctx.textAlign=j===0?'left':j===5?'right':'center';ctx.fillText((t*unit[1]).toLocaleString('el-GR',{minimumFractionDigits:decimals,maximumFractionDigits:decimals,useGrouping:false}),pad.l+pw*j/5,h-6);}
 ctx.textAlign='right';ctx.fillText('t ('+unit[0]+')'+(envelope?' · περιβάλλουσα ανά περίοδο':''),pad.l+pw,bot.y-4);
}

// ---------- charts (results tabs) ----------
function metric(label,value,unit,detail='',accent=false){return `<div class="metric ${accent?'accent':''}"><small>${label}</small><strong>${value} <span>${unit}</span></strong><p>${detail}</p></div>`;}
function table(rows,head='Μέγεθος'){return `<table class="table"><thead><tr><th>${head}</th><th>ΤΙΜΗ</th></tr></thead><tbody>${rows.map(([a,b])=>`<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>`;}
function mathView(m){return `<div class="math">${m.mathml}</div>`;}
function detailedStep(s){return `<article class="step"><h3>${esc(s.title)}</h3><p>${esc(s.explanation)}</p>${mathView(s.math)}${s.numeric?'<div class="eyebrow">ΑΡΙΘΜΗΤΙΚΗ ΑΝΤΙΚΑΤΑΣΤΑΣΗ</div>'+mathView(s.numeric):''}${s.result?'<div class="numeric-result">'+mathView(s.result)+'</div>':''}</article>`;}
function plotBox(id,tall=false){return `<div id="${id}" class="plot ${tall?'tall':''}"><canvas aria-label="Διάγραμμα ${id}" role="img"></canvas></div>`;}
function legend(series){return `<div class="legend">${series.map((s,i)=>`<span><i style="background:${s.color||colors[i]}"></i>${s.name}</span>`).join('')}</div>`;}
function warnings(){return state.result.warnings.map(t=>`<div class="note warning">${esc(t)}</div>`).join('');}
function clearCharts(){state.charts.forEach(c=>c.destroy());state.charts=[];}
function plot(id,x,series,options={}){const holder=$('#'+id);if(!holder)return;const chart=new Chart(holder,x,series,options);state.charts.push(chart);return chart;}
class Chart{
 constructor(holder,x,series,options){
  this.holder=holder;this.canvas=holder.querySelector('canvas');this.x=x;this.series=series;this.options=options;this.zoom=1;
  this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(holder);
  this.move=e=>this.hover(e);this.leave=()=>$('#tooltip').hidden=true;
  this.canvas.addEventListener('mousemove',this.move);this.canvas.addEventListener('mouseleave',this.leave);this.draw();
 }
 destroy(){this.observer.disconnect();this.canvas.removeEventListener('mousemove',this.move);this.canvas.removeEventListener('mouseleave',this.leave);$('#tooltip').hidden=true;}
 draw(){
  const w=this.holder.clientWidth,h=this.holder.clientHeight;if(!w)return;
  const ratio=window.devicePixelRatio||1;this.canvas.width=w*ratio;this.canvas.height=h*ratio;
  const ctx=this.canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const pad={l:56,r:17,t:17,b:37};const pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  const x0=this.x[0],x1=x0+(this.x.at(-1)-x0)/this.zoom;
  let lo=Infinity,hi=-Infinity;
  for(const s of this.series)for(let j=0;j<this.x.length&&this.x[j]<=x1+1e-10;j++){if(Number.isFinite(s.y[j])){lo=Math.min(lo,s.y[j]);hi=Math.max(hi,s.y[j]);}}
  if(!Number.isFinite(lo)||!Number.isFinite(hi))return;
  if(this.options.zero){lo=Math.min(lo,0);hi=Math.max(hi,0);}
  let span=hi-lo;if(span<1e-10)span=Math.max(Math.abs(hi)*.1,.1);lo-=span*.12;hi+=span*.12;
  const transform=this.options.log?Math.log10:x=>x;
  const tx0=transform(x0),tx1=transform(x1);
  const px=v=>pad.l+(transform(v)-tx0)/(tx1-tx0||1)*pw;
  const py=v=>pad.t+(hi-v)/(hi-lo)*ph;
  this.dim={pad,pw,ph,w,h,x0,x1,px,py};
  if(this.options.modes){for(let j=0;j<this.x.length-1;j++){const mode=this.options.modes[j];if(!mode)continue;ctx.fillStyle=({CCM:'#14796610',DCM:'#4d79ac12',BCM:'#c7812630'})[mode];ctx.fillRect(px(this.x[j]),pad.t,px(this.x[j+1])-px(this.x[j]),ph);}}
  ctx.font='10px Inter, Segoe UI, Arial';ctx.lineWidth=1;
  for(let j=0;j<=4;j++){const y=pad.t+j*ph/4,value=hi-(hi-lo)*j/4;ctx.strokeStyle='#e8ede7';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillStyle='#87938d';ctx.textAlign='right';ctx.fillText(eng(value),pad.l-9,y+3);}
  for(let j=0;j<=5;j++){const value=this.options.log?10**(tx0+(tx1-tx0)*j/5):x0+(x1-x0)*j/5;const x=pad.l+pw*j/5;ctx.fillStyle='#87938d';ctx.textAlign='center';ctx.fillText(eng(value),x,h-17);}
  ctx.textAlign='left';ctx.fillStyle='#6d7c7f';ctx.fillText(this.options.yLabel||'A',3,10);ctx.textAlign='right';ctx.fillText(this.options.xLabel||'t (μs)',w-pad.r,h-2);
  if(lo<0&&hi>0){ctx.strokeStyle='#c6d4cb';ctx.beginPath();ctx.moveTo(pad.l,py(0));ctx.lineTo(w-pad.r,py(0));ctx.stroke();}
  ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,ph);ctx.clip();
  this.series.forEach((s,i)=>{ctx.strokeStyle=s.color||colors[i];ctx.lineWidth=s.width||2;ctx.setLineDash(s.dashed?[5,4]:[]);ctx.beginPath();let started=false;for(let j=0;j<this.x.length;j++){if(!Number.isFinite(s.y[j])){started=false;continue;}const x=px(this.x[j]),y=py(s.y[j]);if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y);}ctx.stroke();});
  if(Number.isFinite(this.options.marker)&&this.options.marker>=x0&&this.options.marker<=x1){ctx.setLineDash([4,4]);ctx.strokeStyle='#b96d27';ctx.beginPath();ctx.moveTo(px(this.options.marker),pad.t);ctx.lineTo(px(this.options.marker),pad.t+ph);ctx.stroke();}
  ctx.restore();
 }
 hover(e){
  if(!this.dim)return;const rect=this.canvas.getBoundingClientRect(),d=this.dim,p=e.clientX-rect.left;
  if(p<d.pad.l||p>d.w-d.pad.r)return this.leave();
  const frac=(p-d.pad.l)/d.pw;const x=this.options.log?10**(Math.log10(d.x0)+frac*(Math.log10(d.x1)-Math.log10(d.x0))):d.x0+frac*(d.x1-d.x0);
  let j=0;while(j<this.x.length-1&&this.x[j]<x)j++;
  const t=$('#tooltip');t.textContent=`${this.options.xLabel||'t (μs)'}: ${fmt(this.x[j],5)}\n`+this.series.map(s=>`${s.name}: ${fmt(s.y[j],5)}`).join('\n');
  t.hidden=false;t.style.left=Math.min(e.clientX+13,window.innerWidth-210)+'px';t.style.top=Math.min(e.clientY+12,window.innerHeight-120)+'px';
 }
}

function drawHeatmap(data,metric,defs){
 const aa=data.axes,rows=aa[1].points,cols=aa[0].points;
 const sx=defs[aa[0].field][2],sy=defs[aa[1].field][2];
 const scale=['C_required','Lcrit'].includes(metric)?1e6:1;
 const values=data.points.map(p=>p[metric]*scale).filter(Number.isFinite);
 const lo=Math.min(...values),hi=Math.max(...values);
 const pw=660,ph=300,l=75,t=20,cw=pw/cols,ch=ph/rows;
 const lookup=new Map(data.points.map((p,i)=>[`${p.x}|${p.y}`,{p,i}]));
 const cells=[];
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
  const x=aa[0].min+(aa[0].max-aa[0].min)*i/(cols-1),y=aa[1].min+(aa[1].max-aa[1].min)*j/(rows-1);
  let found=lookup.get(`${x}|${y}`);
  if(!found)found=[...lookup.values()].find(item=>Math.abs(item.p.x-x)<=1e-9*Math.max(1,x)&&Math.abs(item.p.y-y)<=1e-9*Math.max(1,y));
  const p=found?.p;
  const color=!p?'#eedada':metric==='mode'?({CCM:'#72b196',BCM:'#d8bc67',DCM:'#b9ccd9'}[p.mode]):`hsl(${155-50*(p[metric]*scale-lo)/(hi-lo||1)} 34% ${91-53*(p[metric]*scale-lo)/(hi-lo||1)}%)`;
  const title=`${defs[aa[0].field][0]}=${fmt(x*sx)} · ${defs[aa[1].field][0]}=${fmt(y*sy)}\n`+(p?`${p.mode} · Vo=${fmt(p.vo)} V · D=${fmt(p.duty)} · ΔV=${fmt(p.ripple*1000)} mV · Creq=${fmt(p.C_required*1e6)} μF`:'Μη αποδεκτός συνδυασμός');
  cells.push(`<rect x="${l+i*cw}" y="${t+(rows-1-j)*ch}" width="${cw+.3}" height="${ch+.3}" fill="${color}" stroke="white" stroke-width=".6" data-point="${found?found.i:-1}" tabindex="0" role="button" aria-label="${esc(title)}"><title>${esc(title)}</title></rect>`);
 }
 let ticks='';for(let i=0;i<=4;i++){ticks+=`<text x="${l+i*pw/4}" y="343" text-anchor="middle">${fmt((aa[0].min+(aa[0].max-aa[0].min)*i/4)*sx)}</text>`;ticks+=`<text x="65" y="${t+ph-i*ph/4+4}" text-anchor="end">${fmt((aa[1].min+(aa[1].max-aa[1].min)*i/4)*sy)}</text>`;}
 $('#sweep-chart').innerHTML=`<div class="heatmap"><svg viewBox="0 0 800 390" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Πλέγμα custom συνδυασμών"><g font-size="11" fill="#6d7c7f">${cells.join('')}${ticks}<text x="405" y="375" text-anchor="middle">${esc(defs[aa[0].field][0])} (${esc(defs[aa[0].field][1])})</text><text transform="translate(20 170) rotate(-90)" text-anchor="middle">${esc(defs[aa[1].field][0])} (${esc(defs[aa[1].field][1])})</text></g></svg></div><div class="legend">${metric==='mode'?'<span><i style="background:#72b196"></i>CCM</span><span><i style="background:#d8bc67"></i>BCM</span><span><i style="background:#b9ccd9"></i>DCM</span>':`<span>${fmt(lo)} → ${fmt(hi)} · ${esc(metric)}</span>`}<span><i style="background:#eedada"></i>Μη αποδεκτό</span><span>Επίλεξε κελί για λεπτομέρειες.</span></div>`;
 const select=el=>{
  const i=Number(el.dataset.point);if(i<0){$('#selected-point').innerHTML='<div class="note warning">Ο συνδυασμός δεν δίνει αποδεκτή λύση με το επιλεγμένο μοντέλο.</div>';return;}
  const p=data.points[i];$('#selected-point').innerHTML=`<div class="output-box"><strong>Vin=${fmt(p.vin)} V · |Vo|=${fmt(p.vo)} V · ${p.mode}</strong><p>D=${fmt(p.duty)} · Po=${fmt(p.power)} W · Ipk=${fmt(p.Ipeak)} A · Creq=${fmt(p.C_required*1e6)} μF.</p><button id="apply-point" class="secondary">Άνοιγμα αυτού του σημείου στο κύκλωμα</button></div>`;
  $('#apply-point').onclick=async()=>{const c={...state.result.config,[aa[0].field]:p.x,[aa[1].field]:p.y};setValues(c,true);if(await calculate())await showTab('workspace');};
 };
 $$('#sweep-chart [data-point]').forEach(el=>{el.onclick=()=>select(el);el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();select(el);}};});
}

async function showTab(tab){
 if(state.dirty&&!await calculate())return;
 const token=++state.renderToken;const content=$('#content');
 // Keep the page steady and the user's open sections open across re-renders.
 $$('#content details[open]>summary').forEach(s=>state.openDetails.add(s.textContent.trim()));
 $$('#content details:not([open])>summary').forEach(s=>state.openDetails.delete(s.textContent.trim()));
 content.style.minHeight=content.offsetHeight+'px';
 state.tab=tab;clearCharts();$$('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 content.innerHTML='';
 try{await renderers[tab](token);}catch(e){notice(e.message,true);if(!content.innerHTML)content.innerHTML='<div class="empty">Η ανάλυση δεν ολοκληρώθηκε. Διόρθωσε τα δεδομένα και δοκίμασε ξανά.</div>';}
 if(token===state.renderToken){$$('#content details>summary').forEach(s=>{if(state.openDetails.has(s.textContent.trim()))s.parentElement.open=true;});requestAnimationFrame(()=>{content.style.minHeight='';});}
}
const alive=token=>token===state.renderToken;
const renderers={
 workspace(token){mountWorkspace(token);},
 waves(){
  const a=state.result,w=a.waveforms,m=a.metrics;
  const current=[{name:'iL / im',y:w.iL},{name:'iS',y:w.iS,color:colors[1]},{name:'iD',y:w.iD,color:colors[2]}];
  $('#content').innerHTML=`<div class="section-head"><div><h2>Αναλυτικές κυματομορφές μόνιμης κατάστασης</h2><p class="subtle">Δύο περίοδοι από το μοντέλο μικρής κυμάτωσης · άξονας χρόνου σε μs · το im flyback είναι αναγμένο στο πρωτεύον.</p></div><button class="secondary" id="csv">↓ CSV κυματομορφών</button></div>
   <section class="panel"><h2>Πηνίο, διακόπτης, δίοδος</h2>${plotBox('current-plot',true)}${legend(current)}<div class="range-controls"><label for="zoom">Μεγέθυνση χρόνου</label><input id="zoom" type="range" min="1" max="8" value="1" step=".1"></div></section>
   <div class="split-half"><section class="panel"><h2>Ρεύμα πυκνωτή · iC</h2>${plotBox('cap-current')}${table([['IC,rms',fmt(m.ICrms)+' A'],['Μέσο iC',eng(m.charge_balance_A)+' A']])}</section><section class="panel"><h2>Μέτρο τάσης εξόδου · |vo|</h2>${plotBox('cap-voltage')}${table([['ΔVo,pp',fmt(m.Vripple_pp*1000)+' mV'],['Δq,pp',fmt(m.charge_pp*1e6)+' μC']])}</section></div>
   <section class="panel"><h2>Σημείο λειτουργίας</h2>${table([['Πραγματική τάση Vo',fmt(m.signed_output)+' V'],['Ρεύμα εξόδου',fmt(m.Iout)+' A'],['Ισοδύναμη R στο σημείο',fmt(m.R)+' Ω'],['Μέσο ρεύμα εισόδου',fmt(m.Iin)+' A'],['RMS πηνίου / im',fmt(m.ILrms)+' A'],['Μέγιστη ιδανική τάση S',fmt(m.Vswitch)+' V'],['Ανάστροφη τάση διόδου',fmt(m.Vdiode_reverse)+' V']])}<details><summary>Παραδοχές του μοντέλου</summary><ul class="assumptions">${a.assumptions.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></details></section>`;
  const chart=plot('current-plot',w.t_us,current,{zero:true});$('#zoom').oninput=e=>{chart.zoom=Number(e.target.value);chart.draw();};
  plot('cap-current',w.t_us,[{name:'iC',y:w.iC}],{zero:true});plot('cap-voltage',w.t_us,[{name:'|vo|',y:w.vo}],{yLabel:'V'});
  $('#csv').onclick=()=>download('converter-waveforms.csv',Object.keys(w).join(',')+'\n'+w.t_us.map((_,i)=>Object.values(w).map(col=>col[i]).join(',')).join('\n'),'text/csv');
 },
 design(token){
  const c=state.result.config;const buck=c.topology==='buck',boost=c.topology==='boost';
  const low=buck?Math.max(c.vo*1.05,c.vin*.8):c.vin;
  const high=boost?Math.min(c.vo*.95,c.vin*1.5):Math.max(c.vin,24);
  $('#content').innerHTML=`<div id="design-boundary"></div><div id="design-problem"></div>
   <details class="panel workspace-fold" open><summary><b>Εύρος εισόδου και διαστασιολόγηση L, C</b> · δυσμενέστερο σημείο για σταθερά |Vo|, Po</summary><p class="subtle">Σταθερά |Vo|, Po, fs, n · μεταβαλλόμενη είσοδος. Υπολογισμός duty σε κάθε σημείο.</p>
   <div class="toolbar"><label>Vin,min (V)<input id="vin-min" type="number" value="${low}" step="any"></label><label>Vin,max (V)<input id="vin-max" type="number" value="${high}" step="any"></label><button id="run-envelope" class="primary">Ανάλυση εύρους ↗</button></div><div id="envelope-result"></div>
   <h3>Επιλογή ιδανικών L και C για όλο το εύρος</h3>
   <div class="toolbar"><label>Περιθώριο L/Lcrit,max<input id="ccm-margin" type="number" value="1.2" step=".1" min="1.001"></label><label>Μέγιστο ΔiL/Iavg<input id="ripple-ratio" type="number" value="0.4" step=".1"></label><label>Μέγιστο ΔVo,pp (V)<input id="voltage-ripple" type="number" value="0.1" step=".01"></label><button id="run-design" class="primary">Επιλογή L, C ↗</button></div><div id="design-result"></div></details>`;
  mountBoundary($('#design-boundary'));mountProblem($('#design-problem'));
  const range=()=>({...c,vin_min:Number($('#vin-min').value),vin_max:Number($('#vin-max').value)});
  $('#run-envelope').onclick=async()=>{try{
   const e=await api('envelope',range());if(!alive(token))return;state.envelope=e;
   $('#envelope-result').innerHTML=`<div class="info-grid">${metric('ΜΕΓΙΣΤΟ Lcrit',fmt(e.max_Lcrit*1e6),'μH')}${metric('ΔΥΣΜΕΝΕΣΤΕΡΗ ΕΙΣΟΔΟΣ',fmt(e.worst_vin),'V')}${metric('CCM ΣΕ ΟΛΟ ΤΟ ΕΥΡΟΣ',e.strict_ccm_everywhere?'Ναι':'Όχι','',`Τρέχον L = ${fmt(c.L*1e6)} μH`)}</div>
    ${plotBox('envelope-plot')}${legend([{name:'Lcrit (μH)'},{name:'επιλεγμένο L (μH)',color:colors[1]}])}
    <details><summary>Συμβολική συνάρτηση και έλεγχος ακροτάτων</summary>${mathView(e.critical_expression)}${mathView(e.derivative)}<p class="subtle">Υποψήφια Vin: ${e.extrema_candidates.map(v=>fmt(v)).join(', ')} V.</p></details><p class="scope">${esc(e.scope)}</p>`;
   plot('envelope-plot',e.points.map(p=>p.vin),[{name:'Lcrit',y:e.points.map(p=>p.Lcrit*1e6)},{name:'L',y:e.points.map(()=>c.L*1e6),dashed:true}],{xLabel:'Vin (V)',yLabel:'μH'});
  }catch(e){notice(e.message,true);}};
  $('#run-design').onclick=async()=>{try{
   const d=await api('design',{...range(),ccm_margin:Number($('#ccm-margin').value),current_ripple_ratio:Number($('#ripple-ratio').value),voltage_ripple:Number($('#voltage-ripple').value)});if(!alive(token))return;
   $('#design-result').innerHTML=`<div class="output-box"><small>ΠΡΟΤΕΙΝΟΜΕΝΑ ΙΔΑΝΙΚΑ ΣΤΟΙΧΕΙΑ</small><strong>L = ${fmt(d.L*1e6)} μH &nbsp; · &nbsp; C = ${fmt(d.C*1e6)} μF</strong><p class="subtle">Lcrit,max = ${fmt(d.max_Lcrit*1e6)} μH στα ${fmt(d.worst_Lcrit_vin)} V · δυσμενέστερη κυμάτωση στα ${fmt(d.worst_ripple_vin)} V.</p><button id="apply-design" class="secondary">Εφαρμογή τιμών στο κύκλωμα</button></div><p class="scope">${esc(d.scope)}</p>`;
   $('#apply-design').onclick=()=>applyParams({L:d.L,C:d.C},'workspace');
  }catch(e){notice(e.message,true);}};
  if(c.drive==='regulated')$('#run-envelope').click();else $('#envelope-result').innerHTML='<div class="note">Ο συμβολικός έλεγχος εδώ αφορά ρυθμιζόμενη έξοδο. Για εύρος με σταθερό duty χρησιμοποίησε τον «Παραμετρικό χάρτη».</div>';
 },
 custom(token){
  const c=state.result.config;
  const defs={vin:['Vin','V',1],vo:['|Vo|','V',1],power:['Po','W',1],fs:['fs','kHz',.001],n:['Ns/Np','',1],duty_set:['Duty','',1],resistance:['R','Ω',1],L:[c.topology==='flyback'?'Lm':'L','μH',1e6],C:['C','μF',1e6]};
  const allowed=(c.drive==='regulated'?['vin','vo','power','fs']:['vin','duty_set',c.load==='resistive'?'resistance':'power','fs']).concat(['L','C'],c.topology==='flyback'?['n']:[]);
  const options=field=>allowed.map(k=>`<option value="${k}" ${k===field?'selected':''}>${defs[k][0]} (${defs[k][1]||'λόγος'})</option>`).join('');
  const axis=(i,field)=>`<div class="axis-card"><div class="eyebrow">ΑΞΟΝΑΣ ${i===0?'X':'Y'}</div><div class="toolbar"><label>Μέγεθος<select id="axis-${i}">${options(field)}</select></label><label>Από<input id="axis-${i}-min" type="number" step="any"></label><label>Έως<input id="axis-${i}-max" type="number" step="any"></label></div></div>`;
  $('#content').innerHTML=`<section class="panel"><h2>Custom συνδυασμοί λειτουργίας</h2><p class="subtle">Διάλεξε τι μεταβάλλεται και τι παραμένει σταθερό. Κάθε σημείο του πλέγματος λύνεται ξανά, με αυτόματη επιλογή CCM / BCM / DCM.</p>
   <div class="note">${c.drive==='regulated'?'Ρυθμιζόμενη έξοδος: Vin και Vo μπορούν να μεταβάλλονται ανεξάρτητα ως απαιτήσεις λειτουργίας. Υπολογίζεται διαφορετικό duty για κάθε συνδυασμό.':'Σταθερό duty: η έξοδος προκύπτει από την είσοδο και τον νόμο φορτίου. Το Vo δεν μπορεί να οριστεί ταυτόχρονα ως ανεξάρτητος άξονας.'}</div>
   <div class="split-half">${axis(0,'vin')}${axis(1,c.drive==='regulated'?'vo':c.load==='resistive'?'resistance':'power')}</div>
   <div class="toolbar"><label>Διάσταση<select id="sweep-dimension"><option value="2">Δύο μεταβλητά μεγέθη</option><option value="1">Ένα μεταβλητό μέγεθος</option></select></label><label>Σημεία ανά άξονα<select id="sweep-count"><option>11</option><option selected>21</option><option>41</option></select></label><label>Στόχος ΔVo,pp (V)<input id="sweep-target" type="number" value="0.1" step="any"></label><button id="run-sweep" class="primary">Επίλυση συνδυασμών ↗</button></div>
   <div id="sweep-result"></div></section>
   <section class="panel"><h2>Πυκνωτής με ESR — κυμάτωση ή απαιτούμενο C</h2><p class="subtle">Για το τρέχον σημείο. Χωρίς ESR το ίδιο γίνεται και από το παράθυρο του πυκνωτή (διπλό κλικ στο C).</p>
   <div class="toolbar"><label>Ζητούμενο<select id="cap-task"><option value="size">C για όριο κυμάτωσης</option><option value="check">Κυμάτωση με το υπάρχον C</option></select></label><label>Στόχος ΔVo,pp (V)<input id="cap-target" type="number" step="any" value="0.1"></label><label>ESR (Ω) · προαιρετικό<input id="cap-esr" type="number" value="0" step="any" min="0"></label><button id="run-cap" class="primary">Υπολογισμός ↗</button></div><div id="cap-result"></div></section>`;
  const resetAxis=i=>{const key=$('#axis-'+i).value,scale=defs[key][2],value=c[key]*scale;$('#axis-'+i+'-min').value=Number((value*.8).toPrecision(6));$('#axis-'+i+'-max').value=Number((value*1.2).toPrecision(6));};
  for(const i of [0,1]){resetAxis(i);$('#axis-'+i).onchange=()=>resetAxis(i);}
  $('#sweep-dimension').onchange=e=>{$$('.axis-card')[1].hidden=e.target.value==='1';};
  $('#run-sweep').onclick=async()=>{try{
   const count=Number($('#sweep-count').value),dim=Number($('#sweep-dimension').value),aa=[];
   for(let i=0;i<dim;i++){const field=$('#axis-'+i).value,scale=defs[field][2];aa.push({field,min:Number($('#axis-'+i+'-min').value)/scale,max:Number($('#axis-'+i+'-max').value)/scale,points:count});}
   const d=await api('sweep',{...c,axes:aa,voltage_ripple:Number($('#sweep-target').value)});if(!alive(token))return;state.sweep=d;
   $('#sweep-result').innerHTML=`<div class="info-grid">${metric('ΕΓΚΥΡΟΙ ΣΥΝΔΥΑΣΜΟΙ',String(d.points.length),`/ ${count**dim}`,`${d.mode_counts.CCM} CCM · ${d.mode_counts.BCM} BCM · ${d.mode_counts.DCM} DCM`)}${metric('ΜΕΓΙΣΤΟ C ΓΙΑ ΤΟΝ ΣΤΟΧΟ',d.C_required_max===null?'—':fmt(d.C_required_max*1e6),'μF','Στα έγκυρα σημεία του πλέγματος')}${metric('ΜΕΓΙΣΤΗ ΤΡΕΧΟΥΣΑ ΚΥΜΑΤΩΣΗ',d.max_ripple===null?'—':fmt(d.max_ripple*1000),'mVpp',`Με C = ${fmt(c.C*1e6)} μF`)}</div>
    <div class="note">${esc(d.regime_diagnostics.explanation)}${d.regime_diagnostics.min_Lcrit!==null?`<br>Lcrit στο πλέγμα: <b>${fmt(d.regime_diagnostics.min_Lcrit*1e6)}–${fmt(d.regime_diagnostics.max_Lcrit*1e6)} μH</b> · L/Lcrit: <b>${fmt(d.regime_diagnostics.min_L_margin)}–${fmt(d.regime_diagnostics.max_L_margin)}</b>.`:''}<br>Τρέχουσα βάση: L${c.topology==='flyback'?'m':''}=${fmt(c.L*1e6)} μH · Po=${fmt(c.power)} W · fs=${fmt(c.fs/1000)} kHz${c.topology==='flyback'?` · n=Ns/Np=${fmt(c.n)}`:''}. Τα μεγέθη που δεν είναι άξονες μένουν σταθερά, εκτός από όσα προκύπτουν από τον νόμο οδήγησης/φορτίου.</div>
    ${d.transition_sweep?'<button id="transition-demo" class="secondary">Σάρωση L γύρω από το όριο CCM/DCM</button>':'<p class="scope">Για ελεύθερη σάρωση CCM/DCM με σταθερό duty επιλέξτε ωμικό φορτίο· το ιδανικό φορτίο σταθερής ισχύος μπορεί να μην προσδιορίζει μοναδικό Vo στη DCM.</p>'}
    ${d.invalid.length?`<div class="note warning">${d.invalid.length} συνδυασμοί δεν έχουν αποδεκτή λύση με το επιλεγμένο μοντέλο. Παράδειγμα: ${esc(d.invalid[0].reason)}</div>`:''}
    <div class="toolbar"><label>Τι δείχνει το διάγραμμα<select id="sweep-metric"><option value="mode">Περιοχή αγωγής</option><option value="vo">Τάση εξόδου |Vo| (V)</option><option value="duty">Duty cycle</option><option value="ripple">Κυμάτωση (Vpp)</option><option value="C_required">Απαιτούμενο C (μF)</option><option value="Ipeak">Ρεύμα κορυφής (A)</option><option value="Ivalley">Ελάχιστο ρεύμα (A)</option><option value="L_margin">L / Lcrit</option><option value="Lcrit">Lcrit (μH)</option></select></label><button id="sweep-csv" class="secondary">↓ CSV όλων των σημείων</button><button id="apply-sweep-cap" class="secondary" ${d.C_required_max===null||d.invalid.length?'disabled':''}>Εφαρμογή C για το πλέγμα</button></div>
    <div id="sweep-chart"></div><div id="selected-point"></div><p class="scope">${esc(d.scope)}</p>`;
   const draw=()=>{
    const metric=$('#sweep-metric').value;
    if(!d.points.length){$('#sweep-chart').innerHTML='<div class="empty">Δεν υπάρχουν έγκυρα σημεία σε αυτό το πλέγμα.</div>';return;}
    if(dim===1){clearCharts();$('#sweep-chart').innerHTML=plotBox('custom-curve',true);const scale=['C_required','Lcrit'].includes(metric)?1e6:1;
     plot('custom-curve',d.points.map(p=>p.x*defs[aa[0].field][2]),[{name:metric,y:d.points.map(p=>metric==='mode'?({DCM:0,BCM:1,CCM:2}[p.mode]):p[metric]*scale)}],{xLabel:defs[aa[0].field].join(' ').replace(' 1',''),yLabel:metric});
     if(metric==='mode')$('#sweep-chart').insertAdjacentHTML('beforeend','<p class="subtle">0 = DCM · 1 = BCM · 2 = CCM</p>');}
    else{clearCharts();drawHeatmap(d,metric,defs);}
   };$('#sweep-metric').onchange=draw;draw();
   if(d.transition_sweep)$('#transition-demo').onclick=()=>{const a=d.transition_sweep.axes[0];$('#axis-0').value='L';$('#axis-0-min').value=Number((a.min*1e6).toPrecision(12));$('#axis-0-max').value=Number((a.max*1e6).toPrecision(12));$('#sweep-count').value=String(a.points);$('#sweep-dimension').value='1';$('#sweep-dimension').dispatchEvent(new Event('change'));$('#run-sweep').click();};
   $('#sweep-csv').onclick=()=>{const keys=['x','y','vin','vo','power','mode','duty','L','C','Lcrit','L_margin','Ivalley','idle','ripple','Ipeak','Iout','C_required'];download('custom-operating-points.csv',keys.join(',')+'\n'+d.points.map(p=>keys.map(k=>p[k]).join(',')).join('\n'),'text/csv');};
   $('#apply-sweep-cap').onclick=()=>applyParams({C:d.C_required_max},'workspace');
  }catch(e){notice(e.message,true);}};
  $('#cap-task').onchange=e=>{$('#cap-target').readOnly=e.target.value==='check';};
  $('#run-cap').onclick=async()=>{try{
   const d=await api('capacitance',{...c,task:$('#cap-task').value,voltage_ripple:Number($('#cap-target').value),ESR:Number($('#cap-esr').value)});if(!alive(token))return;
   const size=$('#cap-task').value==='size';
   $('#cap-result').innerHTML=`<div class="output-box"><small>${size?'ΑΠΑΙΤΟΥΜΕΝΟ C':'ΚΥΜΑΤΩΣΗ ΜΕ ΤΟ ΥΠΑΡΧΟΝ C'}</small><strong>${size?fmt(d.C_required*1e6)+' μF':fmt(d.total_ripple_bound_existing*1000)+' mVpp'}</strong><p class="subtle">Χωρητική κυμάτωση: ${fmt(d.ripple_capacitive_existing*1000)} mV · συντηρητικό όριο ESR: ${fmt(d.esr_ripple_bound*1000)} mV.</p>${size?'<button id="apply-cap" class="secondary">Εφαρμογή C</button>':''}</div><p class="scope">${esc(d.scope)}</p>`;
   if(size)$('#apply-cap').onclick=()=>applyParams({C:d.C_required},'workspace');
  }catch(e){notice(e.message,true);}};
 },
 symbolic(token){
  const c=state.result.config,m=state.result.metrics;
  const fields=[['vin','Vin (V)',c.vin],['vo','|Vo| (V)',c.vo],['duty','D (0–1)',m.duty],['L','L (μH)',c.L*1e6],['fs','fs (kHz)',c.fs*.001],['power','Po (W)',c.power],['n','n = Ns/Np',c.n],['C','C (μF)',c.C*1e6],['voltage_ripple','ΔVo,pp (V)',m.Vripple_pp],['current_ripple','ΔiL,pp (A)',m.Iripple_pp],['charge_pp','Δq,pp (μC)',m.charge_pp*1e6],['Iout','Io (A)',m.Iout],['resistance','R (Ω)',m.R]];
  const relevant={gain:['vin','vo','duty',...(c.topology==='flyback'?['n']:[])],boundary_operating:['L','vin','vo','power','fs',...(c.topology==='flyback'?['n']:[])],boundary:['L','vo','power','duty','fs',...(c.topology==='flyback'?['n']:[])],dcm_energy:['vin','duty','L','fs','power'],charge_ripple:['C','voltage_ripple','charge_pp'],current_ripple:['vin','duty','L','fs','current_ripple',...(c.topology==='buck'?['vo']:[])],current_ripple_ccm:['vin','vo','L','fs','current_ripple',...(c.topology==='flyback'?['n']:[])],output_power:['power','vo','Iout'],load_resistance:['resistance','vo','power']};
  $('#content').innerHTML=`<section class="panel"><h2>Η ίδια εξίσωση, διαφορετικό ζητούμενο</h2><p class="subtle">Διάλεξε σχέση και άγνωστο. Κενά πεδία παραμένουν συμβολικές παράμετροι. Οι μονάδες μετατρέπονται σε SI πριν από τη λύση.</p>
   <div class="toolbar"><label>Σχέση<select id="relation"><option value="gain">Κέρδος τάσης · CCM/BCM</option><option value="boundary_operating">Οριακή αγωγή · από Vin, Vo</option><option value="boundary">Οριακή αγωγή · από D</option>${['buck_boost','flyback'].includes(c.topology)?'<option value="dcm_energy">Ισχύς DCM · πλήρης εκφόρτιση</option>':''}<option value="charge_ripple">Πυκνωτής · ΔV = Δq/C</option><option value="current_ripple_ccm">Κυμάτωση CCM · από Vin, Vo</option><option value="current_ripple">Κυμάτωση ρεύματος · από D</option><option value="output_power">Ισχύς εξόδου · Po = Vo·Io</option><option value="load_resistance">Φορτίο · R = Vo²/Po</option></select></label><label>Ζητούμενο<select id="unknown"></select></label></div>
   <div class="symbolic-grid">${fields.map(([k,label,v])=>`<label>${label}<input data-symbol="${k}" type="number" value="${plain(v)}" step="any" placeholder="Συμβολική παράμετρος"></label>`).join('')}</div>
   <div class="toolbar"><button id="run-symbolic" class="primary">Συμβολική επίλυση ↗</button></div><div id="symbolic-result"></div>
   <div class="note">Ο λύτης χρησιμοποιεί εγκεκριμένες φυσικές σχέσεις. Δεν εκτελεί κώδικα ή εκφράσεις που πληκτρολογεί ο χρήστης. Το κέρδος CCM δεν αρκεί για επιβεβαίωση της αγωγής· έλεγξε και το Lcrit.</div></section>`;
  const select=()=>{$$('[data-symbol]').forEach(input=>{input.disabled=input.dataset.symbol===$('#unknown').value;input.parentElement.hidden=!relevant[$('#relation').value].includes(input.dataset.symbol);});};
  const relation=()=>{const keep=$('#unknown').value;$('#unknown').innerHTML=fields.filter(([k])=>relevant[$('#relation').value].includes(k)).map(([k,label])=>`<option value="${k}">${label}</option>`).join('');const valid=relevant[$('#relation').value];$('#unknown').value=valid.includes(keep)?keep:$('#relation').value==='gain'?'duty':valid[0];select();};
  $('#unknown').onchange=select;$('#relation').onchange=relation;relation();
  $('#run-symbolic').onclick=async()=>{try{
   const known={};$$('[data-symbol]').filter(i=>!i.disabled&&!i.parentElement.hidden&&i.value.trim()!=='').forEach(i=>{const k=i.dataset.symbol;known[k]=Number(i.value)*(['L','C','charge_pp'].includes(k)?1e-6:k==='fs'?1000:1);});
   const d=await api('inverse',{topology:c.topology,relation:$('#relation').value,unknown:$('#unknown').value,known});if(!alive(token))return;
   let content=mathView(d.equation);
   if(d.status==='underdetermined')content+=`<div class="note">Λείπουν τιμές για ${d.missing.map(esc).join(', ')}. Η παραμετρική λύση είναι:</div>`+d.solutions.map(mathView).join('');
   else if(d.status==='solved')content+=d.solutions.map(s=>`<div class="output-box">${mathView(s.expression)}<strong>${esc(d.unknown)} = ${fmt(s.value,8)} <small>(SI)</small></strong><small>Αριθμητικό υπόλοιπο εξίσωσης: ${eng(s.residual)}</small></div>`).join('')+`<p class="scope">${esc(d.scope)}</p>`;
   else content+='<div class="note warning">Δεν βρέθηκε φυσικά αποδεκτή θετική λύση με 0&lt;D&lt;1.</div>';
   $('#symbolic-result').innerHTML=content;
  }catch(e){notice(e.message,true);}};
 },
 verify(token){
  const m=state.result.metrics;
  $('#content').innerHTML=`<section class="panel"><h2>Ανεξάρτητος έλεγχος στον χρόνο · Python / SciPy</h2><p class="subtle">Αριθμητική ολοκλήρωση των εξισώσεων ON/OFF με προσαρμοστικό βήμα και ανίχνευση μηδενισμού ρεύματος. Είναι δεύτερος, ανεξάρτητος έλεγχος από την προσομοίωση του κυκλώματος (που τρέχει στον browser με επιλεγμένο Δt).</p>
   <div class="toolbar"><label>Περίοδοι (10–1000)<input id="sim-cycles" type="number" value="300" min="10" max="1000"></label><label>Φορτίο μετά το μέσο · ×Po<input id="load-step" type="number" value="1" step=".1" min=".11" max="3"></label><button id="run-simulation" class="primary">Εκτέλεση ελέγχου ↗</button></div>
   <div class="note">Εκκίνηση κοντά στο αναλυτικό σημείο λειτουργίας. Με φορτίο ×1 εξετάζουμε τη συμφωνία μόνιμης κατάστασης· με άλλο συντελεστή βλέπουμε απόκριση σε αλλαγή φορτίου χωρίς ρυθμιστή.</div><div id="simulation-result"></div></section>
   <section class="panel"><h2>Αναλυτικά ισοζύγια</h2>${table([['Pin − Po',eng(m.power_balance_W)+' W'],['Μέσο iC',eng(m.charge_balance_A)+' A']])}<p class="scope">Τα ισοζύγια ελέγχουν την εσωτερική συνέπεια των τριγωνικών κυματομορφών.</p></section>`;
  $('#run-simulation').onclick=async()=>{try{
   const d=await api('switching',{...state.result.config,cycles:Number($('#sim-cycles').value),load_step:Number($('#load-step').value)});if(!alive(token))return;state.simulation=d;
   $('#simulation-result').innerHTML=`<div class="metrics switching-result">${metric('ΜΕΣΟ |Vo| · ΤΕΛΕΥΤΑΙΑ ΠΕΡΙΟΔΟΣ',fmt(d.average_vo),'V')}${metric('ΑΠΟΚΛΙΣΗ ΑΠΟ ΣΤΟΧΟ',fmt(d.target_error_percent),'%')}${metric('ΔVo,pp · ODE',fmt(d.ripple_pp*1000),'mV')}${metric('ΠΕΡΙΟΔΙΚΗ ΣΥΓΚΛΙΣΗ',d.settled?'Ναι':'Όχι','',`Υπόλοιπο = ${eng(d.periodic_residual)}`)}</div>
   ${!d.settled?'<div class="note warning">Δεν έχει επιβεβαιωθεί περιοδική μόνιμη κατάσταση. Αύξησε τις περιόδους ή εξέτασε την ευστάθεια του φορτίου.</div>':''}
   <h2>Εξέλιξη τάσης · τιμή στην αρχή κάθε περιόδου</h2>${plotBox('history-plot')}
   <div class="split-half"><div><h2>Τελευταίες τρεις περίοδοι · iL / im</h2>${plotBox('sim-il')}</div><div><h2>Τελευταίες τρεις περίοδοι · |vo|</h2>${plotBox('sim-vo')}</div></div><p class="scope">${esc(d.scope)}</p>`;
   plot('history-plot',d.history.map(x=>x.t_ms),[{name:'|vo|',y:d.history.map(x=>x.vo)}],{xLabel:'t (ms)',yLabel:'V'});
   plot('sim-il',d.waveforms.t_us,[{name:'iL / im',y:d.waveforms.iL}],{zero:true});
   plot('sim-vo',d.waveforms.t_us,[{name:'|vo|',y:d.waveforms.vo,color:colors[2]}],{yLabel:'V'});
  }catch(e){notice(e.message,true);}};
 }
};

function mountProblem(holder){
 const c=state.result.config;
 const defs={vin:['Vin','V',1],vo:['|Vo|','V',1],power:['Po','W',1],fs:['fs','kHz',.001],n:['Ns/Np','',1],duty_set:['D','',1],resistance:['R','Ω',1],L:[c.topology==='flyback'?'Lm':'L','μH',1e6]};
 const quantities={duty:'Duty',Iout:'Ρεύμα εξόδου',Ipeak:'Κορυφή ρεύματος',Ivalley:'Ελάχιστο ρεύμα',Lcrit:'Κρίσιμη επαγωγή',Vripple_pp:'Κυμάτωση Vo',Iripple_pp:'Κυμάτωση ρεύματος',ILmean:'Μέσο πηνίου',ILrms:'RMS πηνίου',ISrms:'RMS διακόπτη',IDrms:'RMS διόδου',ICrms:'RMS πυκνωτή',IDmean:'Μέσο διόδου',Vswitch:'Τάση διακόπτη',Vdiode_reverse:'Τάση διόδου'};
 holder.innerHTML=`<details class="panel goal-card"><summary><b>Ζητούμενο και συνθήκη</b> · min/max L σε εύρη, C από κυμάτωση, επιλεγμένα μεγέθη σημείου</summary><div class="section-head"><div><h2>Τι πρέπει να πετύχει το κύκλωμα;</h2><p class="subtle">Ορίζεις ζητούμενο, ανεξάρτητα εύρη και συνθήκη. Ο engine λύνει το αντίστοιχο πρόβλημα και δείχνει τις εξισώσεις που χρησιμοποίησε.</p></div></div>
  <div class="toolbar"><label>Ζητούμενο<select id="problem-target"><option value="L">Επαγωγή L / Lm</option><option value="C">Πυκνωτής C</option><option value="point">Μεγέθη σημείου λειτουργίας</option></select></label><label id="problem-goal-field">Συνθήκη<select id="problem-goal"><option value="ccm_all">Ελάχιστο όριο L για CCM παντού</option><option value="dcm_all">Μέγιστο όριο L για DCM παντού</option><option value="boundary_limits">Min / max Lcrit στο πεδίο</option><option value="boundary_all">Μπορεί ένα L να δίνει BCM παντού;</option></select></label><label id="problem-region-field">Πεδίο λειτουργίας<select id="problem-region"><option value="1">Ένα μεταβλητό μέγεθος</option><option value="2">Δύο ανεξάρτητα μεγέθη</option><option value="0">Ένα σημείο · τιμές του κυκλώματος</option></select></label></div>
  <div id="problem-output-choices" class="problem-choices" hidden>${Object.entries(quantities).map(([k,label],i)=>`<label><input type="checkbox" value="${k}" ${i<6?'checked':''}>${label}</label>`).join('')}</div>
  <div id="problem-axes" class="split-half">${[0,1].map(i=>`<div class="axis-card" id="problem-axis-card-${i}"><div class="eyebrow">ΜΕΤΑΒΛΗΤΟ ${i+1}</div><div class="toolbar"><label>Μέγεθος<select id="problem-axis-${i}"></select></label><label>Από<input id="problem-min-${i}" type="number" step="any"></label><label>Έως<input id="problem-max-${i}" type="number" step="any"></label></div></div>`).join('')}</div>
  <div class="toolbar"><label id="problem-margin-field">Συντελεστής περιθωρίου<input id="problem-margin" type="number" value="1.2" min="1.0001" step=".1"></label><label id="problem-ripple-field" hidden>Επιτρεπόμενο ΔVo,pp (V)<input id="problem-ripple" type="number" value="0.1" min=".000001" step="any"></label><label id="problem-count-field" hidden>Σημεία ανά άξονα · C<select id="problem-count"><option>11</option><option selected>21</option><option>41</option></select></label><button id="solve-problem" class="primary">Σύνθεση & αναλυτική λύση ↗</button></div>
  <div id="problem-roles" class="note"></div><div id="problem-result" class="problem-result"></div></details>`;
 const base=(c.drive==='regulated'?['vin','vo','power','fs']:['vin','duty_set',c.load==='resistive'?'resistance':'power','fs']).concat(c.topology==='flyback'?['n']:[]);
 function ranges(i){const key=$('#problem-axis-'+i).value;if(!defs[key])return;const value=c[key]*defs[key][2];$('#problem-min-'+i).value=Number((value*.8).toPrecision(8));$('#problem-max-'+i).value=Number((value*1.2).toPrecision(8));}
 function configureTarget(){
  const target=$('#problem-target').value,point=target==='point',capacitor=target==='C';
  const allowed=capacitor?base.concat(['L']):base;
  for(const i of [0,1]){const current=$('#problem-axis-'+i).value;$('#problem-axis-'+i).innerHTML=allowed.map(k=>`<option value="${k}">${defs[k][0]} (${defs[k][1]||'λόγος'})</option>`).join('');$('#problem-axis-'+i).value=allowed.includes(current)?current:allowed[i];ranges(i);}
  $('#problem-goal-field').hidden=target!=='L';$('#problem-region-field').hidden=point;$('#problem-output-choices').hidden=!point;$('#problem-ripple-field').hidden=!capacitor;$('#problem-count-field').hidden=!capacitor;
  $('#problem-margin-field').hidden=target!=='L'||!['ccm_all','dcm_all'].includes($('#problem-goal').value);
  const dim=point?0:Number($('#problem-region').value);$('#problem-axes').hidden=dim===0;$('#problem-axis-card-1').hidden=dim<2;
  $('#problem-roles').textContent=point?'Γνωστά: οι τιμές των στοιχείων του κυκλώματος και ο νόμος οδήγησης. Επίλεξε ποια αποτελέσματα θέλεις να εξαχθούν.':target==='L'?'Το υπάρχον L δεν επιβάλλεται ως γνωστό: είναι ζητούμενο. Όσα μεγέθη δεν ορίζονται ως άξονες κρατούν τις τιμές του κυκλώματος. Ο C δεν καθορίζει το ιδανικό όριο CCM/DCM.':'Το C είναι ζητούμενο. Το L και ο νόμος φορτίου επηρεάζουν την κυμάτωση και μένουν σταθερά, εκτός αν το L επιλεγεί ως άξονας. Σε εύρη ο υπολογισμός C αφορά το δηλωμένο πλέγμα.';
 }
 for(const i of [0,1])$('#problem-axis-'+i).onchange=()=>ranges(i);
 $('#problem-target').onchange=configureTarget;$('#problem-region').onchange=()=>{const dim=Number($('#problem-region').value);$('#problem-axes').hidden=dim===0;$('#problem-axis-card-1').hidden=dim<2;};
 $('#problem-goal').onchange=()=>{$('#problem-margin-field').hidden=!['ccm_all','dcm_all'].includes($('#problem-goal').value);};configureTarget();
 $('#solve-problem').onclick=async()=>{try{
  const target=$('#problem-target').value,dim=target==='point'?0:Number($('#problem-region').value),axes=[];
  for(let i=0;i<dim;i++){const field=$('#problem-axis-'+i).value,scale=defs[field][2];axes.push({field,min:Number($('#problem-min-'+i).value)/scale,max:Number($('#problem-max-'+i).value)/scale,points:Number($('#problem-count').value)});}
  const request={...c,target,goal:$('#problem-goal').value,axes,margin_factor:Number($('#problem-margin').value),voltage_ripple:Number($('#problem-ripple').value),outputs:$$('#problem-output-choices input:checked').map(i=>i.value)};
  const result=await api('problem',request);state.problem=result;renderProblemResult(result);
 }catch(e){notice(e.message,true);}};
 function renderProblemResult(p){
  const coordinates=point=>Object.entries(point.coordinates||{}).map(([k,v])=>`${defs[k]?.[0]||k}=${fmt(v*(defs[k]?.[2]||1),6)} ${defs[k]?.[1]||''}`).join(' · ')||'Βασικό σημείο';
  let html=`<h3>${esc(p.title)}</h3><div class="note ${p.feasible?'':'warning'}">${esc(p.explanation)}</div>`;
  if(p.target==='L'){
   html+=`<div class="info-grid">${metric('ΕΛΑΧΙΣΤΟ Lcrit',fmt(p.min.Lcrit*1e6,7),'μH',coordinates(p.min))}${metric('ΜΕΓΙΣΤΟ Lcrit',fmt(p.max.Lcrit*1e6,7),'μH',coordinates(p.max))}${metric('ΕΠΙΛΟΓΗ ΜΕ ΠΕΡΙΘΩΡΙΟ',p.selected_value===null?'—':fmt(p.selected_value*1e6,7),'μH',p.goal==='boundary_all'?(p.feasible?'BCM παντού':'Αδύνατο με ένα σταθερό L'):`Συντελεστής ${fmt(p.margin_factor)}`)}</div>${mathView(p.condition)}
    <h3>Υποψήφια ακρότατα που ελέγχθηκαν</h3>${table(p.candidates.map(x=>[`${esc(coordinates(x))}<br><small>${esc(x.kind)} · D=${fmt(x.duty)}</small>`,fmt(x.Lcrit*1e6,7)+' μH']))}`;
  }else if(p.target==='C')html+=`<div class="output-box"><small>ΕΛΑΧΙΣΤΟ C ΓΙΑ ΔVo,pp ≤ ${fmt(p.voltage_ripple)} V</small><strong>${fmt(p.selected_value*1e6,7)} μF</strong></div>`;
  else html+=table(p.outputs.map(o=>[esc(o.name),fmt(o.value*(o.unit==='H'?1e6:1),7)+' '+(o.unit==='H'?'μH':o.unit)]))+p.outputs.map(o=>`<h3>${esc(o.name)} · ${fmt(o.value*(o.unit==='H'?1e6:1),7)} ${o.unit==='H'?'μH':o.unit}</h3>${mathView(o.equation)}`).join('');
  if(Number.isFinite(p.selected_value))html+='<button id="apply-problem" class="secondary">Εφαρμογή τιμής στο κύκλωμα και νέος υπολογισμός</button>';
  html+=`<p class="scope">${esc(p.method)} ${esc(p.scope)}</p>${p.derivation?'<p class="scope">'+esc(p.derivation.units_note)+'</p>':''}<details class="workspace-fold" open><summary>Εξισώσεις και διαδρομή επίλυσης</summary><div class="steps">${p.steps.map(detailedStep).join('')}</div></details><button id="problem-json" class="secondary">↓ Πλήρης λύση JSON</button> <button id="problem-tex" class="secondary">↓ Εξισώσεις LaTeX</button>`;
  $('#problem-result').innerHTML=html;
  if(Number.isFinite(p.selected_value))$('#apply-problem').onclick=()=>{if(p.target==='C')state.rippleSpec={task:'size',value:p.voltage_ripple,unit:'V'};applyParams({[p.target]:p.selected_value},'workspace');};
  $('#problem-json').onclick=()=>download('converter-design-solution.json',JSON.stringify(p,null,2));$('#problem-tex').onclick=()=>download('converter-design-equations.tex',p.steps.map(s=>'% '+s.title+'\n'+[s.math,s.numeric,s.result].filter(Boolean).map(m=>'\\[\n'+m.latex+'\n\\]').join('\n')).join('\n\n'),'text/plain');
 }
}

function mountBoundary(holder){
 const labels={L:['L / Lm','μH',1e6],vin:['Vin','V',1],vo:['|Vo|','V',1],power:['Po','W',1],resistance:['R','Ω',1],fs:['fs','kHz',.001],n:['Ns/Np','',1]};
 holder.innerHTML=`<details class="panel boundary-card" open><summary><b>Σχεδίαση στο όριο BCM</b> · υπολόγισε L, Vo, Vin ή άλλο άγνωστο από τα γνωστά</summary><p class="subtle">Η απαίτηση είναι BCM, ακόμη κι αν τώρα λειτουργείς σε CCM ή DCM. Το D λύνεται εσωτερικά. Η τρέχουσα τιμή του επιλεγμένου αγνώστου αγνοείται.</p><div class="toolbar"><label>Άγνωστο<select id="boundary-unknown"></select></label><label>Το φορτίο ορίζεται από<select id="boundary-load"><option value="power">Ισχύ Po</option><option value="resistance">Αντίσταση R</option></select></label><label id="boundary-load-field">Τιμή φορτίου<input id="boundary-load-value" type="number" value="24" step="any"></label><button id="solve-boundary" class="primary">Βρες το όριο και απόδειξέ το ↗</button></div><p id="boundary-known" class="scope"></p><div id="boundary-result"></div></details>`;
 let oldLaw='power',boundaryTopology=state.topology,loadEdited=false,lastBoundaryInput=null;
 function choices(){const law=$('#boundary-load').value,previous=$('#boundary-unknown').value;const fields=['L','vin','vo','fs',...(state.topology==='flyback'?['n']:[]),law];$('#boundary-unknown').innerHTML=fields.map(k=>`<option value="${k}">${labels[k][0]}</option>`).join('');$('#boundary-unknown').value=fields.includes(previous)?previous:'L';}
 refreshBoundary=()=>{
  if(!$('#boundary-known'))return;
  if(boundaryTopology!==state.topology){choices();boundaryTopology=state.topology;}
  const law=$('#boundary-load').value,unknown=$('#boundary-unknown').value,c=getParams(),fields=['L','vin','vo','fs',...(state.topology==='flyback'?['n']:[]),law];
  if(!loadEdited)$('#boundary-load-value').value=plain(law==='power'?c.power:(c.drive==='fixed_duty'?c.resistance:state.result?.metrics.R||c.resistance));
  $('#boundary-load-field').hidden=unknown===law;
  if(!fields.includes(unknown))choices();
  const actualUnknown=$('#boundary-unknown').value;
  const knownValues=fields.filter(k=>k!==actualUnknown).map(k=>[k,k===law?Number($('#boundary-load-value').value):c[k]]);
  const known=knownValues.map(([k,value])=>`${labels[k][0]}=${fmt(value*labels[k][2],7)} ${labels[k][1]}`);
  $('#boundary-known').textContent='Γνωστά για τη νέα συνθήκη: '+known.join(' · ')+'. Το υπάρχον C και η προηγούμενη περιοχή αγωγής δεν περιορίζουν αυτή τη λύση.';
  const graph=editor?.export();
  const fingerprint=JSON.stringify({topology:state.topology,unknown:actualUnknown,law,known:knownValues,graph:graph?{components:graph.components.map(x=>({id:x.id,type:x.type})),wires:graph.wires}:null});
  if(lastBoundaryInput!==null&&lastBoundaryInput!==fingerprint){$('#boundary-result').classList.add('stale-result');$('#boundary-result').setAttribute('inert','');}
  return fingerprint;
 };
 $('#boundary-load').onchange=()=>{const law=$('#boundary-load').value;if(law!==oldLaw){loadEdited=false;$('#boundary-load-value').value=plain(law==='power'?getParams().power:(state.result?.metrics.R||getParams().resistance));oldLaw=law;}choices();refreshBoundary();};
 $('#boundary-unknown').onchange=refreshBoundary;$('#boundary-load-value').oninput=()=>{loadEdited=true;refreshBoundary();};
 choices();refreshBoundary();
 $('#solve-boundary').onclick=async()=>{try{
  const fingerprint=refreshBoundary(),law=$('#boundary-load').value,unknown=$('#boundary-unknown').value;
  const request={...getConfig(),boundary_load:law,unknown};if(unknown!==law)request[law]=Number($('#boundary-load-value').value);
  const b=await api('boundary',request);state.boundary=b;
  lastBoundaryInput=fingerprint;$('#boundary-result').classList.remove('stale-result');$('#boundary-result').removeAttribute('inert');
  const lab=labels[unknown];
  $('#boundary-result').innerHTML=`<div class="note ${b.status==='solved'?'':'warning'}">${esc(b.explanation)}</div>${b.solutions.map((p,i)=>`<div class="output-box"><small>ΛΥΣΗ ${i+1} · ΕΠΙΒΕΒΑΙΩΜΕΝΟ BCM</small><strong>${lab[0]} = ${fmt(p.value*lab[2],9)} ${lab[1]}</strong><p class="subtle">Νέο D=${fmt(p.duty,9)} · Imin=${fmt(p.Ivalley,7)} A · Ipk=${fmt(p.Ipeak,7)} A · Lcrit=${fmt(p.Lcrit*1e6,8)} μH.</p><button class="secondary" data-apply-boundary="${i}">Εφαρμογή αυτού του σημείου στο κύκλωμα</button></div>`).join('')}
   <details class="workspace-fold"><summary>Εξισώσεις, απαλοιφή D και επίλυση όλων των ριζών</summary>${b.steps.map(detailedStep).join('')}${b.closed_forms?.length?'<h3>Παραμετρικές εκφράσεις</h3>'+b.closed_forms.map(mathView).join(''):''}${b.rejected?.length?'<h3>Ρίζες που απορρίφθηκαν</h3>'+table(b.rejected.map(r=>[esc(r.reason),r.value===null?'—':fmt(r.value,9)])):''}</details><p class="scope">${esc(b.method||'')} ${esc(b.scope||'')}</p>`;
  $$('[data-apply-boundary]').forEach(button=>button.onclick=async()=>{const solution=b.solutions[Number(button.dataset.applyBoundary)];setValues(solution.config,true);if(await calculate())await showTab('workspace');});
 }catch(e){notice(e.message,true);}};
}

function mountWorkspace(token){
 const a=state.result,c=a.config,m=a.metrics,w=a.waveforms;
 $('#content').innerHTML=`<div class="metrics">${metric('ΤΑΣΗ ΕΞΟΔΟΥ',fmt(m.signed_output),'V',c.drive==='fixed_duty'?'Αποτέλεσμα για σταθερό D':'Ρυθμιζόμενη τιμή')}${metric('DUTY',fmt(m.duty),'',`tON ${fmt(m.duty/c.fs*1e6)} μs · δ = ${fmt(m.delta)}`,true)}${metric('Imin / Ipeak',fmt(m.Ivalley)+' / '+fmt(m.Ipeak),'A',`Lcrit = ${fmt(m.Lcrit*1e6)} μH · L/Lcrit = ${fmt(m.L_margin)}`)}${metric('ΚΥΜΑΤΩΣΗ ΤΑΣΗΣ',fmt(m.Vripple_pp*1000),'mVpp',`${fmt(100*m.Vripple_pp/c.vo)} % του |Vo| · Δq = ${fmt(m.charge_pp*1e6)} μC`)}</div>${warnings()}
  <section class="panel"><div class="section-head"><div><h2>Αναλυτικές κυματομορφές · ${a.mode}</h2><p class="subtle">Δύο περίοδοι μόνιμης κατάστασης από το μοντέλο. Η προσομοίωση πάνω δεξιά λύνει ανεξάρτητα τις ίδιες εξισώσεις στον χρόνο.</p></div><span class="tag">${esc(catalog.find(x=>x.key===c.topology)?.name||c.topology)} · ${a.mode}</span></div>
  <div class="live-grid"><div><h3>Ρεύματα · iL / im, iS, iD</h3>${plotBox('workspace-current')}${legend([{name:'iL / im'},{name:'iS',color:colors[1]},{name:'iD',color:colors[2]}])}</div><div><h3>Μέτρο τάσης εξόδου · |vo|</h3>${plotBox('workspace-voltage')}</div></div></section>
  <section class="panel quick-design"><h2>Κυμάτωση τάσης ↔ επιλογή πυκνωτή</h2><p class="subtle">Η κυμάτωση υπολογίζεται από τα ρεύματα του κυκλώματος: iC → q(t) → Δq → ΔV = Δq/C. Διάλεξε έλεγχο του υπάρχοντος C ή νέο C από μέγιστη επιτρεπόμενη κυμάτωση.</p><div class="toolbar"><label>Ζητούμενο<select id="quick-ripple-task"><option value="size">Βρες C για μέγιστη κυμάτωση</option><option value="current">Υπολόγισε την τρέχουσα κυμάτωση</option></select></label><label id="quick-ripple-limit-field">Μέγιστη κυμάτωση pp<input id="quick-ripple-limit" type="number" value="0.1" min=".000001" step="any"></label><label id="quick-ripple-unit-field">Μονάδα<select id="quick-ripple-unit"><option value="V">Vpp</option><option value="mV">mVpp</option><option value="percent">% του |Vo| (pp)</option></select></label><button id="quick-derive" class="primary">Υπολογισμός με εξισώσεις ↗</button></div><div id="quick-size-summary"></div><div id="live-explanation"></div></section>
  <details class="panel workspace-fold"><summary>Χαρακτηριστικές |Vo|/Vin–D και περιοχές λειτουργίας</summary><p class="subtle">Πραγματικός ιδανικός κλάδος αγωγής και αναφορά CCM, για το συγκεκριμένο L και φορτίο. Το duty εδώ είναι ανεξάρτητο.</p><div class="toolbar"><label>Καμπύλη<select id="curve-choice"><option value="gain">|Vo|/Vin ως προς D</option><option value="vo">|Vo| ως προς D</option><option value="Ipeak">Ipeak ως προς D</option><option value="Ivalley">Imin ως προς D</option><option value="ripple">ΔVo,pp ως προς D</option><option value="Lcrit">Lcrit ως προς D</option></select></label></div><div id="curves-result"></div></details>
  <details class="panel workspace-fold"><summary>Μαθηματικό μοντέλο και απόδειξη συνάρτησης μεταφοράς</summary><p class="subtle">KVL/KCL ανά διάστημα → μέσο μοντέλο → ισορροπία → γραμμικοποίηση → Laplace → Gvd/Gvg. Η περιοχή αγωγής επιλέγει το κατάλληλο μοντέλο.</p><div id="workspace-transfer-result"><div class="empty small">Υπολογισμός…</div></div></details>`;
 plot('workspace-current',w.t_us,[{name:'iL / im',y:w.iL},{name:'iS',y:w.iS,color:colors[1]},{name:'iD',y:w.iD,color:colors[2]}],{zero:true});
 plot('workspace-voltage',w.t_us,[{name:'|vo|',y:w.vo}],{yLabel:'V'});
 const spec=state.rippleSpec;
 $('#quick-ripple-task').value=spec.task;$('#quick-ripple-limit').value=spec.value;$('#quick-ripple-unit').value=spec.unit;
 let oldUnit=spec.unit;let explanationCharts=[];
 const unitScale=unit=>unit==='mV'?.001:unit==='percent'?c.vo/100:1;
 const showLimit=()=>{const current=$('#quick-ripple-task').value==='current';$('#quick-ripple-limit-field').hidden=current;$('#quick-ripple-unit-field').hidden=current;};showLimit();
 $('#quick-ripple-task').onchange=showLimit;
 $('#quick-ripple-unit').onchange=()=>{const unit=$('#quick-ripple-unit').value,volts=Number($('#quick-ripple-limit').value)*unitScale(oldUnit);$('#quick-ripple-limit').value=Number((volts/unitScale(unit)).toPrecision(10));oldUnit=unit;};
 $('#quick-derive').onclick=async()=>{try{
  const task=$('#quick-ripple-task').value,unit=$('#quick-ripple-unit').value,value=Number($('#quick-ripple-limit').value),target=value*unitScale(unit);
  state.rippleSpec={task,unit,value};const d=await api('derivation',{...c,voltage_ripple:target});if(!alive(token))return;state.derivation=d;
  const s=d.sizing;
  $('#quick-size-summary').innerHTML=`<div class="info-grid">${metric('ΥΠΑΡΧΟΝ C',fmt(s.C_existing*1e6,7),'μF')}${metric('ΤΡΕΧΟΥΣΑ ΔVo,pp',fmt(s.existing_ripple_Vpp*1000,7),'mVpp',`Δq=${fmt(d.charge_pp*1e6,7)} μC`)}${task==='size'?metric('ΑΠΑΙΤΟΥΜΕΝΟ Cmin',fmt(s.C_min*1e6,7),'μF',`Για ΔVo,pp ≤ ${fmt(s.target_mVpp,7)} mVpp`):metric('RMS ΠΥΚΝΩΤΗ',fmt(d.metrics.ICrms,7),'A')}</div>
   <div class="note">${task==='size'?(s.meets_target?'Το υπάρχον C ικανοποιεί τον στόχο.':'Το υπάρχον C δεν ικανοποιεί τον στόχο.'):'Η τρέχουσα κυμάτωση προκύπτει από ολοκλήρωση του iC.'} ΔVo,pp = Δqpp / C = ${fmt(d.charge_pp*1e6,7)} μC / ${fmt(s.C_existing*1e6,7)} μF = ${fmt(s.existing_ripple_Vpp,7)} V.${task==='size'?` Cmin = ${fmt(d.charge_pp*1e6,7)} μC / ${fmt(s.target_Vpp,7)} V = ${fmt(s.C_min*1e6,7)} μF.`:''}</div>
   ${task==='size'?'<button id="quick-apply-C" class="secondary">Εφαρμογή Cmin στο κύκλωμα</button>':''}`;
  const essential=[0,3,5,9].map(i=>d.current_steps[i]);
  const rsteps=task==='size'?d.ripple_steps:d.ripple_steps.slice(0,3);
  $('#live-explanation').innerHTML=`<details class="workspace-fold"><summary>Διαγράμματα iC και ολοκληρωμένου φορτίου q · μία περίοδος</summary><div class="live-grid"><div><h3>iC σε μία περίοδο</h3>${plotBox('live-cap-current')}</div><div><h3>q από την ολοκλήρωση iC · Δqpp=${fmt(d.charge_pp*1e6,7)} μC</h3>${plotBox('live-charge')}</div></div></details>
   <details class="workspace-fold"><summary>Βασικές εξισώσεις ρευμάτων με αριθμητική αντικατάσταση</summary>${essential.map(detailedStep).join('')}</details>
   <details class="workspace-fold"><summary>Όλα τα ρεύματα ανά διάστημα, μέσες τιμές και RMS</summary>${table(d.intervals.map(i=>[`${i.state} · ${fmt(i.start_us,7)}–${fmt(i.end_us,7)} μs`,`iC: ${fmt(i.iC_start,7)} → ${fmt(i.iC_end,7)} A`]))}${d.current_steps.map(detailedStep).join('')}</details>
   <details class="workspace-fold"><summary>Υπολογισμός τρέχουσας κυμάτωσης${task==='size'?' και επίλυση ως προς C':''}</summary>${rsteps.map(detailedStep).join('')}<h3>Σημεία που ελέγχθηκαν για ακρότατα φορτίου</h3>${table(d.charge_extrema.map(e=>[`t=${fmt(e.t_us,8)} μs · ${esc(e.kind)}`,fmt(e.q_uC,8)+' μC']))}</details><p class="scope">${esc(d.units_note)} ${esc(d.scope)}</p>`;
  explanationCharts.forEach(chart=>{chart.destroy();state.charts=state.charts.filter(x=>x!==chart);});
  const q=d.charge_waveform;explanationCharts=[plot('live-cap-current',q.t_us,[{name:'iC',y:q.iC_A,color:colors[1]}],{zero:true}),plot('live-charge',q.t_us,[{name:'q',y:q.q_uC}],{yLabel:'μC'})];
  $$('#live-explanation details>summary').forEach(s=>{if(state.openDetails.has(s.textContent.trim()))s.parentElement.open=true;});
  $$('#live-explanation details').forEach(el=>el.addEventListener('toggle',()=>{const q=el.querySelector('canvas');if(q)explanationCharts.forEach(ch=>ch.draw());}));
  if(task==='size')$('#quick-apply-C').onclick=()=>applyParams({C:s.C_min});
 }catch(e){notice(e.message,true);}};
 let curveChart=null,modelCharts=[];
 function drawCurves(){
  const data=state.curves;if(!data)return;
  if(curveChart){curveChart.destroy();state.charts=state.charts.filter(x=>x!==curveChart);}
  const key=$('#curve-choice').value,scale=key==='Lcrit'?1e6:key==='ripple'?1000:1;
  $('#curves-result').innerHTML=`${plotBox('workspace-characteristic',true)}<div id="curve-legend"></div><div class="note">Σύνορα L=Lcrit(D): ${data.boundary_duties.length?data.boundary_duties.map(d=>'D='+fmt(d,7)).join(' · '):'κανένα στο εξετασμένο εύρος duty'}. <span class="good">Πράσινο: CCM</span> · μπλε: DCM · κενό: μη προσδιορισμένη / μη αποδεκτή λύση.</div><p class="scope">${esc(data.scope)}</p><details><summary>Συμβολικές σχέσεις χαρακτηριστικής</summary><p class="subtle">CCM</p>${mathView(data.gain_ccm)}<p class="subtle">DCM με ωμικό φορτίο</p>${mathView(data.gain_dcm_resistive)}<p class="subtle">Όριο αγωγής για τα τρέχοντα δεδομένα</p>${mathView(data.boundary_equation)}</details>`;
  const series=[{name:key,y:data.points.map(p=>p[key]===null?null:p[key]*scale)}];
  if(key==='gain')series.push({name:'CCM αναφορά',y:data.points.map(p=>p.gain_ccm_reference),color:colors[1],dashed:true});
  if(key==='Lcrit')series.push({name:'υπάρχον L',y:data.points.map(()=>c.L*1e6),color:colors[1],dashed:true});
  $('#curve-legend').innerHTML=legend(series);curveChart=plot('workspace-characteristic',data.points.map(p=>p.duty),series,{xLabel:'D',yLabel:key==='Lcrit'?'μH':key==='ripple'?'mVpp':key==='gain'?'|Vo|/Vin':key==='vo'?'V':'A',zero:true,modes:data.points.map(p=>p.mode),marker:m.duty});
 }
 $('#curve-choice').onchange=drawCurves;
 $$('#content details.workspace-fold').forEach(el=>el.addEventListener('toggle',()=>{if(el.open){if(curveChart)curveChart.draw();modelCharts.forEach(ch=>ch.draw());}}));
 const loadCurves=async()=>{try{const d=await api('curves',c);if(!alive(token))return;state.curves=d;drawCurves();}catch(e){notice(e.message,true);}};
 const loadTransfer=async()=>{try{
  const proof=await api('model_proof',c);if(!alive(token))return;const d=proof.transfer;state.dynamic=d;state.modelProof=proof;
  modelCharts.forEach(chart=>{chart.destroy();state.charts=state.charts.filter(x=>x!==chart);});modelCharts=[];
  $('#workspace-transfer-result').innerHTML=(d.available?`<div class="note">${d.mode} · ${d.stable?'Ασυμπτωτικά ευσταθές μέσο μοντέλο':'Μη ασυμπτωτικά ευσταθές μέσο μοντέλο'} · έξοδος = μέτρο Vo.</div>${d.averaged_current?mathView(d.averaged_current):''}<h3>Gvd(s) · duty → έξοδος</h3>${mathView(d.Gvd)}<h3>Αριθμητική αντικατάσταση</h3>${mathView(d.Gvd_numeric)}<div class="live-grid"><div>${plotBox('workspace-bode-mag')}</div><div>${plotBox('workspace-bode-phase')}</div></div>${table(d.poles.map((p,i)=>['Πόλος '+(i+1),fmt(p.real,6)+(p.imag>=0?' + j':' − j')+fmt(Math.abs(p.imag),6)+' rad/s']))}`:'<div class="note warning">'+esc(d.reason)+'</div>')+`<details class="workspace-fold"><summary>Απόδειξη από το φυσικό μοντέλο μέχρι τη συνάρτηση μεταφοράς</summary>${proof.steps.map(detailedStep).join('')}</details><p class="scope">${esc(proof.method)} ${esc(proof.scope)}</p>`;
  if(d.available){modelCharts=[plot('workspace-bode-mag',d.bode.frequency,[{name:'Gvd · dB',y:d.bode.magnitude_db}],{log:true,xLabel:'f (Hz)',yLabel:'dB'}),plot('workspace-bode-phase',d.bode.frequency,[{name:'Gvd · deg',y:d.bode.phase_deg,color:colors[2]}],{log:true,xLabel:'f (Hz)',yLabel:'deg'})];}
  $$('#workspace-transfer-result details>summary').forEach(s=>{if(state.openDetails.has(s.textContent.trim()))s.parentElement.open=true;});
 }catch(e){notice(e.message,true);}};
 (async()=>{await $('#quick-derive').onclick();if(!alive(token))return;await loadCurves();if(!alive(token))return;await loadTransfer();})();
}

function drawCircuit(){if(editor){editor.render();}else $('#schematic').innerHTML='<div class="empty">Εκκίνηση editor κυκλώματος…</div>';}
function download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportReport(){
 if(state.dirty||!state.result){notice('Περίμενε να ολοκληρωθεί ο υπολογισμός με τα τρέχοντα δεδομένα.');return;}
 const a=state.result,m=a.metrics;
 const fields=Object.entries(a.config).map(([k,v])=>[esc(k),esc(v)]);
 const e=sim.engine,L=e?.last;
 const body=`<h1>Power Converter Lab · ${esc(catalog.find(x=>x.key===a.config.topology)?.name||a.config.topology)}</h1><p>Έκδοση ${esc(health.version)} · ${esc(a.mode)} · δεδομένα σε SI.</p>${table(fields,'ΔΕΔΟΜΕΝΑ')}
  <h2>Αποτελέσματα</h2>${table(Object.entries(m).map(([k,v])=>[esc(k),eng(v)]))}<h2>Παραδοχές</h2><ul>${a.assumptions.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul>
  <h2>Ρεύματα και κυμάτωση</h2>${state.derivation?(state.derivation.current_steps.concat(state.rippleSpec.task==='current'?state.derivation.ripple_steps.slice(0,3):state.derivation.ripple_steps)).map(detailedStep).join(''):a.steps.map(detailedStep).join('')}
  ${state.problem?'<h2>'+esc(state.problem.title)+'</h2><p>'+esc(state.problem.explanation)+'</p>'+state.problem.steps.map(s=>'<h3>'+esc(s.title)+'</h3><p>'+esc(s.explanation)+'</p>'+mathView(s.math)).join(''):''}
  ${state.dynamic?.available?'<h2>Μικρό σήμα</h2>'+mathView(state.dynamic.Gvd)+'<p>'+esc(state.dynamic.scope)+'</p>':''}
  ${state.modelProof?'<h2>Παραγωγή μαθηματικού μοντέλου και συνάρτησης μεταφοράς</h2>'+state.modelProof.steps.map(detailedStep).join(''):''}
  ${state.boundary&&!$('#boundary-result')?.classList.contains('stale-result')?'<h2>Αντίστροφη σχεδίαση BCM</h2><p>'+esc(state.boundary.explanation)+'</p>'+state.boundary.steps.map(detailedStep).join(''):''}
  ${L?`<h2>Προσομοίωση στον χρόνο (browser)</h2><p>t = ${si(e.t,'s',5)} · Δt = ${si(e.h,'s',4)} · τελευταία περίοδος: ⟨|vo|⟩ = ${fmt(L.vavg,6)} V, ΔVo,pp = ${fmt((L.vmax-L.vmin)*1000,5)} mV, iL ${fmt(L.imin,5)} → ${fmt(L.imax,5)} A.</p>`:''}
  ${state.simulation?'<h2>Ανεξάρτητη ODE (SciPy)</h2><p>Μέσο Vo='+fmt(state.simulation.average_vo)+' V · περιοδική σύγκλιση: '+(state.simulation.settled?'ναι':'όχι')+'.</p>':''}`;
 download('Power_Converter_Lab_solution.html','<!doctype html><html lang="el"><meta charset="utf-8"><title>Power Converter Lab · Λύση</title><style>body{font:15px Segoe UI,Arial;max-width:950px;margin:40px auto;padding:20px;color:#18353a}h1,h2{color:#147966}p,li{line-height:1.8}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.math{background:#f5f8f2;padding:20px;overflow-x:auto}h2{margin-top:35px}</style>'+body+'</html>','text/html');
}

function initSimulationUI(){
 oscLegend();
 $('#sim-play').onclick=()=>sim.running?simPause():simPlay();
 $('#sim-reset').onclick=()=>{simReset();};
 $('#sim-period').onclick=()=>{if(!sim.engine||sim.invalid)return;if(sim.running)simPause();sim.engine.run(sim.engine.T);drawScope();simLive(true);simReadout();simCompare();};
 $('#sim-speed').onchange=()=>{simNotes();if(!sim.running)simLive(true);};
 $('#sim-step').onchange=()=>{$('#sim-step-custom-field').hidden=$('#sim-step').value!=='custom';if(sim.engine)sim.engine.setStep(stepSeconds(sim.engine.p.fs));simNotes();};
 $('#sim-step-custom').oninput=()=>{if(sim.engine)sim.engine.setStep(stepSeconds(sim.engine.p.fs));simNotes();};
 $('#sim-start').onchange=()=>simReset();
 $('#sim-window').onchange=()=>drawScope();
 new ResizeObserver(()=>drawScope()).observe($('.osc'));
 drawScope();
}

async function boot(){
 try{
  const [h,cat]=await Promise.all([fetch('/api/health').then(r=>r.json()),fetch('/api/catalog').then(r=>r.json())]);
  health=h;catalog=cat.models;$('#connection').textContent='Engine συνδεδεμένο';
  $('#topologies').innerHTML=catalog.map(m=>`<button data-key="${m.key}" title="${esc(m.description)}">${esc(m.name)}</button>`).join('');
  $$('#topologies button').forEach(b=>b.onclick=()=>{if(b.dataset.key===state.topology){if(editor){closeInspector();editor.template(state.topology);markDirty();}return;}state.topology=b.dataset.key;closeInspector();if(editor)editor.template(state.topology);updateTopology();markDirty();});
  let saved=null;try{saved=JSON.parse(localStorage.getItem('pcl2-converter'));}catch{}
  if(saved&&catalog.some(m=>m.key===saved.topology))setValues({...saved,circuit:undefined},true);
  editor=new CircuitEditor($('#schematic'),{
   values:()=>({...getParams(),resolved:state.dirty?null:state.result?.metrics}),
   onchange:electrical=>{if(electrical){markDirty();$('#circuit-status').textContent='Η συνδεσμολογία άλλαξε · έλεγχος…';$('#circuit-status').className='circuit-status';}else saveLocal();},
   onedit:(comp)=>openInspector(comp,editor.screenBox(comp.id)),
  });
  try{if(saved?.circuit)editor.load(saved.circuit,false);else editor.template(state.topology);}catch{editor.template(state.topology);}
  updateTopology();renderChips();
  $('#component-palette').innerHTML=Object.keys(CircuitEditor.ports).map(type=>`<button draggable="true" data-add="${type}" title="Πρόσθεσε ή σύρε στο κύκλωμα">＋ ${esc(CircuitEditor.names[type])}</button>`).join('');
  $$('[data-add]').forEach(b=>{b.onclick=()=>editor.add(b.dataset.add);b.ondragstart=e=>e.dataTransfer.setData('application/pcl-component',b.dataset.add);});
  $('#editor-clear').onclick=()=>editor.clear();$('#editor-undo').onclick=()=>editor.undo();$('#editor-rotate').onclick=()=>editor.rotate();$('#editor-delete').onclick=()=>editor.remove();$('#editor-fit').onclick=()=>editor.resetView();
  $('#editor-wide').onclick=()=>{document.body.classList.toggle('stacked');editor.render();drawScope();};
  $('#preset').onchange=async e=>{const key=e.target.value;if(!presets[key])return;closeInspector();setValues(presets[key],false,true);e.target.value='';if(await calculate()){simReset();await showTab(state.tab);}};
  $$('.tabs button').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
  $$('[data-interval]').forEach(b=>b.onclick=()=>{state.interval=b.dataset.interval;$$('[data-interval]').forEach(x=>x.classList.toggle('active',x===b));if(sim.running&&slowMotion())return;editor.setInterval(state.interval);});
  $('#save-project').onclick=()=>download('Power_Converter_Lab_project.json',JSON.stringify({schema:'pcl-project-1',version:h.version,config:getConfig(),simulation:{speed:$('#sim-speed').value,step:$('#sim-step').value,step_ns:$('#sim-step-custom').value,start:$('#sim-start').value,window:$('#sim-window').value}},null,2));
  $('#load-project').onclick=()=>$('#file-input').click();
  $('#file-input').onchange=async e=>{try{
   const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('Το αρχείο έργου είναι πολύ μεγάλο.');
   const data=JSON.parse(await file.text());if(data.schema!=='pcl-project-1'||!catalog.some(m=>m.key===data.config?.topology))throw Error('Μη έγκυρο αρχείο Power Converter Lab.');
   const s=data.simulation||{};for(const [k,id] of [['speed','#sim-speed'],['step','#sim-step'],['start','#sim-start'],['window','#sim-window']])if(s[k]&&[...$(id).options].some(o=>o.value===s[k]))$(id).value=s[k];if(s.step_ns)$('#sim-step-custom').value=s.step_ns;$('#sim-step-custom-field').hidden=$('#sim-step').value!=='custom';
   closeInspector();setValues({...data.config,circuit:data.circuit||data.config.circuit},true,true);if(await calculate()){simReset();await showTab('workspace');}
  }catch(err){notice(err.message,true);}finally{e.target.value='';}};
  $('#export-report').onclick=exportReport;
  document.addEventListener('pointerdown',e=>{if(state.inspect&&!e.target.closest('#inspector')&&!e.target.closest('[data-comp]')&&!e.target.closest('.chip'))closeInspector();});
  document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest('input,select,textarea,button,#inspector')){e.preventDefault();$('#sim-play').click();}});
  addEventListener('resize',()=>placeInspector());
  initSimulationUI();
  if(await calculate())await showTab('workspace');
 }catch(e){$('#connection').textContent='Engine εκτός σύνδεσης';notice('Δεν βρέθηκε ο Python server. Εκκίνησε την εφαρμογή με START.ps1 ή python run.py και άνοιξε το localhost. '+e.message,true);}
}
boot();
