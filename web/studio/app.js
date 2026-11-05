'use strict';
(function(){
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const P=window.Parts,eng=(v,u,d=4)=>P.eng(v,u,d);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=4)=>Number.isFinite(v)?Number(v.toPrecision(d)).toLocaleString('el-GR',{maximumFractionDigits:8}):'—';
const S={tut:{id:'buck',options:{}},sim:null,running:false,frame:0,speed:100,stopT:0,error:null,last:0,limited:false};
let editor,scope;

// ------------------------------------------------------------------ settings
const SETTINGS_KEY='pcl2-settings';
function loadSettings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY))||{};}catch{return {};}}
function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(editor.settings));}catch{}}

// ------------------------------------------------------------------ notices
function notice(text,kind='info'){const n=$('#notice');if(!text){n.hidden=true;return;}n.hidden=false;n.className='notice '+kind;n.innerHTML=text;}
function warnings(list){const w=$('#netwarn');w.innerHTML=(list||[]).map(t=>`<span>⚠ ${esc(t)}</span>`).join('');w.hidden=!(list&&list.length);}

// ------------------------------------------------------------------ simulation
function project(){return {...editor.export(),sim:{hDiv:+$('#sim-step').value,speed:S.speed,stopT:S.stopT},scope:{cfg:scope.cfg},tutorial:S.tut};}
function buildSim(fresh){
 const doc=editor.export();
 try{
  if(!S.sim||fresh){S.sim=new MNA.Sim(doc,{hDiv:+$('#sim-step').value});}
  else S.sim.load(doc,false);
  S.error=null;warnings(S.sim.net.warnings);scope.attach(S.sim);notice('');
 }catch(e){S.error=e.message;pause();notice('Η προσομοίωση σταμάτησε: '+esc(e.message),'error');}
 refreshControls();renderChannels();updateClock();
}
function play(){if(!S.sim||S.error)return;if(S.stopT>0&&S.sim.t>=S.stopT-1e-12){notice('Έφτασε στο τέλος του εύρους. Πάτα ⟲ ή αύξησε τη διάρκεια.','info');return;}S.running=true;S.last=performance.now();$('#play').classList.add('running');$('#play').innerHTML='❚❚ Παύση';scope.running=true;requestAnimationFrame(loop);}
function pause(){S.running=false;scope.running=false;$('#play')?.classList.remove('running');if($('#play'))$('#play').innerHTML='▶ Προσομοίωση';draw(true);}
function reset(){pause();buildSim(true);scope.cfg.frozen=null;draw(true);}
function stepT(n=1){if(!S.sim||S.error)return;pause();S.sim.run(n*S.sim.T);draw(true);}
function runToEnd(){if(!S.sim||!(S.stopT>0))return;pause();const t0=performance.now();notice('Υπολογισμός έως '+eng(S.stopT,'s')+'…','info');
 const chunk=()=>{const left=S.stopT-S.sim.t;if(left<=1e-12){notice('');draw(true);return;}try{S.sim.run(left,Infinity,performance.now()+40);}catch(e){notice(esc(e.message),'error');return;}draw(false);updateClock();
  if(performance.now()-t0>120000){notice('Σταμάτησε μετά από 2 λεπτά. Μεγάλωσε το βήμα ή μείωσε τη διάρκεια.','error');return;}setTimeout(chunk,0);};chunk();}
function loop(now){
 if(!S.running)return;const dt=Math.min(.1,(now-S.last)/1000);S.last=now;
 let want=S.speed==='max'?1e9:dt*S.speed*S.sim.T;if(S.stopT>0)want=Math.min(want,S.stopT-S.sim.t);
 const before=S.sim.t;try{S.sim.run(want,Infinity,now+14);}catch(e){S.error=e.message;notice('Σφάλμα λύτη: '+esc(e.message),'error');pause();return;}
 S.limited=S.speed!=='max'&&S.sim.t-before<want*.98;
 S.frame++;draw(false);
 if(S.stopT>0&&S.sim.t>=S.stopT-1e-12){pause();notice('Τέλος εύρους προσομοίωσης ('+eng(S.stopT,'s')+'). ▶ συνεχίζει αν αυξήσεις τη διάρκεια.','info');return;}
 requestAnimationFrame(loop);
}
function draw(all){scope.draw();navRange();if(all||S.frame%3===0){S.iScaleNext=0;editor.updateLive();S.iScale=Math.max(S.iScaleNext||0,1e-9);updateClock();}if(all||S.frame%8===0){renderMeasure();updateHover();}}
function navRange(){const el=$('#nav-range');if(!el||el.offsetParent===null||!S.sim)return;const [a,b]=scope.viewRange();el.textContent=`${eng(a,'s',4)} … ${eng(b,'s',4)} · ${fmt((b-a)/S.sim.T,3)} T${scope.cfg.frozen?' · σταθερή προβολή':' · ζωντανά'}`;}
function updateClock(){const s=S.sim;if(!s)return;$('#clock').textContent='t = '+eng(s.t,'s',5);$('#periods').textContent=`${Math.floor(s.t/s.T+1e-9)} T · βήματα ${s.steps.toLocaleString('el-GR')}`;
 $('#cpu').hidden=!S.limited;$('#speed-note').textContent=S.speed==='max'?'όσο αντέχει ο υπολογιστής':`${eng(S.speed*s.T,'s',3)} ανά δευτερόλεπτο`;$('#step-note').textContent='Δt = '+eng(s.h,'s',3)+' · T = '+eng(s.T,'s',3);}

// live values on the schematic
function liveOf(c){const s=S.sim;if(!s||S.error)return null;if(c.type==='GND'||c.type==='JUNC')return null;
 const avg=S.running&&(S.speed==='max'||S.speed>=200);const val=k=>{if(avg){const p=s.lastPeriod(k);return p?p.avg:s.now(k);}return s.now(k);};
 if(c.type==='PWM'){const d=s.now('D:'+c.id);return {text:'D = '+fmt(d,4)};}
 const i=val('I:'+c.id),v=val('V:'+c.id);let on;
 if(c.type==='SW'){const e=s.net.compInfo.get(c.id)?.main;on=!!e?.on;}if(c.type==='D'){const e=s.net.compInfo.get(c.id)?.main;on=!!e?.on;}
 const pre=avg?'⌀ ':'';let text='';const scale=S.iScale||1;const z=x=>Math.abs(x)<2e-4*scale?0:x;
 if(c.type==='C')text=pre+eng(v,'V',4);else if(c.type==='CPL')text=pre+eng(val('P:'+c.id),'W',3);else if(c.type==='XFMR')text=pre+'i_m '+eng(val('Im:'+c.id),'A',3);else text=pre+eng(z(i),'A',4);
 if(['L','VDC','VAC','SW','D','R'].includes(c.type)&&Number.isFinite(i))S.iScaleNext=Math.max(S.iScaleNext||0,Math.abs(i));
 return {on,i:avg?i:s.now('I:'+c.id),text};}

// ------------------------------------------------------------------ channels
function chanLabel(key){const [pre,id,pin]=key.split(':');const c=editor.comp(id);const name=c?.label||id;
 if(pre==='VN'){const w=editor.doc.wires.find(w=>w.name&&((w.a.c===id&&w.a.p===pin)||(w.b.c===id&&w.b.p===pin)));return w?w.name:'v('+(c?.type==='JUNC'?'κόμβος '+id:name+'.'+pin)+')';}
 return ({I:'i',V:'v',P:'p',I2:'i₂',V2:'v₂',Im:'i_m',D:'D',G:'g',REF:'ref',MEAS:'μέτρ.'}[pre]||pre)+'('+name+')';}
function addProbe(key,label){if(!S.sim)return;const ok=scope.addChannel(key,label||chanLabel(key));renderChannels();if(!ok)flash('#chan-list');else{flash('#scope-card');}draw(true);}
function flash(sel){const e=$(sel);if(!e)return;e.classList.remove('flash');void e.offsetWidth;e.classList.add('flash');}
function signalsFor(c){const t=c.type;if(t==='GND'||t==='JUNC')return [];if(t==='PWM'){const k=c.params?.mode==='pi';return [['D:','duty D'],['G:','παλμός πύλης g'],...(k?[['REF:','αναφορά'],['MEAS:','μετρούμενο']]:[])];}
 const base=[['I:','ρεύμα'],['V:','τάση'],['P:',['VDC','VAC','IDC'].includes(t)?'ισχύς που δίνει':'ισχύς']];if(t==='XFMR')return [['I:','ρεύμα πρωτεύοντος'],['V:','τάση πρωτεύοντος'],['I2:','ρεύμα δευτερεύοντος'],['V2:','τάση δευτερεύοντος'],['Im:','ρεύμα μαγνήτισης'],['P:','ισχύς']];return base;}
function renderChannels(){
 const sel=$('#add-signal');const opts=['<option value="">+ Σήμα στο scope…</option>'];
 for(const c of editor.doc.components){const sg=signalsFor(c);if(!sg.length)continue;opts.push(`<optgroup label="${esc(c.label||c.id)} · ${esc(P.PARTS[c.type].name)}">`+sg.map(([p,n])=>`<option value="${p}${c.id}">${esc(n)} ${esc(c.label||c.id)}</option>`).join('')+'</optgroup>');}
 const nodes=editor.doc.wires.filter(w=>w.name).map(w=>`<option value="VN:${w.a.c}:${w.a.p}">τάση κόμβου ${esc(w.name)}</option>`);if(nodes.length)opts.push('<optgroup label="Κόμβοι με όνομα">'+nodes.join('')+'</optgroup>');
 sel.innerHTML=opts.join('');
 const panes=scope.cfg.panes;
 $('#chan-list').innerHTML=panes.map((p,pi)=>`<div class="pane-row"><div class="pane-head"><b>Παράθυρο ${pi+1}</b><label class="mini"><input type="checkbox" data-pauto="${pi}" ${p.y?.auto===false?'':'checked'}> auto</label>${p.y?.auto===false?`<input class="ymin" data-pmin="${pi}" value="${p.y.min??''}" placeholder="min"><input class="ymax" data-pmax="${pi}" value="${p.y.max??''}" placeholder="max">`:''}<label class="mini"><input type="checkbox" data-pzero="${pi}" ${p.zero?'checked':''}> 0</label></div>
  ${p.ch.map(ch=>`<div class="chan" data-key="${esc(ch.key)}"><label class="sw"><input type="checkbox" data-on="${esc(ch.key)}" ${ch.on?'checked':''}><i style="background:${ch.color}"></i></label><input class="clabel" data-label="${esc(ch.key)}" value="${esc(ch.label)}"><select data-pane="${esc(ch.key)}">${[0,1,2,3].map(i=>`<option value="${i}" ${i===pi?'selected':''}>Π${i+1}</option>`).join('')}</select><button class="x" data-rm="${esc(ch.key)}" title="Αφαίρεση">✕</button></div>`).join('')||'<div class="muted small">Κανένα σήμα. Δεξί κλικ σε στοιχείο → Scope, ή επίλεξε από τη λίστα.</div>'}</div>`).join('');
 $$('#chan-list [data-rm]').forEach(b=>b.onclick=()=>{scope.removeChannel(b.dataset.rm);renderChannels();draw(true);});
 $$('#chan-list [data-on]').forEach(b=>b.onchange=()=>{const ch=scope.channels().find(c=>c.key===b.dataset.on);for(const p of scope.cfg.panes)for(const c of p.ch)if(c.key===b.dataset.on)c.on=b.checked;void ch;draw(true);});
 $$('#chan-list [data-pane]').forEach(b=>b.onchange=()=>{scope.moveChannel(b.dataset.pane,+b.value);renderChannels();draw(true);});
 $$('#chan-list [data-label]').forEach(b=>b.onchange=()=>{for(const p of scope.cfg.panes)for(const c of p.ch)if(c.key===b.dataset.label)c.label=b.value;draw(true);});
 $$('#chan-list [data-pauto]').forEach(b=>b.onchange=()=>{const p=scope.cfg.panes[+b.dataset.pauto];if(b.checked)p.y={auto:true};else{const L=scope.layout?.[+b.dataset.pauto];p.y={auto:false,min:L?+L.lo.toPrecision(3):-1,max:L?+L.hi.toPrecision(3):1};}renderChannels();draw(true);});
 $$('#chan-list [data-pzero]').forEach(b=>b.onchange=()=>{scope.cfg.panes[+b.dataset.pzero].zero=b.checked;draw(true);});
 $$('#chan-list [data-pmin],#chan-list [data-pmax]').forEach(b=>b.onchange=()=>{const pi=+(b.dataset.pmin??b.dataset.pmax);const p=scope.cfg.panes[pi];const v=P.parseEng(b.value);if(Number.isFinite(v)){if(b.dataset.pmin!==undefined)p.y.min=v;else p.y.max=v;}draw(true);});
}
function renderMeasure(){
 if(!S.sim)return;const rows=[];const cur=scope.cfg.cursors;
 for(const ch of scope.channels()){if(!ch.on)continue;const st=scope.stats(ch.key);const u=MeasureUnit(ch.key);const lp=S.sim.lastPeriod(ch.key.startsWith('VN:')?(()=>{const n=S.sim.net.pinNet.get(ch.key.slice(3));return n&&!n.ground?'N:'+n.canon:'';})():ch.key);
  let cv='';if(cur.length){const ci=scope.resolve(ch.key);const a=ci===-1?NaN:scope.valueAt(ci,cur[0]),b=cur[1]!==undefined&&ci!==-1?scope.valueAt(ci,cur[1]):NaN;cv=`<td>${eng(a,u)}</td><td>${cur.length>1?eng(b,u):''}</td><td>${cur.length>1?eng(b-a,u):''}</td>`;}
  rows.push(`<tr><td><i class="dot" style="background:${ch.color}"></i>${esc(ch.label)}</td><td>${st?eng(st.avg,u):'—'}</td><td>${st&&Number.isFinite(st.rms)?eng(st.rms,u):'—'}</td><td>${st?eng(st.min,u):'—'}</td><td>${st?eng(st.max,u):'—'}</td><td>${st?eng(st.pp,u):'—'}</td><td>${lp?eng(lp.avg,u):'—'}</td>${cv}</tr>`);}
 const [t0,t1]=scope.viewRange();
 $('#measure').innerHTML=`<table><thead><tr><th>Σήμα</th><th>Μέση</th><th>RMS</th><th>min</th><th>max</th><th>p-p</th><th>⌀ τελ. T</th>${cur.length?`<th>A @ ${eng(cur[0],'s')}</th><th>${cur.length>1?'B @ '+eng(cur[1],'s'):'B'}</th><th>B − A${cur.length>1?' · Δt '+eng(cur[1]-cur[0],'s'):''}</th>`:''}</tr></thead><tbody>${rows.join('')}</tbody></table>
  <p class="muted small">Στατιστικά στο ορατό παράθυρο ${eng(t0,'s')} … ${eng(t1,'s')}${scope.cfg.frozen?' (σταθερή προβολή · διπλό κλικ για ζωντανή)':''}. Κλικ στο scope: cursor A, Shift+κλικ: cursor B.</p>`;
}
function MeasureUnit(key){return MeasureUnitCache[key.split(':')[0]]??Scope.unitOf(key,S.sim);}const MeasureUnitCache={};

// ------------------------------------------------------------------ live controls
function refreshControls(){
 const box=$('#live-controls');if(!box)return;const pw=editor.doc.components.filter(c=>c.type==='PWM');const meta=S.tutMeta||{};
 box.innerHTML=pw.map(c=>{const p={...P.defaults('PWM'),...c.params};
  if(p.mode==='fixed'||p.mode==='pp')return `<div class="ctl"><label>${esc(c.label||c.id)} · D <output data-dout="${c.id}">${fmt(+p.D,4)}</output></label><input type="range" min="0" max="1" step="0.0005" value="${+p.D}" data-d="${c.id}">
   <div class="ctl-btns"><button data-dd="${c.id}" data-step="-0.01">−0,01</button><button data-dd="${c.id}" data-step="-0.001">−0,001</button>${meta.D0!==undefined?`<button data-dset="${c.id}" data-val="${meta.D0}">D₀ = ${fmt(meta.D0,4)}</button>`:''}<button data-dd="${c.id}" data-step="0.001">+0,001</button><button data-dd="${c.id}" data-step="0.01">+0,01</button></div>${p.dsched?'<small>Υπάρχει πρόγραμμα D(t)· η χειροκίνητη αλλαγή το απενεργοποιεί.</small>':''}</div>`;
  if(p.mode==='pi')return `<div class="ctl"><label>${esc(c.label||c.id)} · αναφορά PI</label><div class="ctl-row"><input data-ref="${c.id}" value="${esc(p.ref)}"><button data-refapply="${c.id}">Εφαρμογή</button></div><small>Σταθερή τιμή ή πρόγραμμα «t:τιμή». K_p = ${eng(+p.Kp)}, K_i = ${eng(+p.Ki)}.</small></div>`;
  if(p.mode==='spwm')return `<div class="ctl"><label>${esc(c.label||c.id)} · m <output data-mout="${c.id}">${fmt(+p.m,3)}</output></label><input type="range" min="0" max="1.2" step="0.01" value="${+p.m}" data-m="${c.id}"></div>`;return '';}).join('')||'<div class="muted small">Χωρίς μπλοκ PWM.</div>';
 const setD=(id,d,commit)=>{d=Math.min(1,Math.max(0,d));const c=editor.comp(id);if(!c)return;c.params.D=+d.toFixed(6);if(c.params.dsched){c.params.dsched='';S.sim?.setControl(id,{dsched:null});}S.sim?.setControl(id,{D:c.params.D});
  const o=box.querySelector(`[data-dout="${id}"]`);if(o)o.textContent=fmt(d,4);const r=box.querySelector(`[data-d="${id}"]`);if(r&&commit)r.value=d;editor.renderLabels();editor.updateLive();if(commit)saveLocal();};
 $$('#live-controls [data-d]').forEach(r=>{r.oninput=()=>setD(r.dataset.d,+r.value,false);r.onchange=()=>setD(r.dataset.d,+r.value,true);});
 $$('#live-controls [data-dd]').forEach(b=>b.onclick=()=>{const c=editor.comp(b.dataset.dd);setD(b.dataset.dd,(+c.params.D||0)+(+b.dataset.step),true);});
 $$('#live-controls [data-dset]').forEach(b=>b.onclick=()=>setD(b.dataset.dset,+b.dataset.val,true));
 $$('#live-controls [data-m]').forEach(r=>r.oninput=()=>{const c=editor.comp(r.dataset.m);c.params.m=+r.value;S.sim?.setControl(r.dataset.m,{m:+r.value});box.querySelector(`[data-mout="${r.dataset.m}"]`).textContent=fmt(+r.value,3);});
 $$('#live-controls [data-refapply]').forEach(b=>b.onclick=()=>{const id=b.dataset.refapply,v=box.querySelector(`[data-ref="${id}"]`).value,sch=P.parseSched(v);if(!sch){notice('Μη έγκυρη αναφορά.','error');return;}
  const c=editor.comp(id);c.params.ref=v;S.sim?.setControl(id,{ref:sch});saveLocal();});
}

// ------------------------------------------------------------------ inspector
function closeInspector(){$('#inspector').hidden=true;$('#inspector').innerHTML='';}
function placePopup(el,x,y){el.hidden=false;const r=el.getBoundingClientRect();const W=innerWidth,H=innerHeight;el.style.left=Math.max(8,Math.min(x+12,W-r.width-8))+'px';el.style.top=Math.max(8,Math.min(y+12,H-r.height-8))+'px';}
function fieldHTML(c,def,p){const v=p[def.k]??def.def;const id='f_'+def.k;
 if(def.type==='select')return `<select id="${id}" data-k="${def.k}">${def.options.map(([k,n])=>`<option value="${k}" ${String(v)===k?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
 if(def.type==='bool')return `<input type="checkbox" id="${id}" data-k="${def.k}" ${v?'checked':''}>`;
 if(def.type==='ref'){const opts=editor.doc.components.filter(k=>def.kinds.includes(k.type)&&k.id!==c.id);return `<select id="${id}" data-k="${def.k}"><option value="">—</option>${opts.map(k=>`<option value="${k.id}" ${v===k.id?'selected':''}>${esc(k.label||k.id)} (${esc(P.PARTS[k.type].name)})</option>`).join('')}</select>`;}
 if(def.type==='text')return `<input id="${id}" data-k="${def.k}" value="${esc(v)}" placeholder="${esc(def.ph||'')}">`;
 return `<input id="${id}" data-k="${def.k}" data-num="1" value="${esc(typeof v==='number'?P.eng(v,'',6).replace(/\s/g,''):v)}" inputmode="decimal">`;}
function openInspector(id,x,y){
 const c=editor.comp(id);if(!c)return;const def=P.PARTS[c.type];const p={...P.defaults(c.type),...c.params};const ins=$('#inspector');
 const rows=def.params.filter(d=>!d.show||d.show(p)).map(d=>`<label class="frow"><span>${esc(d.label)}${d.unit?` <em>${esc(d.unit)}</em>`:''}</span>${fieldHTML(c,d,p)}${d.hint?`<small>${esc(d.hint)}</small>`:''}</label>`).join('');
 const sig=signalsFor(c).slice(0,3).map(([pre,n])=>`<button class="chip" data-probe="${pre}${c.id}">⌁ ${esc(n)}</button>`).join('');
 ins.innerHTML=`<div class="ins-head"><div><small>${esc(def.name)}</small><input class="ins-label" data-label value="${esc(c.label||c.id)}"></div><button class="x" data-close>✕</button></div>
  <div class="ins-body">${rows||'<p class="muted small">Χωρίς παραμέτρους.</p>'}</div>${sig?`<div class="ins-probes">${sig}</div>`:''}
  <div class="ins-foot"><small>Οι αλλαγές εφαρμόζονται αμέσως, και ενώ τρέχει η προσομοίωση. Μονάδες SI με προθέματα: 5.6u, 100m, 20k.</small></div>`;
 placePopup(ins,x,y);
 const apply=el=>{const k=el.dataset.k;let v;if(el.type==='checkbox')v=el.checked;else if(el.dataset.num){v=P.parseEng(el.value);if(!Number.isFinite(v)){el.classList.add('bad');return;}el.classList.remove('bad');}else v=el.value;
  if(k==='dsched'||k==='sched'||k==='ref'){if(v&&!P.parseSched(v)){el.classList.add('bad');return;}el.classList.remove('bad');}
  editor.setParams(id,{[k]:v});const def2=def.params.find(d=>d.k===k);if(def2?.type==='select'||def2?.type==='bool'||k==='gate'||k==='ff'||k==='mode')openInspector(id,parseFloat(ins.style.left)-12,parseFloat(ins.style.top)-12);};
 ins.querySelectorAll('[data-k]').forEach(el=>{el.onchange=()=>apply(el);if(el.dataset.num)el.onkeydown=e=>{if(e.key==='Enter')apply(el);};});
 ins.querySelector('[data-label]').onchange=e=>{editor.setParams(id,{},{label:e.target.value||id});renderChannels();};
 ins.querySelector('[data-close]').onclick=closeInspector;
 ins.querySelectorAll('[data-probe]').forEach(b=>b.onclick=()=>addProbe(b.dataset.probe));
}
const WIRE_COLORS=['','#147966','#c47a1c','#2f5fa0','#b03a5b','#6b4fa0','#203a3f'];
function openWireInspector(id,x,y){const w=editor.wire(id);if(!w)return;const ins=$('#inspector');
 ins.innerHTML=`<div class="ins-head"><div><small>Σύνδεση</small><b>${esc(w.name||'χωρίς όνομα')}</b></div><button class="x" data-close>✕</button></div><div class="ins-body">
  <label class="frow"><span>Όνομα κόμβου</span><input data-wname value="${esc(w.name||'')}" placeholder="π.χ. v_o"></label>
  <div class="frow"><span>Χρώμα</span><div class="swatches">${WIRE_COLORS.map(c=>`<button data-wc="${c}" class="${(w.color||'')===c?'on':''}" style="background:${c||'var(--wire)'}" title="${c||'προεπιλογή'}"></button>`).join('')}</div></div>
  <label class="frow"><span>Πάχος</span><select data-ww>${['',1.5,2.2,3,4].map(v=>`<option value="${v}" ${String(w.width||'')===String(v)?'selected':''}>${v||'προεπιλογή'}</option>`).join('')}</select></label>
  <div class="ins-probes"><button class="chip" data-wprobe>⌁ Τάση κόμβου</button><button class="chip" data-wroute>↯ Αυτόματη δρομολόγηση</button></div></div>`;
 placePopup(ins,x,y);
 ins.querySelector('[data-wname]').onchange=e=>{editor.setWireProps(id,{name:e.target.value.trim()});renderChannels();};
 ins.querySelectorAll('[data-wc]').forEach(b=>b.onclick=()=>{editor.setWireProps(id,{color:b.dataset.wc||undefined});openWireInspector(id,x,y);});
 ins.querySelector('[data-ww]').onchange=e=>editor.setWireProps(id,{width:e.target.value?+e.target.value:undefined});
 ins.querySelector('[data-wprobe]').onclick=()=>addProbe('VN:'+w.a.c+':'+w.a.p,w.name?w.name:undefined);
 ins.querySelector('[data-wroute]').onclick=()=>{editor.remember();editor.route(editor.wire(id));editor.render();};
 ins.querySelector('[data-close]').onclick=closeInspector;}

// ------------------------------------------------------------------ context menu
function closeMenu(){$('#ctx').hidden=true;}
function openMenu(ev){
 const m=$('#ctx');let items=[];
 if(ev.kind==='comp'){const c=editor.comp(ev.id);if(!c)return;
  if(c.type!=='JUNC')items.push(...signalsFor(c).map(([pre,n])=>({t:'⌁ Scope: '+n,f:()=>addProbe(pre+c.id)})));
  if(c.type==='JUNC')items.push({t:'⌁ Scope: τάση κόμβου',f:()=>addProbe('VN:'+c.id+':j')});
  if(c.type!=='JUNC')items.push('-',{t:'Ρυθμίσεις…',k:'διπλό κλικ',f:()=>openInspector(c.id,ev.x,ev.y)},{t:'Περιστροφή',k:'R',f:()=>editor.rotateSel()},{t:'Καθρέφτης',k:'M',f:()=>editor.mirrorSel()},{t:'Διπλότυπο',k:'Ctrl+D',f:()=>{editor.copySel();editor.paste(20,20);}});
  items.push({t:'Διαγραφή',k:'Del',f:()=>editor.deleteSel(),cls:'danger'});}
 else if(ev.kind==='wire'){const w=editor.wire(ev.id);if(!w)return;items.push({t:'⌁ Scope: τάση κόμβου',f:()=>addProbe('VN:'+w.a.c+':'+w.a.p,w.name||undefined)},'-',{t:'Όνομα / χρώμα…',k:'διπλό κλικ',f:()=>openWireInspector(w.id,ev.x,ev.y)},{t:'Αυτόματη δρομολόγηση',f:()=>{editor.remember();editor.route(w);editor.render();}},{t:'Διαγραφή',k:'Del',f:()=>editor.deleteSel(),cls:'danger'});}
 else items.push({t:'Επικόλληση',k:'Ctrl+V',f:()=>editor.paste(),dis:!editor.clip},{t:'Επιλογή όλων',k:'Ctrl+A',f:()=>editor.select(editor.doc.components.map(c=>c.id),editor.doc.wires.map(w=>w.id))},{t:'Προσαρμογή προβολής',k:'F',f:()=>editor.fit()},'-',
  ...['R','L','C','D','SW','VDC'].map(t=>({t:'+ '+P.PARTS[t].name,f:()=>{const c=editor.addPart(t,Math.round(ev.world[0]/10)*10,Math.round(ev.world[1]/10)*10);void c;}})));
 m.innerHTML=items.map((it,i)=>it==='-'?'<hr>':`<button data-i="${i}" class="${it.cls||''}" ${it.dis?'disabled':''}><span>${esc(it.t)}</span>${it.k?`<kbd>${esc(it.k)}</kbd>`:''}</button>`).join('');
 m.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{closeMenu();items[+b.dataset.i].f();});placePopup(m,ev.x-12,ev.y-12);}

// ------------------------------------------------------------------ hover readout on the schematic
let hoverComp=null,hoverPos=[0,0];
function updateHover(){const tip=$('#tip');if(!hoverComp||!S.sim){tip.hidden=true;return;}const c=editor.comp(hoverComp);if(!c||c.type==='JUNC'||c.type==='GND'){tip.hidden=true;return;}
 const s=S.sim;let html=`<b>${esc(c.label||c.id)}</b>`;
 if(c.type==='PWM')html+=`<div>D = ${fmt(s.now('D:'+c.id),5)}</div>${c.params.mode==='pi'?`<div>ref ${eng(s.now('REF:'+c.id))} · μέτρ. ${eng(s.now('MEAS:'+c.id))}</div>`:''}`;
 else{const lp=k=>s.lastPeriod(k);const rows=[['v','V:'+c.id,'V'],['i','I:'+c.id,'A'],['p','P:'+c.id,'W']];if(c.type==='XFMR')rows.push(['i_m','Im:'+c.id,'A'],['i₂','I2:'+c.id,'A']);
  html+='<table>'+rows.map(([n,k,u])=>`<tr><td>${n}</td><td>${eng(s.now(k),u)}</td><td class="muted">⌀ ${eng(lp(k)?.avg,u)}</td></tr>`).join('')+'</table>';}
 tip.innerHTML=html;tip.hidden=false;tip.style.left=(hoverPos[0]+16)+'px';tip.style.top=(hoverPos[1]+16)+'px';}

// ------------------------------------------------------------------ palette
function renderPalette(){const q=($('#pal-search').value||'').toLowerCase();
 $('#palette-list').innerHTML=P.GROUPS.map(g=>{const items=Object.entries(P.PARTS).filter(([k,d])=>d.group===g&&!d.hidden&&(!q||d.name.toLowerCase().includes(q)||k.toLowerCase().includes(q)));if(!items.length)return '';
  return `<div class="pal-group"><small>${esc(g)}</small>${items.map(([k,d])=>`<button class="pal-item" draggable="true" data-part="${k}" title="${esc(d.name)} · κλικ και μετά κλικ στον καμβά, ή σύρσιμο"><svg viewBox="-42 -42 84 84"><g class="sym">${d.draw(P.defaults(k))}</g></svg><span>${esc(d.name)}</span></button>`).join('')}</div>`;}).join('');
 $$('.pal-item').forEach(b=>{b.onclick=()=>{editor.beginPlace(b.dataset.part);notice('Κλικ στον καμβά για τοποθέτηση · R περιστροφή · Esc ακύρωση','info');setTimeout(()=>notice(''),3500);};
  b.ondragstart=e=>{e.dataTransfer.setData('application/x-pcl-part',b.dataset.part);e.dataTransfer.effectAllowed='copy';};});}

// ------------------------------------------------------------------ tutorials
function tutorial(){return Tutorials.get(S.tut.id)||Tutorials.list[0];}
function loadTutorial(id,options={},keepView=false){
 const t=Tutorials.get(id);if(!t)return;const opts={};for(const o of t.options)opts[o.k]=options[o.k]??o.def;S.tut={id,options:opts};
 const pr=t.build(opts);S.tutMeta=pr.meta||null;applyProject(pr,keepView);renderTutorial();runTheory();
}
function applyProject(pr,keepView){
 pause();editor.load(pr,{keepView});
 const sim=pr.sim||{};if(sim.hDiv)$('#sim-step').value=String(sim.hDiv);setSpeed(sim.speed??100);S.stopT=sim.stopT||0;$('#stop').value=S.stopT?String(+(S.stopT*1e3).toPrecision(6)):'';
 buildSim(true);
 if(pr.scope?.cfg){scope.cfg=pr.scope.cfg;scope.cfg.frozen=null;}
 else{scope.cfg={panes:[{ch:[]}],window:pr.scope?.window||{unit:'T',n:20},trigger:'roll',display:'auto',frozen:null,cursors:[]};
  (pr.scope?.panes||[]).forEach((pane,pi)=>pane.forEach(([key,label])=>scope.addChannel(key,label,pi)));}
 syncScopeInputs();renderChannels();refreshControls();closeInspector();saveLocal();draw(true);
}
function renderTutorial(){
 const t=tutorial();const o=S.tut.options;
 $('#tut-title').textContent=t.title;$('#tut-group').textContent=t.group;
 $('#tut-desc').textContent=t.desc;
 $('#tut-options').innerHTML=t.options.map(op=>`<label>${esc(op.label)}<select data-topt="${op.k}">${op.options.map(([k,n])=>`<option value="${k}" ${String(o[op.k])===k?'selected':''}>${esc(n)}</option>`).join('')}</select></label>`).join('');
 $$('#tut-options [data-topt]').forEach(s=>s.onchange=()=>{loadTutorial(t.id,{...S.tut.options,[s.dataset.topt]:s.value},true);});
 $('#tut-tasks').innerHTML=(t.tasks||[]).map(x=>`<li>${esc(x)}</li>`).join('');
 const link=t.theory==='v1'?`<a class="btn-link" href="/converter/" target="_blank" rel="noopener">Πλήρης αναλυτικός πάγκος DC-DC ↗</a>`:t.theory==='bidir'?`<a class="btn-link" href="/bidirectional/" target="_blank" rel="noopener">Πλήρης ανάλυση άσκησης PE2 (ερωτήματα 2–5, PLECS) ↗</a>`:'';
 $('#tut-links').innerHTML=link;$('#crumb').textContent=t.title;
}
function gallery(open=true){const g=$('#gallery');g.hidden=!open;if(!open)return;const groups=[...new Set(Tutorials.list.map(t=>t.group))];
 $('#gallery-body').innerHTML=groups.map(gr=>`<section><h3>${esc(gr)}</h3><div class="cards">${Tutorials.list.filter(t=>t.group===gr).map(t=>`<button class="card ${t.id===S.tut.id?'cur':''}" data-tut="${t.id}"><b>${esc(t.title)}</b><span>${esc(t.desc.split('. ')[0])}.</span></button>`).join('')}</div></section>`).join('');
 $$('#gallery [data-tut]').forEach(b=>b.onclick=()=>{gallery(false);loadTutorial(b.dataset.tut);});}

// ------------------------------------------------------------------ theory
async function api(action,data){const r=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'Σφάλμα');return j;}
function paramsOf(id){const c=editor.comp(id);return c?{...P.defaults(c.type),...c.params}:null;}
function avgOver(key,n=20){const s=S.sim;if(!s)return null;const i=s.chIndex.get(key);const p=s.per;if(i===undefined||!p.n)return null;n=Math.min(n,p.n);let a=0,mn=Infinity,mx=-Infinity,q=0;
 for(let k=1;k<=n;k++){const j=(p.head-k+p.cap)%p.cap,o=j*p.nch+i;a+=p.avg[o];q+=p.rms[o]**2;mn=Math.min(mn,p.min[o]);mx=Math.max(mx,p.max[o]);}return {avg:a/n,rms:Math.sqrt(q/n),min:mn,max:mx,pp:mx-mn};}
function lastPP(key){const p=S.sim?.lastPeriod(key);return p?p.max-p.min:NaN;}
let theoryToken=0;
async function runTheory(){
 const t=tutorial(),box=$('#theory'),token=++theoryToken;box.innerHTML='<p class="muted">Υπολογισμός…</p>';
 try{
  if(t.theory==='v1'){const V=paramsOf('V1'),L=paramsOf(t.topology==='flyback'?'T1':'L1'),Cc=paramsOf('C1'),R=paramsOf('R1'),W=paramsOf('PWM1');
   const req={topology:t.topology,vin:Math.abs(+V.V),fs:+W.fs,L:t.topology==='flyback'?+L.Lm:+L.L,C:+Cc.C,n:t.topology==='flyback'?+L.n:.5,drive:'fixed_duty',duty_set:+W.D,resistance:+R.R,load:'resistive'};
   const r=await api('analyze',req);if(token!==theoryToken)return;S.theory={kind:'v1',r,req};}
  else if(t.theory==='bidir'){const m=S.tutMeta;const r=await api('bidir',{position:m.above?'above':'below'});if(token!==theoryToken)return;S.theory={kind:'bidir',r,m};}
  else if(t.theory==='formula'){S.theory={kind:'formula'};}
  else{box.innerHTML='<p class="muted">Ελεύθερο κύκλωμα: χρησιμοποίησε scopes και μετρήσεις.</p>';S.theory=null;return;}
  renderTheory();
 }catch(e){box.innerHTML=`<p class="bad">Η θεωρία δεν υπολογίστηκε: ${esc(e.message)}. ${location.protocol==='file:'?'Άνοιξε την εφαρμογή μέσω <code>python run.py</code>.':''}</p>`;}
}
function cmpRows(rows){return `<table class="cmp"><thead><tr><th>Μέγεθος</th><th>Θεωρία</th><th>Προσομοίωση</th><th>Διαφορά</th></tr></thead><tbody>${rows.map(([n,a,b,u])=>{const d=Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)>1e-12?(100*(b/a-1)):NaN;return `<tr><td>${n}</td><td>${eng(a,u)}</td><td>${eng(b,u)}</td><td class="${Math.abs(d)<2?'good':Math.abs(d)<10?'':'warn-text'}">${Number.isFinite(d)?fmt(d,3)+' %':''}</td></tr>`;}).join('')}</tbody></table>`;}
function stepsHTML(steps){return (steps||[]).map(s=>`<details class="step"><summary>${esc(s.title)}</summary><p>${esc(s.explanation||'')}</p>${s.math?`<div class="math">${s.math.mathml||''}</div>`:''}${s.numeric?`<div class="math num">${s.numeric.mathml||''}</div>`:''}${s.result?`<div class="math res">${s.result.mathml||''}</div>`:''}</details>`).join('');}
function renderTheory(){
 const th=S.theory,box=$('#theory');if(!th){return;}const t=tutorial();let html='';
 if(th.kind==='v1'){const r=th.r,m=r.metrics,c=r.config;const neg=t.topology==='buck_boost';
  const vo=avgOver('V:C1'),il=avgOver(t.topology==='flyback'?'Im:T1':'I:L1');
  html+=`<div class="tm"><span class="badge">${esc(r.mode)}</span> V_o = ${eng(c.vo*(neg?-1:1),'V')} · I_o = ${eng(m.Iout,'A')} · D = ${fmt(m.duty,4)} · L_crit = ${eng(m.Lcrit,'H')}</div>`;
  html+=cmpRows([['V_o (μέση)',c.vo*(neg?-1:1),vo?.avg,'V'],[t.topology==='flyback'?'⟨i_m⟩':'⟨i_L⟩',m.ILmean,il?.avg,'A'],['Δi p-p',m.Iripple_pp,lastPP(t.topology==='flyback'?'Im:T1':'I:L1'),'A'],['ΔV_o p-p',m.Vripple_pp,lastPP('V:C1'),'V']]);
  html+=`<p class="muted small">Η προσομοίωση συγκρίνεται μόνο αφού σταθεροποιηθεί (μεταβατικό από την εκκίνηση). Θεωρία: ιδανικά στοιχεία, ${esc(c.drive==='fixed_duty'?'σταθερό D και ωμικό φορτίο':'')}.</p>`;
  html+=`<h4>Ανάπτυξη</h4>${stepsHTML(r.steps)}`;}
 else if(th.kind==='bidir'){const m=th.m,r=th.r;const il=avgOver('I:L1',5);const pb=avgOver('P:'+(editor.comp('VB')?'VB':'CB'),5);
  const dI=m.vlo*m.D0/(5.6e-6*20e3);
  html+=`<div class="tm"><span class="badge">${m.above?'αποθήκευση > ζυγού':'αποθήκευση < ζυγού'}</span> V_st = ${eng(m.vst,'V')} · ${m.P>0?'εκφόρτιση':'φόρτιση'} · ${m.above?(m.P>0?'Buck':'Boost'):(m.P>0?'Boost':'Buck')}</div>
   <ul class="eqs"><li>D₀ = 1 − V_lo/V_hi = 1 − ${fmt(m.vlo)}/${fmt(m.vhi)} = <b>${fmt(m.D0,5)}</b></li><li>I_L = ${m.above?'−P/V_bus':'P/V_st'} = <b>${eng(m.I,'A')}</b></li><li>Δi_L = V_lo·D/(L·f_s) = <b>${eng(dI,'A')}</b></li>
   <li>Ολίσθηση για σφάλμα δ: d⟨i_L⟩/dt = V_hi·δ/L = <b>${eng(m.vhi*.001/5.6e-6,'A/s')}</b> για δ = 0,001</li><li>Μετάβαση ±I με ΔD = 0,05: t = L·2|I|/(V_hi·ΔD) = <b>${eng(m.pulse,'s')}</b></li><li>PI (f_c = f_s/20, PM 60°): K_p = <b>${eng(m.pi.kp)}</b>, K_i = <b>${eng(m.pi.ki)}</b></li></ul>`;
  html+=cmpRows([['⟨i_L⟩ (τελευταίες 5 T)',S.tut.options.ctrl==='pi'||S.tut.options.ctrl==='pulse'?NaN:m.I,il?.avg,'A'],['Δi_L p-p',dI,lastPP('I:L1'),'A'],['P προς ζυγό',S.tut.options.bus==='ideal'?m.P:NaN,editor.comp('VB')?-(pb?.avg??NaN):NaN,'W']]);
  html+=`<p class="small">Παράθυρο ${r.config.vst_min}–${r.config.vst_max} V · L_min = ${eng(r.q4.L_min,'H')} · Δi_max = ${eng(r.q4.ripple_max.dI,'A')} @ ${fmt(r.q4.ripple_max.vst)} V · μέση ισχύς φορτίου ${fmt(r.q2.load_avg_kW)} kW.</p>`;
  html+=`<h4>Δοκιμές ερωτήματος 5</h4><div class="wrap"><table class="cmp"><thead><tr><th></th><th>V_st</th><th>P</th><th>Λειτ.</th><th>D</th><th>I_L</th><th>Δi</th><th>i_L(0) συμμ.</th></tr></thead><tbody>${r.q5.tests.map(x=>`<tr><td>${esc(x.id)}</td><td>${fmt(x.vst)}</td><td>${fmt(x.p_bus/1e3)} kW</td><td>${esc(x.mode)}</td><td>${fmt(x.D,4)}</td><td>${fmt(x.IL)}</td><td>${fmt(x.dI)}</td><td>${fmt(x.iL0_symmetric)}</td></tr>`).join('')}</tbody></table></div>`;}
 else if(th.kind==='formula')html+=formulaTheory(t);
 box.innerHTML=html;
}
function formulaTheory(t){
 const W=paramsOf('PWM1'),V=paramsOf('V1');let rows=[],eqs=[];
 if(t.topology==='cuk'||t.topology==='sepic'){const D=+W.D,Vin=+V.V,R=+paramsOf('R1').R,L1=+paramsOf('L1').L,L2=+paramsOf('L2').L,Ts=1/+W.fs;const Vo=(t.topology==='cuk'?-1:1)*Vin*D/(1-D),Io=Vo/R,IL1=Math.abs(Io)*D/(1-D);
  eqs=[`V_o = ${t.topology==='cuk'?'−':''}V_in·D/(1−D) = <b>${eng(Vo,'V')}</b>`,`I_L1 = |I_o|·D/(1−D) = <b>${eng(IL1,'A')}</b>, |I_L2| = |I_o| = <b>${eng(Math.abs(Io),'A')}</b>`,`Δi_L1 = V_in·D·T/L1 = <b>${eng(Vin*D*Ts/L1,'A')}</b>, Δi_L2 = V_in·D·T/L2 = <b>${eng(Vin*D*Ts/L2,'A')}</b>`,`V_C1 = ${t.topology==='cuk'?'V_in + |V_o|':'V_in'} = <b>${eng(t.topology==='cuk'?Vin+Math.abs(Vo):Vin,'V')}</b>`];
  rows=[['V_o',Vo,avgOver('V:C2')?.avg,'V'],['⟨i_L1⟩',IL1,avgOver('I:L1')?.avg,'A'],['⟨i_L2⟩ (a→b)',-Math.abs(Io),avgOver('I:L2')?.avg,'A'],['V_C1',t.topology==='cuk'?Vin+Math.abs(Vo):Vin,avgOver('V:C1')?.avg,'V'],['Δi_L1',Vin*D*Ts/L1,lastPP('I:L1'),'A']];}
 else if(t.topology==='hbridge'){const Vd=+V.V,R=+paramsOf('R1').R;const m=W.mode==='fixed'?2*(+W.D)-1:+W.m;const Vo=m*Vd;
  eqs=[`V_o = (2D−1)·V_d = (v_control/V_tri)·V_d = <b>${eng(Vo,'V')}</b>`,`I_o = V_o/R = <b>${eng(Vo/R,'A')}</b>`,`Συχνότητα κυμάτωσης ρεύματος: ${W.mode==='fixed'?'f_s (διπολική)':'2·f_s (μονοπολική)'}`];
  rows=[['V_o (v_A − v_B)',Vo,avgOver('V:R1')?.avg+avgOver('V:L1')?.avg,'V'],['I_o',Vo/R,avgOver('I:L1')?.avg,'A']];}
 else if(t.topology==='inverter'){const Vd=+V.V,R=+paramsOf('R1').R,L=+paramsOf('L1').L,m=+W.m,f=+W.fref,w=2*Math.PI*f;const V1=Math.min(m,1)*Vd,Z=Math.hypot(R,w*L),I1=V1/Z;
  eqs=[`V̂₁ = m·V_d = <b>${eng(V1,'V')}</b> (γραμμική περιοχή, m ≤ 1)`,`|Z| = |R + jωL| = <b>${eng(Z,'Ω')}</b>, φ = <b>${fmt(Math.atan2(w*L,R)*180/Math.PI,3)}°</b>`,`Î₁ = V̂₁/|Z| = <b>${eng(I1,'A')}</b>`,`m_f = f_s/f₁ = ${fmt(+W.fs/f)} → αρμονικές γύρω από ${W.refphase!==undefined&&editor.comp('S3')?.params.out==='b'?'2':''}m_f`];
  const pk=(()=>{const s=S.sim;if(!s)return NaN;const p=s.per;const i=s.chIndex.get('I:L1');if(i===undefined)return NaN;let mx=-Infinity;const n=Math.min(p.n,Math.round(1/f/s.T));for(let k=1;k<=n;k++){const j=(p.head-k+p.cap)%p.cap;mx=Math.max(mx,p.max[j*p.nch+i]);}return mx;})();
  rows=[['Κορυφή ρεύματος (θεμελιώδης)',I1,pk,'A']];}
 else if(t.topology==='rectifier'){const vs=paramsOf('V1'),E=+paramsOf('E1').V,R=+paramsOf('R1').R,Vpk=+vs.Vpk;if(Vpk<=E)return '<p>V̂_s ≤ E: δεν άγει καμία δίοδος.</p>';
  const a=Math.asin(E/Vpk),Iavg=(2*Vpk*Math.cos(a)-E*(Math.PI-2*a))/(Math.PI*R);let q=0;const N=2000;for(let k=0;k<N;k++){const th=a+(Math.PI-2*a)*(k+.5)/N;q+=((Vpk*Math.sin(th)-E)/R)**2;}const Irms=Math.sqrt(q*(Math.PI-2*a)/N/Math.PI);
  eqs=[`α = arcsin(E/V̂_s) = <b>${fmt(a*180/Math.PI,4)}°</b>, αγωγή από α έως π − α (${fmt((180-2*a*180/Math.PI),4)}°)`,`I_avg = [2V̂_s·cos α − E(π − 2α)]/(πR) = <b>${eng(Iavg,'A')}</b>`,`Î = (V̂_s − E)/R = <b>${eng((Vpk-E)/R,'A')}</b>`,`I_rms = <b>${eng(Irms,'A')}</b> · P_μπαταρίας = E·I_avg = <b>${eng(E*Iavg,'W')}</b> · P_R = R·I_rms² = <b>${eng(R*Irms*Irms,'W')}</b>`];
  const st=avgOver('I:R1',1);rows=[['I_avg',Iavg,st?.avg,'A'],['I_rms',Irms,st?.rms,'A'],['Î',(Vpk-E)/R,st?.max,'A']];
  if(+vs.Ls>0)eqs.push('<i>Οι τύποι ισχύουν για L_s = 0· με L_s η προσομοίωση δίνει μικρότερα ρεύματα.</i>');}
 return `<ul class="eqs">${eqs.map(e=>`<li>${e}</li>`).join('')}</ul>${rows.length?cmpRows(rows):''}`;}

// ------------------------------------------------------------------ files
function saveLocal(){try{localStorage.setItem('pcl2-state',JSON.stringify(project()));}catch{}}
function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
function exportCSV(){const s=S.sim;if(!s)return;const ch=scope.channels();if(!ch.length){notice('Πρόσθεσε σήματα στο scope πρώτα.','info');return;}const [t0,t1]=scope.viewRange();const idx=ch.map(c=>scope.resolve(c.key));
 const r=s.ring,start=(r.head-r.n+r.cap)%r.cap;let out='time [s],'+ch.map(c=>`"${c.label} [${Scope.unitOf(c.key,s)}]"`).join(',')+'\n';
 for(let i=0;i<r.n;i++){const j=(start+i)%r.cap,t=r.t[j];if(t<t0||t>t1)continue;out+=t.toExponential(9)+','+idx.map(ci=>ci===-1?'':ci===-2?'0':r.d[j*r.nch+ci]).join(',')+'\n';}
 download('scope.csv',out,'text/csv');}

// ------------------------------------------------------------------ scope inputs
function syncScopeInputs(){const w=scope.cfg.window;$('#win-n').value=+(+w.n).toPrecision(4);$('#win-unit').value=w.unit;$('#trigger').value=scope.cfg.trigger;$('#display').value=scope.cfg.display;}
function setSpeed(v){S.speed=v==='max'?'max':+v;const sel=$('#speed');if(![...sel.options].some(o=>o.value===String(v))){const o=document.createElement('option');o.value=String(v);o.textContent=v+' T/s';sel.appendChild(o);}sel.value=String(v);}

// ------------------------------------------------------------------ settings modal
function openSettings(){const s=editor.settings,m=$('#settings');m.hidden=false;
 const sel=(k,label,opts)=>`<label class="frow"><span>${label}</span><select data-set="${k}">${opts.map(([v,n])=>`<option value="${v}" ${String(s[k])===String(v)?'selected':''}>${n}</option>`).join('')}</select></label>`;
 const chk=(k,label)=>`<label class="frow check"><input type="checkbox" data-set="${k}" ${s[k]?'checked':''}><span>${label}</span></label>`;
 $('#settings-body').innerHTML=`<section><h3>Ποντίκι</h3>
  ${sel('leftDrag','Αριστερό κλικ + σύρσιμο σε κενό',[['select','Επιλογή πολλών (ορθογώνιο)'],['pan','Μετακίνηση καμβά']])}
  ${sel('marquee','Ορθογώνιο επιλογής',[['direction','Δεξιά: πλήρως μέσα · αριστερά: όσα ακουμπά'],['contain','Μόνο όσα είναι πλήρως μέσα'],['touch','Όσα ακουμπά']])}
  ${sel('middleDrag','Μεσαίο κλικ + σύρσιμο',[['pan','Μετακίνηση καμβά'],['none','Τίποτα']])}
  ${sel('rightButton','Δεξί κλικ',[['menu','Μενού (scope, ρυθμίσεις…)'],['pan','Σύρσιμο: καμβάς · κλικ: μενού']])}
  ${sel('wheel','Ροδέλα',[['zoom','Zoom (Shift: οριζόντια κύλιση)'],['scroll','Κύλιση (Ctrl: zoom)']])}
  ${sel('dblclick','Διπλό κλικ σε στοιχείο',[['edit','Ρυθμίσεις'],['scope','Scope ρεύματος']])}
  <p class="muted small">Space + σύρσιμο μετακινεί πάντα τον καμβά. Το κείμενο του σχεδίου δεν επιλέγεται ποτέ.</p></section>
  <section><h3>Πλέγμα & σύρματα</h3>${chk('grid','Εμφάνιση πλέγματος')}${sel('gridStyle','Μορφή πλέγματος',[['dots','Κουκκίδες'],['lines','Γραμμές']])}
  ${sel('wireWidth','Πάχος συρμάτων',[[1.6,'Λεπτό'],[2.2,'Κανονικό'],[3,'Χοντρό']])}${sel('corner','Γωνίες συρμάτων',[['round','Στρογγυλεμένες'],['sharp','Ορθές']])}
  ${chk('autoRoute','Αυτόματη δρομολόγηση A* όταν αφήνεις στοιχείο (αλλιώς κρατά τη δική σου διαδρομή)')}</section>
  <section><h3>Ζωντανές ενδείξεις</h3>${chk('showLive','Τιμές πάνω στο κύκλωμα')}${chk('showArrows','Βέλη φοράς ρεύματος')}</section>`;
 $$('#settings [data-set]').forEach(el=>el.onchange=()=>{const k=el.dataset.set;let v=el.type==='checkbox'?el.checked:el.value;if(k==='wireWidth')v=+v;editor.settings[k]=v;saveSettings();editor.render();});}

// ------------------------------------------------------------------ boot
function boot(){
 const saved=loadSettings();
 editor=new Editor($('#canvas'),{settings:saved,
  onchange:kind=>{if(kind==='struct'||kind==='param'){buildSim(false);if(S.theory)setTimeout(()=>{if(tutorial().theory==='v1'||tutorial().theory==='formula')runTheory();},50);}saveLocal();if(kind==='struct')renderChannels();},
  onselect:sel=>{$('#selinfo').textContent=sel.c.length+sel.w.length?`${sel.c.length} στοιχεία · ${sel.w.length} σύρματα επιλεγμένα`:'';},
  onedit:ev=>{if(ev.kind==='comp'){if(editor.settings.dblclick==='scope'&&signalsFor(editor.comp(ev.id)).length)addProbe('I:'+ev.id);else openInspector(ev.id,ev.x,ev.y);}else openWireInspector(ev.id,ev.x,ev.y);},
  oncontext:openMenu});
 editor.setLive(liveOf);
 scope=new Scope($('#scope-canvas'),{onfreeze:()=>{$('#live-btn').hidden=false;},onchange:()=>{renderMeasure();},onhover:()=>{}});
 editor.svg.addEventListener('pointermove',e=>{const el=e.target.closest?.('[data-c]');hoverComp=el?.dataset.c||null;hoverPos=[e.clientX,e.clientY];updateHover();});
 editor.svg.addEventListener('pointerleave',()=>{hoverComp=null;updateHover();});
 // toolbar
 $('#play').onclick=()=>S.running?pause():play();$('#reset').onclick=reset;$('#step1').onclick=()=>stepT(1);$('#step10').onclick=()=>stepT(10);$('#toend').onclick=runToEnd;
 $('#speed').onchange=e=>setSpeed(e.target.value);
 $('#sim-step').onchange=()=>{if(S.sim){S.sim.setStep(+$('#sim-step').value);S.sim.cache.clear();updateClock();}};
 $('#stop').onchange=e=>{const v=P.parseEng(e.target.value);S.stopT=Number.isFinite(v)&&v>0?v*1e-3:0;saveLocal();};
 $('#win-n').onchange=e=>{const v=P.parseEng(e.target.value);if(v>0){scope.cfg.window.n=v;scope.cfg.frozen=null;draw(true);}};
 $('#win-unit').onchange=e=>{scope.cfg.window.unit=e.target.value;scope.cfg.frozen=null;draw(true);};
 $('#trigger').onchange=e=>{scope.cfg.trigger=e.target.value;draw(true);};$('#display').onchange=e=>{scope.cfg.display=e.target.value;draw(true);};
 $('#avgline').onchange=e=>{scope.cfg.avgLine=e.target.checked;draw(true);};
 $('#live-btn').onclick=()=>{scope.cfg.frozen=null;$('#live-btn').hidden=true;draw(true);};
 const navOpen=v=>{$('#scope-nav').hidden=!v;$('#nav-toggle').setAttribute('aria-expanded',v);$('#nav-toggle').classList.toggle('on',v);try{localStorage.setItem('pcl2-nav',v?'1':'0');}catch{}scope.resize();};
 $('#nav-toggle').onclick=()=>navOpen($('#scope-nav').hidden);try{navOpen(localStorage.getItem('pcl2-nav')!=='0');}catch{navOpen(true);}
 $$('#scope-nav [data-nav]').forEach(b=>b.onclick=()=>{scope.nav(b.dataset.nav);$('#live-btn').hidden=!scope.cfg.frozen;syncScopeInputs();renderChannels();draw(true);});
 $('#add-signal').onchange=e=>{if(e.target.value)addProbe(e.target.value);e.target.value='';};
 const probeSel=pre=>{const ids=editor.selection().c.filter(id=>{const c=editor.comp(id);return c&&signalsFor(c).some(([p])=>p===pre);});if(!ids.length){notice('Επίλεξε πρώτα στοιχεία στο κύκλωμα (κλικ ή ορθογώνιο).','info');setTimeout(()=>notice(''),2500);return;}ids.forEach(id=>addProbe(pre+id));};
 $('#probe-i').onclick=()=>probeSel('I:');$('#probe-v').onclick=()=>probeSel('V:');
 $('#csv').onclick=exportCSV;$('#clear-cursors').onclick=()=>{scope.cfg.cursors=[];draw(true);};
 $('#fit').onclick=()=>editor.fit();$('#undo').onclick=()=>editor.undo();$('#redo').onclick=()=>editor.redo();$('#rot').onclick=()=>editor.rotateSel();$('#del').onclick=()=>editor.deleteSel();
 $('#tutorials').onclick=()=>gallery(true);$('#gallery-close').onclick=()=>gallery(false);
 $('#open-settings').onclick=openSettings;$('#settings-close').onclick=()=>$('#settings').hidden=true;
 $('#theory-refresh').onclick=()=>runTheory();
 $('#new').onclick=()=>loadTutorial('empty');
 $('#save').onclick=()=>download((tutorial().id||'circuit')+'.pcl.json',JSON.stringify(project(),null,1));
 $('#open').onclick=()=>$('#file').click();
 $('#file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const pr=JSON.parse(await f.text());if(!Array.isArray(pr.components))throw Error('Δεν είναι αρχείο κυκλώματος.');S.tut=pr.tutorial||{id:'empty',options:{}};S.tutMeta=null;applyProject(pr);renderTutorial();runTheory();}catch(err){notice('Άνοιγμα: '+esc(err.message),'error');}e.target.value='';};
 $('#pal-search').oninput=renderPalette;$('#pal-toggle').onclick=()=>document.body.classList.toggle('pal-hidden');
 document.addEventListener('pointerdown',e=>{if(!e.target.closest('#ctx'))closeMenu();if(!e.target.closest('#inspector')&&!e.target.closest('.schem')&&!e.target.closest('#ctx'))closeInspector();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();closeInspector();gallery(false);$('#settings').hidden=true;}
  if(e.target===document.body&&e.code==='Space'){e.preventDefault();S.running?pause():play();}});
 // resizable canvas
 const grip=$('#grip');grip.onpointerdown=e=>{e.preventDefault();grip.setPointerCapture(e.pointerId);const h0=$('.work').getBoundingClientRect().height,y0=e.clientY;grip.onpointermove=ev=>{$('.work').style.height=Math.max(240,Math.min(1000,h0+ev.clientY-y0))+'px';};grip.onpointerup=()=>{grip.onpointermove=null;};};
 renderPalette();
 // restore last state or start with a tutorial
 let st=null;try{st=JSON.parse(localStorage.getItem('pcl2-state'));}catch{}
 const want=new URLSearchParams(location.search).get('tutorial');
 if(want&&Tutorials.get(want))loadTutorial(want);
 else if(st&&Array.isArray(st.components)){S.tut=st.tutorial||{id:'empty',options:{}};const t=Tutorials.get(S.tut.id);if(t&&S.tut.id!=='empty'){const pr=t.build({...Object.fromEntries(t.options.map(o=>[o.k,o.def])),...S.tut.options});S.tutMeta=pr.meta||null;}applyProject(st);renderTutorial();runTheory();}
 else loadTutorial('buck');
 fetch('/api/health').then(r=>r.json()).then(h=>{$('#engine').textContent='Engine '+h.version;$('#engine').classList.add('ok');}).catch(()=>{$('#engine').textContent='Χωρίς server: μόνο προσομοίωση';});
 setInterval(()=>{if(S.theory&&(S.running||S.frame))renderTheoryLive();},1000);
}
function renderTheoryLive(){if(document.querySelector('#theory details[open]'))return;renderTheory();}
window.addEventListener('DOMContentLoaded',boot);
window.PCL={get S(){return S;},get editor(){return editor;},get scope(){return scope;},loadTutorial,addProbe,play,pause,reset};
})();
