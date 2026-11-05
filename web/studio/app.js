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
function project(){return {...editor.export(),sim:{hDiv:+$('#sim-step').value,speed:S.speed,stopT:S.stopT,method:$('#method').value},scope:{cfg:scope.cfg},tutorial:S.tut};}
function buildSim(fresh){
 const doc=editor.export();
 try{
  if(!S.sim||fresh){S.sim=new MNA.Sim(doc,{hDiv:+$('#sim-step').value,method:$('#method').value});}
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
function draw(all){scope.draw();navRange();if(all||S.frame%3===0){S.iScaleNext=0;editor.updateLive();S.iScale=Math.max(S.iScaleNext||0,1e-9);updateClock();}if(all||S.frame%8===0){renderMeasure();updateHover();renderMetricsPanel();}if(all){if(S.batch)renderBatch();if(S.theory&&!S.running)renderTheoryLive();}}
function navRange(){const el=$('#nav-range');if(!el||el.offsetParent===null||!S.sim)return;const [a,b]=scope.viewRange();el.textContent=`${eng(a,'s',4)} … ${eng(b,'s',4)} · ${fmt((b-a)/S.sim.T,3)} T${scope.cfg.frozen?' · σταθερή προβολή':' · ζωντανά'}`;}
function updateClock(){const s=S.sim;if(!s)return;$('#clock').textContent='t = '+eng(s.t,'s',5);$('#periods').textContent=`${Math.floor(s.t/s.T+1e-9)} T · βήματα ${s.steps.toLocaleString('el-GR')}`;
 $('#cpu').hidden=!S.limited;$('#speed-note').textContent=S.speed==='max'?'όσο αντέχει ο υπολογιστής':`${eng(S.speed*s.T,'s',3)} ανά δευτερόλεπτο`;$('#step-note').textContent='Δt = '+eng(s.h,'s',3)+' · T = '+eng(s.T,'s',3);}

// live values on the schematic
function liveOf(c){const s=S.sim;if(!s||S.error)return null;if(c.type==='GND'||c.type==='JUNC')return null;
 const avg=S.running&&(S.speed==='max'||S.speed>=200);const val=k=>{if(avg){const p=s.lastPeriod(k);return p?p.avg:s.now(k);}return s.now(k);};
 if(c.type==='PWM'){const d=s.now('D:'+c.id);return {text:'D = '+fmt(d,4)};}
 const i=val('I:'+c.id),v=val('V:'+c.id);let on;
 if(c.type==='SW'){const e=s.net.compInfo.get(c.id)?.main;on=!!e?.on;}if(c.type==='D'||c.type==='SCR'){const e=s.net.compInfo.get(c.id)?.main;on=!!e?.on;}
 const pre=avg?'⌀ ':'';let text='';const scale=S.iScale||1;const z=x=>Math.abs(x)<2e-4*scale?0:x;
 if(c.type==='C')text=pre+eng(v,'V',4);else if(c.type==='CPL')text=pre+eng(val('P:'+c.id),'W',3);else if(c.type==='XFMR')text=pre+'i_m '+eng(val('Im:'+c.id),'A',3);else text=pre+eng(z(i),'A',4);
 if(['L','VDC','VAC','VAC3','SW','D','SCR','R'].includes(c.type)&&Number.isFinite(i))S.iScaleNext=Math.max(S.iScaleNext||0,Math.abs(i));
 return {on,i:avg?i:s.now('I:'+c.id),text};}

// ------------------------------------------------------------------ channels
function chanLabel(key){const [pre,id,pin]=key.split(':');const c=editor.comp(id);const name=c?.label||id;
 if(pre==='VN'){const w=editor.doc.wires.find(w=>w.name&&((w.a.c===id&&w.a.p===pin)||(w.b.c===id&&w.b.p===pin)));return w?w.name:'v('+(c?.type==='JUNC'?'κόμβος '+id:name+'.'+pin)+')';}
 const c3=c?.type==='VAC3';return ({I:c3?'i_a':'i',V:c3?'v_an':'v',P:'p',I2:'i₂',V2:'v₂',Im:'i_m',Ib:'i_b',Ic:'i_c',Vb:'v_bn',Vc:'v_cn',Vab:'v_ab',PSW:'p_sw',D:'D',G:'g',REF:'ref',MEAS:'μέτρ.'}[pre]||pre)+'('+name+')';}
function addProbe(key,label){if(!S.sim)return;const ok=scope.addChannel(key,label||chanLabel(key));renderChannels();if(!ok)flash('#chan-list');else{flash('#scope-card');}draw(true);}
function flash(sel){const e=$(sel);if(!e)return;e.classList.remove('flash');void e.offsetWidth;e.classList.add('flash');}
function signalsFor(c){const t=c.type;if(t==='GND'||t==='JUNC')return [];if(t==='PWM'){const k=c.params?.mode==='pi';return [['D:','duty D'],['G:','παλμός πύλης g'],...(k?[['REF:','αναφορά'],['MEAS:','μετρούμενο']]:[])];}
 const base=[['I:','ρεύμα'],['V:','τάση'],['P:',['VDC','VAC','IDC'].includes(t)?'ισχύς που δίνει':'ισχύς']];if(t==='SW'&&(+c.params?.Eon>0||+c.params?.Eoff>0))base.push(['PSW:','απώλειες μεταγωγής (μέση ανά T)']);
 if(t==='VAC3')return [['I:','ρεύμα φάσης a'],['Ib:','ρεύμα φάσης b'],['Ic:','ρεύμα φάσης c'],['V:','τάση v_an'],['Vb:','τάση v_bn'],['Vc:','τάση v_cn'],['Vab:','πολική τάση v_ab'],['P:','ισχύς που δίνει (3φ)']];if(t==='XFMR')return [['I:','ρεύμα πρωτεύοντος'],['V:','τάση πρωτεύοντος'],['I2:','ρεύμα δευτερεύοντος'],['V2:','τάση δευτερεύοντος'],['Im:','ρεύμα μαγνήτισης'],['P:','ισχύς']];return base;}
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

// ------------------------------------------------------------------ response metrics
function simKey(key){if(!key.startsWith('VN:'))return key;const n=S.sim?.net.pinNet.get(key.slice(3));return n&&!n.ground?'N:'+n.canon:null;}
function perSeries(key){const s=S.sim;const k=simKey(key);const i=k===null?undefined:s?.chIndex.get(k);if(i===undefined)return null;const p=s.per,t=[],y=[];const st=(p.head-p.n+p.cap)%p.cap;for(let q=0;q<p.n;q++){const j=(st+q)%p.cap;t.push(p.t[j]);y.push(p.avg[j*p.nch+i]);}return {t,y};}
function refFor(key){ // reference of the loop that measures this signal, as a function of t
 const sched=(s,t,d)=>{if(!s)return d;let v=s[0][1];if(t<s[0][0])return d;for(const [ts,val] of s){if(ts<=t+1e-15)v=val;else break;}return v;};
 for(const c of editor.doc.components){if(c.type!=='PWM')continue;const p={...P.defaults('PWM'),...c.params};if(p.mode!=='pi')continue;
  if(key==='MEAS:'+c.id||key===(p.qty==='V'?'V:':'I:')+p.sensor){const s=P.parseSched(p.ref);if(s)return {fn:t=>sched(s,t,s[0][1]),label:`αναφορά του ${c.label||c.id}`};}}
 return null;}
function metricsFor(key,ev,opts={}){const d=perSeries(key);if(!d||d.t.length<4)return {ok:false,why:'Δεν υπάρχουν ακόμη αρκετές περίοδοι.'};
 const evs=Metrics.scheduleEvents(editor.doc,P.parseSched);const i=evs.findIndex(e=>Math.abs(e.t-ev.t)<1e-12);const next=evs.find((e,j)=>j>i&&e.t>ev.t+1e-12);
 const tEnd=Math.min(next?next.t:Infinity,S.sim.t);const rf=opts.ref==='final'?null:opts.ref==='value'?opts.value:(refFor(key)?.fn||null);
 return Metrics.responseMetrics({t:d.t,y:d.y,tStep:ev.t,tEnd,ref:rf,band:opts.band??.02});}
function metricsRows(m,u){if(!m.ok)return `<p class="muted small">${esc(m.why)}</p>`;const pct=v=>Number.isFinite(v)?fmt(v,3)+' %':'—';
 const rows=m.disturbance?[['Μέγιστη απόκλιση',eng(m.maxDev,u)],['τη στιγμή (μετά το βήμα)',eng(m.tDev,'s')],['Επαναφορά στη ζώνη ±'+eng(m.tol,u),m.settled?eng(m.ts,'s'):'δεν επανήλθε']]
  :[['Υπερύψωση',pct(m.overshoot)],['Χρόνος ανόδου 10–90 %',eng(m.rise,'s')],['Χρόνος κορυφής',eng(m.tPeak,'s')],['Αποκατάσταση στη ζώνη ±'+eng(m.tol,u),m.settled?eng(m.ts,'s'):'δεν σταθεροποιήθηκε']];
 return `<table class="kv"><tbody><tr><td>Αρχική → τελική</td><td>${eng(m.y0,u)} → ${eng(m.yf,u)}</td></tr>${rows.map(([a,b])=>`<tr><td>${a}</td><td>${b}</td></tr>`).join('')}
  ${Number.isFinite(m.ess)?`<tr><td>Σφάλμα μόνιμης κατάστασης</td><td>${eng(m.ess,u)}</td></tr>`:''}<tr><td>IAE = ∫|e|dt</td><td>${eng(m.IAE,u+'·s')}</td></tr><tr><td>ISE = ∫e²dt</td><td>${eng(m.ISE,u?u+'²·s':'s')}</td></tr><tr><td>ITAE = ∫t|e|dt</td><td>${eng(m.ITAE,u+'·s²')}</td></tr></tbody></table>`;}
function eventMetricsHTML(key){if(!S.sim)return '';const evs=Metrics.scheduleEvents(editor.doc,P.parseSched).filter(e=>e.t<S.sim.t);if(!evs.length)return '<p class="muted small">Τρέξε την προσομοίωση πέρα από τα βήματα (⏩) για να βγουν οι δείκτες.</p>';
 const u=MeasureUnit(key);return evs.map(e=>{const m=metricsFor(key,e);return `<div class="evm"><b>${esc(e.what)} @ ${eng(e.t,'s')}</b>${m.ok?(m.disturbance?` · μέγ. απόκλιση ${eng(m.maxDev,u)}, επαναφορά ${m.settled?eng(m.ts,'s'):'—'}`:` · υπερύψωση ${fmt(m.overshoot,3)} %, t_r ${eng(m.rise,'s')}, t_s(±2 %) ${m.settled?eng(m.ts,'s'):'—'}`)+` · IAE ${eng(m.IAE,u+'·s')}`:' · '+esc(m.why)}</div>`;}).join('');}
function renderMetricsPanel(){const box=$('#rm-out');if(!box||!S.sim||!$('#rm-block').open)return;
 const sig=$('#rm-sig'),evSel=$('#rm-ev');const chans=scope.channels();const keep=sig.value;
 sig.innerHTML=chans.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')||'<option value="">— πρόσθεσε σήμα στο scope —</option>';if(chans.some(c=>c.key===keep))sig.value=keep;
 const evs=Metrics.scheduleEvents(editor.doc,P.parseSched),kev=evSel.value;evSel.innerHTML=evs.map((e,i)=>`<option value="${i}">${esc(e.what)} @ ${eng(e.t,'s')}</option>`).join('')+'<option value="manual">χειροκίνητα…</option>';
 if([...evSel.options].some(o=>o.value===kev))evSel.value=kev;$('#rm-t-l').hidden=evSel.value!=='manual';$('#rm-val-l').hidden=$('#rm-ref').value!=='value';
 const key=sig.value;if(!key){box.innerHTML='';return;}
 const ev=evSel.value==='manual'?{t:(P.parseEng($('#rm-t').value)||0)*1e-3}:evs[+evSel.value];if(!ev){box.innerHTML='<p class="muted small">Δεν υπάρχει πρόγραμμα R(t), V(t), P(t), D(t) ή αναφοράς: διάλεξε «χειροκίνητα» και δώσε τη στιγμή του βήματος.</p>';return;}
 const refMode=$('#rm-ref').value,rf=refFor(key);const m=metricsFor(key,ev,{ref:refMode==='auto'&&!rf?'final':refMode,value:P.parseEng($('#rm-val').value),band:+$('#rm-band').value});
 box.innerHTML=`<p class="muted small">${refMode==='auto'?(rf?esc(rf.label):'σφάλμα ως προς την τελική τιμή'):refMode==='final'?'σφάλμα ως προς την τελική τιμή':'σφάλμα ως προς σταθερή τιμή'} · από μέσες τιμές ανά περίοδο (χωρίς την κυμάτωση)</p>`+metricsRows(m,MeasureUnit(key));}

// ------------------------------------------------------------------ server reference solver (SciPy)
function btStatus(text,kind=''){const el=$('#bt-status');el.innerHTML=text;el.className='bt-status '+kind;}
function parseStep(v){v=String(v||'').trim();if(!v)return 0;const m=v.match(/^T\s*\/\s*([\d.]+)$/i);if(m&&S.sim)return S.sim.T/+m[1];const x=P.parseEng(v);return Number.isFinite(x)&&x>0?x:NaN;}
async function runBatch(){
 if(!S.sim||S.error){btStatus('Το κύκλωμα δεν προσομοιώνεται.','err');return;}
 const keys=scope.channels().map(c=>c.key);if(!keys.length){btStatus('Πρόσθεσε πρώτα σήματα στο scope: αυτά θα υπολογίσει ο server.','err');return;}
 const tv=P.parseEng($('#bt-tend').value),tEnd=Number.isFinite(tv)&&tv>0?tv*1e-3:(S.sim.t>0?S.sim.t:S.stopT);
 if(!(tEnd>0)){btStatus('Δώσε διάρκεια ή τρέξε πρώτα την προσομοίωση: η σύγκριση γίνεται στο ίδιο διάστημα.','err');return;}
 const hmax=parseStep($('#bt-hmax').value);if(Number.isNaN(hmax)){btStatus('Μέγιστο βήμα: τιμή σε s (π.χ. 1u) ή «T/100».','err');return;}
 let req;try{req=MNA.exportForBatch(editor.export(),keys);}catch(e){btStatus(esc(e.message),'err');return;}
 const method=$('#bt-method').value,rtol=P.parseEng($('#bt-rtol').value),atol=P.parseEng($('#bt-atol').value);
 $('#bt-run').disabled=true;btStatus(`Ο ${esc(method)} τρέχει στον server έως ${eng(tEnd,'s')}…`);const w0=performance.now();
 try{const r=await api('batch_sim',{net:req.net,channels:req.channels,t_end:tEnd,method,rtol:Number.isFinite(rtol)?rtol:1e-6,atol:Number.isFinite(atol)?atol:1e-9,max_step:hmax||0,max_points:30000});
  const data={};for(const k of Object.keys(r.ch))data[k]={t:Float64Array.from(r.t),y:Float64Array.from(r.ch[k])};
  S.batch={r,data,skipped:req.skipped,label:`${method} (server, rtol ${eng(r.rtol)})`,stale:false};
  scope.setRefs($('#bt-show').checked?{label:S.batch.label,data}:null);renderBatch();
  const st=r.stats;btStatus(`${r.status==='ok'?'✓':'⚠'} ${esc(method)}: ${st.points.toLocaleString('el-GR')} σημεία, ${st.segments.toLocaleString('el-GR')} τμήματα, ${st.diode_events.toLocaleString('el-GR')} μεταγωγές διόδων, ${st.nfev.toLocaleString('el-GR')} f, ${st.njev} J, ${st.nlu.toLocaleString('el-GR')} LU · ${fmt(st.wall_s,3)} s στον server (${fmt((performance.now()-w0)/1000,3)} s συνολικά)${r.message?'<br>'+esc(r.message):''}${req.skipped.length?'<br>Χωρίς αναφορά: '+req.skipped.map(esc).join(', '):''}`,r.status==='ok'?'':'err');}
 catch(e){btStatus('Σφάλμα: '+esc(e.message),'err');}
 finally{$('#bt-run').disabled=false;}}
function clearBatch(){S.batch=null;scope.setRefs(null);$('#bt-out').innerHTML='';btStatus('');}
// time-weighted mean of a piecewise-linear trace over exactly [a,b]
function meanPL(t,y,a,b){let s=0,pt=null,pv=0;const at=x=>{let lo=0,hi=t.length-1;if(x<=t[0])return y[0];if(x>=t[hi])return y[hi];while(hi-lo>1){const m=(lo+hi)>>1;if(t[m]<=x)lo=m;else hi=m;}return t[hi]>t[lo]?y[lo]+(y[hi]-y[lo])*(x-t[lo])/(t[hi]-t[lo]):y[hi];};
 pt=a;pv=at(a);for(let i=0;i<t.length;i++){if(t[i]<=a)continue;if(t[i]>=b)break;s+=(t[i]-pt)*(pv+y[i])/2;pt=t[i];pv=y[i];}s+=(b-pt)*(pv+at(b))/2;return b>a?s/(b-a):NaN;}
function ringTrace(ci){const r=S.sim.ring,st=(r.head-r.n+r.cap)%r.cap,t=new Float64Array(r.n),y=new Float64Array(r.n);for(let i=0;i<r.n;i++){const j=(st+i)%r.cap;t[i]=r.t[j];y[i]=ci===-2?0:r.d[j*r.nch+ci];}return {t,y};}
function renderBatch(){const box=$('#bt-out');const B=S.batch;if(!B||!S.sim){box.innerHTML='';return;}const r=B.r,T=S.sim.T;
 const rows=[];let common=null;
 for(const ch of scope.channels()){const d=B.data[ch.key];if(!d)continue;const ci=scope.resolve(ch.key);if(ci===-1)continue;const js=ringTrace(ci);if(js.t.length<2)continue;
  const a=Math.max(d.t[0],js.t[0]),b=Math.min(d.t[d.t.length-1],js.t[js.t.length-1]);if(!(b>a))continue;common=[a,b];
  const a1=Math.max(a,b-T);const mb=meanPL(d.t,d.y,a1,b),mj=meanPL(js.t,js.y,a1,b);
  const diffs=[];let sq=0,n=0,scale=0;for(let i=0;i<d.t.length;i++){const t=d.t[i];if(t<a||t>b)continue;const e=scope.valueAt(ci,t)-d.y[i];diffs.push(Math.abs(e));sq+=e*e;n++;scale=Math.max(scale,Math.abs(d.y[i]));}
  diffs.sort((x,y)=>x-y);const p95=diffs.length?diffs[Math.floor(.95*(diffs.length-1))]:NaN,u=MeasureUnit(ch.key);
  const dp=Number.isFinite(mb)&&Math.abs(mb)>1e-12*Math.max(scale,1)?100*(mj-mb)/Math.abs(mb):NaN;
  rows.push(`<tr><td><i class="dot" style="background:${ch.color}"></i>${esc(ch.label)}</td><td>${eng(mb,u)}</td><td>${eng(mj,u)}</td><td class="${Math.abs(dp)<.1?'good':Math.abs(dp)<1?'':'warn-text'}">${Number.isFinite(dp)?fmt(dp,3)+' %':'—'}</td><td>${eng(Math.sqrt(sq/Math.max(n,1)),u)}</td><td>${eng(p95,u)}</td><td>${fmt(100*Math.sqrt(sq/Math.max(n,1))/Math.max(scale,1e-12),3)} %</td></tr>`);}
 box.innerHTML=rows.length?`<h4>Σύγκριση με ${esc(B.label)}</h4><div class="wrap"><table><thead><tr><th>Σήμα</th><th>⟨server⟩ τελ. T</th><th>⟨browser⟩ τελ. T</th><th>Διαφορά</th><th>RMS Δ</th><th>95 % |Δ|</th><th>RMS Δ / max</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
  <p class="muted small">Κοινό διάστημα ${eng(common[0],'s')} … ${eng(common[1],'s')}. Ο browser λύνει με σταθερό βήμα Δt = ${eng(S.sim.h,'s')} (${esc($('#method').selectedOptions[0]?.textContent||'')}), ο server με μεταβλητό βήμα και έλεγχο σφάλματος. Κοντά στις μεταγωγές το |Δ| είναι μεγάλο αν οι δύο λύτες βρίσκουν την ακμή σε λίγο διαφορετική στιγμή· γι' αυτό δίνεται το RMS και το 95 %.${B.stale?' <b>Το κύκλωμα άλλαξε μετά τον υπολογισμό.</b>':''}</p>`
  :`<p class="muted small">Δεν υπάρχει κοινό διάστημα με την προσομοίωση του browser: τρέξε την προσομοίωση έως ${eng(r.t_end,'s')} (⏩).</p>`;}

// ------------------------------------------------------------------ live controls
function refreshControls(){
 const box=$('#live-controls');if(!box)return;const pw=editor.doc.components.filter(c=>c.type==='PWM');const meta=S.tutMeta||{};
 box.innerHTML=pw.map(c=>{const p={...P.defaults('PWM'),...c.params};
  if(p.mode==='fixed'||p.mode==='pp')return `<div class="ctl"><label>${esc(c.label||c.id)} · D <output data-dout="${c.id}">${fmt(+p.D,4)}</output></label><input type="range" min="0" max="1" step="0.0005" value="${+p.D}" data-d="${c.id}">
   <div class="ctl-btns"><button data-dd="${c.id}" data-step="-0.01">−0,01</button><button data-dd="${c.id}" data-step="-0.001">−0,001</button>${meta.D0!==undefined?`<button data-dset="${c.id}" data-val="${meta.D0}">D₀ = ${fmt(meta.D0,4)}</button>`:''}<button data-dd="${c.id}" data-step="0.001">+0,001</button><button data-dd="${c.id}" data-step="0.01">+0,01</button></div>${p.dsched?'<small>Υπάρχει πρόγραμμα D(t)· η χειροκίνητη αλλαγή το απενεργοποιεί.</small>':''}</div>`;
  if(p.mode==='pi')return `<div class="ctl"><label>${esc(c.label||c.id)} · αναφορά ${+p.Kd?'PID':'PI'}</label><div class="ctl-row"><input data-ref="${c.id}" value="${esc(p.ref)}"><button data-refapply="${c.id}">Εφαρμογή</button></div><small>Σταθερή τιμή ή πρόγραμμα «t:τιμή». K_p = ${eng(+p.Kp)}, K_i = ${eng(+p.Ki)}${+p.Kd?`, K_d = ${eng(+p.Kd)}`:''}.</small></div>`;
  if(p.mode==='spwm')return `<div class="ctl"><label>${esc(c.label||c.id)} · m <output data-mout="${c.id}">${fmt(+p.m,3)}</output></label><input type="range" min="0" max="1.2" step="0.01" value="${+p.m}" data-m="${c.id}"></div>`;return '';}).join('');
 const scr=editor.doc.components.filter(c=>c.type==='SCR'&&(c.params?.fire||'alpha')==='alpha');
 if(scr.length){const a=+(scr[0].params?.alpha??30);box.innerHTML+=`<div class="ctl"><label>Θυρίστορ (${scr.length}) · α <output data-aout>${fmt(a,4)}°</output></label><input type="range" min="0" max="180" step="0.5" value="${a}" data-alpha><small>Ίδια γωνία έναυσης σε όλα· η μετατόπιση του καθενός μένει.</small></div>`;}
 if(!box.innerHTML)box.innerHTML='<div class="muted small">Χωρίς μπλοκ PWM ή θυρίστορ.</div>';
 const al=box.querySelector('[data-alpha]');if(al){const setA=(commit)=>{const a=+al.value;for(const c of scr)c.params.alpha=a;S.sim?.setFiring(a);box.querySelector('[data-aout]').textContent=fmt(a,4)+'°';editor.renderLabels();if(commit){saveLocal();if(S.theory)renderTheory();}};al.oninput=()=>setA(false);al.onchange=()=>setA(true);}
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
 const pr=t.build(opts);S.tutMeta=pr.meta||null;applyProject(pr,keepView);renderTutorial();runTheory();runMath();
}
function applyProject(pr,keepView){
 pause();editor.load(pr,{keepView});if(S.batch)clearBatch();
 const sim=pr.sim||{};if(sim.hDiv)$('#sim-step').value=String(sim.hDiv);if(sim.method){$('#method').value=sim.method;$('#method-note').textContent={TR:'2ης τάξης, χωρίς απόσβεση',BDF2:'2ης τάξης, απόσβεση στις υψηλές συχνότητες',BE:'1ης τάξης, ισχυρή απόσβεση'}[sim.method]||'';}setSpeed(sim.speed??100);S.stopT=sim.stopT||0;$('#stop').value=S.stopT?String(+(S.stopT*1e3).toPrecision(6)):'';
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
let apiChain=Promise.resolve();
function api(action,data){const run=async()=>{const r=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'Σφάλμα');return j;};const p=apiChain.then(run,run);apiChain=p.catch(()=>{});return p;}
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
  if(editor.comp('Cc')){const T1=paramsOf('T1'),vc=avgOver('V:Cc'),ip=avgOver('I:T1',5),pr=avgOver('P:Rc'),vo2=vo?.avg,Llk=+T1.Llk1,fs=+paramsOf('PWM1').fs,Vr=vo2/(+T1.n);
   const Ppred=.5*Llk*(ip?.max??NaN)**2*fs*(vc?.avg)/((vc?.avg)-Vr);
   html+=`<h4>Σκέδαση και RCD clamp</h4><ul class="eqs"><li>Ανακλώμενη τάση V_o/n = <b>${eng(Vr,'V')}</b> · τάση clamp V_c = <b>${eng(vc?.avg,'V')}</b> · μέγιστη τάση διακόπτη V_in + V_c = <b>${eng(+paramsOf('V1').V+(vc?.avg??NaN),'V')}</b></li>
    <li>Ενέργεια σκέδασης ανά περίοδο ½·L_lk·Î_p² = <b>${eng(.5*Llk*(ip?.max??NaN)**2,'J')}</b> με Î_p = ${eng(ip?.max,'A')}</li><li>Στο clamp: P = ½·L_lk·Î_p²·f_s·V_c/(V_c − V_o/n) = <b>${eng(Ppred,'W')}</b> (μέρος της ενέργειας μαγνήτισης περνά κι αυτό από το clamp όσο σβήνει η σκέδαση)</li></ul>`;
   html+=cmpRows([['P στο R_c',Ppred,pr?.avg,'W'],['V_S,max',+paramsOf('V1').V+(vc?.avg??NaN),avgOver('V:S1',5)?.max,'V']]);
   html+=`<p class="muted small">Η θεωρία DC-DC πάνω είναι για ιδανικό μετασχηματιστή. Η σκέδαση «τρώει» λίγο από το D, γι' αυτό η V_o βγαίνει χαμηλότερη.</p>`;}
  html+=`<p class="small">Πλήρης ανάλυση με εξισώσεις και αντικατάσταση: ενότητα «Υπολογισμοί & μαθηματικά».</p>`;}
 else if(th.kind==='bidir'){const m=th.m,r=th.r;const il=avgOver('I:L1',5);const pb=avgOver('P:'+(editor.comp('VB')?'VB':'CB'),5);
  const dI=m.vlo*m.D0/(5.6e-6*20e3);
  html+=`<div class="tm"><span class="badge">${m.above?'αποθήκευση > ζυγού':'αποθήκευση < ζυγού'}</span> V_st = ${eng(m.vst,'V')} · ${m.P>0?'εκφόρτιση':'φόρτιση'} · ${m.above?(m.P>0?'Buck':'Boost'):(m.P>0?'Boost':'Buck')}</div>
   <ul class="eqs"><li>D₀ = 1 − V_lo/V_hi = 1 − ${fmt(m.vlo)}/${fmt(m.vhi)} = <b>${fmt(m.D0,5)}</b></li><li>I_L = ${m.above?'−P/V_bus':'P/V_st'} = <b>${eng(m.I,'A')}</b></li><li>Δi_L = V_lo·D/(L·f_s) = <b>${eng(dI,'A')}</b></li>
   <li>Ολίσθηση για σφάλμα δ: d⟨i_L⟩/dt = V_hi·δ/L = <b>${eng(m.vhi*.001/5.6e-6,'A/s')}</b> για δ = 0,001</li><li>Μετάβαση ±I με ΔD = 0,05: t = L·2|I|/(V_hi·ΔD) = <b>${eng(m.pulse,'s')}</b></li><li>PI (f_c = f_s/20, PM 60°): K_p = <b>${eng(m.pi.kp)}</b>, K_i = <b>${eng(m.pi.ki)}</b></li></ul>`;
  html+=cmpRows([['⟨i_L⟩ (τελευταίες 5 T)',S.tut.options.ctrl==='pi'||S.tut.options.ctrl==='pulse'?NaN:m.I,il?.avg,'A'],['Δi_L p-p',dI,lastPP('I:L1'),'A'],['P προς ζυγό',S.tut.options.bus==='ideal'?m.P:NaN,editor.comp('VB')?-(pb?.avg??NaN):NaN,'W']]);
  if(S.tut.options.sw==='real'){const q=k=>avgOver(k,5)?.avg;const pc=(q('P:S1')||0)+(q('P:S2')||0),ps=(q('PSW:S1')||0)+(q('PSW:S2')||0),pt=Math.abs(m.P);
   html+=`<h4>Απώλειες διακοπτών (μέσες, τελευταίες 5 T)</h4><ul class="eqs"><li>Αγωγής (MOSFET + δίοδοι σώματος): <b>${eng(pc,'W')}</b> · μεταγωγής: <b>${eng(ps,'W')}</b> · σύνολο <b>${eng(pc+ps,'W')}</b> ≈ ${fmt(100*(pc+ps)/pt,3)} % των ${eng(pt,'W')}</li>
    <li>Μεταγωγή: P_sw = f_s·(E_on + E_off)·(|v|/V_ref)·(|i|/I_ref) ≈ <b>${eng(20e3*2.1e-3*(m.vhi/100)*(Math.abs(m.I)/800),'W')}</b> για |i_L| = ${eng(Math.abs(m.I),'A')}, V = ${eng(m.vhi,'V')}, μόνο στον διακόπτη που μεταγάγεται σκληρά (ο άλλος ανάβει αφού άγει ήδη η δίοδός του)</li></ul>`;}
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
 else if(t.topology==='buck_vloop'){const Vin=+V.V,L=+paramsOf('L1').L,Cc=+paramsOf('C1').C,Rp=paramsOf('R1'),R=+Rp.R,fs=+W.fs,w0=1/Math.sqrt(L*Cc),f0=w0/2/Math.PI,Q=R*Math.sqrt(Cc/L);
  const Kp=+W.Kp,Ki=+W.Ki,Kd=+W.Kd,refS=P.parseSched(W.ref)||[[0,0]],vref=refS[refS.length-1][1],Rs=P.parseSched(Rp.sched),Rend=Rs?Rs[Rs.length-1][1]:R;
  eqs=[`G_vd(s) = V_in/(LC·s² + (L/R)·s + 1): f₀ = 1/(2π√(LC)) = <b>${eng(f0,'Hz')}</b>, Q = R·√(C/L) = <b>${fmt(Q,3)}</b>, G_vd(0) = V_in = ${eng(Vin,'V')}`,
   `Νόμος: d = D₀ + K_p·e + K_i·T_s·Σe${Kd?' + K_d·(e_k − e_{k−1})/T_s (φίλτρο T_f)':''}, με K_p = ${eng(Kp)}, K_i = ${eng(Ki)} 1/s${Kd?`, K_d = ${eng(Kd)} s`:''}, δειγματοληψία στην αρχή κάθε περιόδου (${eng(fs,'Hz')})`,
   Kd?`PID: C(s) ≈ K_i(1 + s/ω_z)²/s με ω_z = √(K_i/K_d) → f_z = <b>${eng(Math.sqrt(Ki/Kd)/2/Math.PI,'Hz')}</b> (≈ 0,7·f₀). Τα μηδενικά αντισταθμίζουν τους πόλους LC, άρα L(s) ≈ K_i·V_in/s και f_c ≈ K_i·V_in/2π = <b>${eng(Ki*Vin/2/Math.PI,'Hz')}</b>`
     :`PI: για ω ≪ ω₀, L(s) ≈ K_i·V_in/s, άρα f_c ≈ K_i·V_in/2π = <b>${eng(Ki*Vin/2/Math.PI,'Hz')}</b>. Στο f₀ η φάση είναι −180° και |L(jω₀)| ≈ Q·V_in·K_i/ω₀ = <b>${fmt(Q*Vin*Ki/w0,3)}</b>: πρέπει να μείνει < 1 (όριο K_i ≈ ${fmt(w0/(Q*Vin),3)}, χωρίς την καθυστέρηση δειγματοληψίας)`,
   `Μόνιμη κατάσταση: ο ολοκληρωτής μηδενίζει το σφάλμα στο σημείο δειγματοληψίας, άρα V_o → V_ref = <b>${eng(vref,'V')}</b> και I_L = V_o/R = <b>${eng(vref/Rend,'A')}</b>. Η μέση τιμή απέχει λίγα mV, γιατί η δειγματοληψία γίνεται σε σταθερό σημείο της κυμάτωσης.`];
  rows=[['V_o (τελικά)',vref,avgOver('V:C1',10)?.avg,'V'],['⟨i_L⟩ (τελικά)',vref/Rend,avgOver('I:L1',10)?.avg,'A']];
  return `<ul class="eqs">${eqs.map(e=>`<li>${e}</li>`).join('')}</ul>${cmpRows(rows)}<h4>Δείκτες από την προσομοίωση</h4>${eventMetricsHTML('V:C1')}`;}
 else if(t.topology==='scr1'){const Vpk=+paramsOf('V1').Vpk,R=+paramsOf('R1').R,rl=!!editor.comp('L1'),q=paramsOf('Q2'),a=(+q?.alpha||0)*Math.PI/180;const vd=nodeAvg('JPR:j',2);
  if(!rl){const Vd=Vpk/Math.PI*(1+Math.cos(a)),Vr=Vpk*Math.sqrt((Math.PI-a+Math.sin(2*a)/2)/(2*Math.PI));
   eqs=[`Ωμικό φορτίο: κάθε θυρίστορ άγει από α έως π, το ρεύμα μηδενίζεται στο τέλος κάθε ημιπεριόδου.`,`V_d = (1/π)∫_α^π V̂ sin θ dθ = (V̂/π)(1 + cos α) = <b>${eng(Vd,'V')}</b>`,
    `V_rms = V̂·√[(π − α + ½ sin 2α)/(2π)] = <b>${eng(Vr,'V')}</b>, I_d = V_d/R = <b>${eng(Vd/R,'A')}</b>, P = V_rms²/R = <b>${eng(Vr*Vr/R,'W')}</b>`];
   rows=[['V_d',Vd,vd?.avg,'V'],['I_d',Vd/R,avgOver('I:R1',2)?.avg,'A'],['V_rms (R)',Vr,avgOver('V:R1',2)?.rms,'V']];}
  else{const Vd=2*Vpk/Math.PI*Math.cos(a),Id=Vd/R;
   eqs=[`Μεγάλη L: το ρεύμα δεν σβήνει, κάθε ζεύγος άγει 180° από α έως π + α και η v_d γίνεται αρνητική μετά το π.`,`V_d = (1/π)∫_α^{π+α} V̂ sin θ dθ = (2V̂/π)·cos α = <b>${eng(Vd,'V')}</b>`,
    `I_d = V_d/R = <b>${eng(Id,'A')}</b>. Ρεύμα πηγής: ορθογώνιο ±I_d, I_s,rms = I_d, θεμελιώδης μετατοπισμένη κατά α: συντελεστής μετατόπισης cos α = ${fmt(Math.cos(a),3)}, PF = 0,9·cos α = <b>${fmt(.9*Math.cos(a),3)}</b>`];
   if(a>=Math.PI/2-1e-9)eqs.push('<i>Για α ≥ 90° χωρίς πηγή στο DC (π.χ. κινητήρα) το ρεύμα σβήνει, η αγωγή γίνεται ασυνεχής και ο τύπος δεν ισχύει.</i>');
   rows=[['V_d',Vd,vd?.avg,'V'],['I_d',Id,avgOver('I:L1',2)?.avg,'A'],['I_s,rms',Id,avgOver('I:V1',2)?.rms,'A']];}}
 else if(t.topology==='bridge3'){const Vpk=+paramsOf('V1').Vpk,R=+paramsOf('R1').R,rl=!!editor.comp('L1'),q=editor.comp('Q1'),scr=q?.type==='SCR',a=scr?(+q.params.alpha||0)*Math.PI/180:0,VLL=Math.sqrt(3)*Vpk/Math.SQRT2;
  const Vd=3*Math.sqrt(3)/Math.PI*Vpk*Math.cos(a),Id=Vd/R;
  eqs=[`V_LL = √3·V̂_φ/√2 = <b>${eng(VLL,'V')}</b> rms. Η v_d ακολουθεί την πολική τάση με τη μεγαλύτερη τιμή: 6 παλμοί ανά περίοδο (${eng(6*(+paramsOf('V1').f),'Hz')}).`,
   `V_d = (3/π)∫_{π/3+α}^{2π/3+α} √3·V̂_φ sin θ dθ = (3√3/π)·V̂_φ·cos α = 1,35·V_LL·cos α = <b>${eng(Vd,'V')}</b>${scr?` (α = ${fmt(a*180/Math.PI,3)}°)`:''}`,
   `I_d = V_d/R = <b>${eng(Id,'A')}</b>${rl?`, I_a,rms = √(2/3)·I_d = <b>${eng(Math.sqrt(2/3)*Id,'A')}</b> (ορθογώνιοι παλμοί 120°)`:''}`];
  if(!rl&&!scr)eqs.push(`Κυμάτωση: από √3·V̂_φ·cos 30° = <b>${eng(1.5*Vpk,'V')}</b> έως √3·V̂_φ = <b>${eng(Math.sqrt(3)*Vpk,'V')}</b>`);
  if(!rl&&a>Math.PI/3)eqs.push('<i>Με ωμικό φορτίο και α > 60° η αγωγή γίνεται ασυνεχής και ο τύπος δεν ισχύει.</i>');
  const vR=avgOver('V:R1',2),vL=rl?avgOver('V:L1',2):null;rows=[['V_d',Vd,vR?vR.avg+(vL?.avg||0):NaN,'V'],['I_d',Id,avgOver('I:R1',2)?.avg,'A']];
  if(rl)rows.push(['I_a,rms',Math.sqrt(2/3)*Id,avgOver('I:V1',2)?.rms,'A']);else if(!scr)rows.push(['v_d min',1.5*Vpk,avgOver('V:R1',2)?.min,'V'],['v_d max',Math.sqrt(3)*Vpk,avgOver('V:R1',2)?.max,'V']);}
 return `<ul class="eqs">${eqs.map(e=>`<li>${e}</li>`).join('')}</ul>${rows.length?cmpRows(rows):''}`;}
function nodeAvg(pin,n){const s=S.sim;if(!s)return null;const nt=s.net.pinNet.get(pin);if(!nt||nt.ground)return null;return avgOver('N:'+nt.canon,n);}

// ------------------------------------------------------------------ math panel
// circuit -> registered-family graph (source, switch, diode, inductor, capacitor, resistor, transformer)
const V1MAP={VDC:['source','Πηγή εισόδου',{p:'p',n:'n'}],SW:['switch','Διακόπτης',{d:'a',s:'b'}],D:['diode','Δίοδος',{a:'a',k:'k'}],L:['inductor','Πηνίο',{a:'a',b:'b'}],
 C:['capacitor','Πυκνωτής εξόδου',{p:'p',n:'n'}],R:['resistor','Φορτίο',{a:'a',b:'b'}],XFMR:['transformer','Μετασχηματιστής (L_m στο πρωτεύον)',null]};
function circuitForMath(){
 const doc=editor.doc;if(!S.sim||S.error)return {error:'Το κύκλωμα δεν προσομοιώνεται· διόρθωσε πρώτα τη συνδεσμολογία.'};
 const par=new Map(),find=k=>{while(par.get(k)!==k){par.set(k,par.get(par.get(k)));k=par.get(k);}return k;};
 for(const c of doc.components)for(const pn of Object.keys(P.PARTS[c.type].pins))par.set(c.id+':'+pn,c.id+':'+pn);
 for(const w of doc.wires){const a=w.a.c+':'+w.a.p,b=w.b.c+':'+w.b.p;if(par.has(a)&&par.has(b))par.set(find(a),find(b));}
 const net={pinNet:{get:k=>par.has(k)?{canon:find(k)}:null}};
 const used=doc.components.filter(c=>V1MAP[c.type]),extra=doc.components.filter(c=>!V1MAP[c.type]&&!['GND','JUNC','PWM'].includes(c.type));
 const why='Η πλήρης συμβολική λύση καλύπτει buck, boost, αντιστρέφοντα buck–boost και flyback με ένα στοιχείο ανά ρόλο.';
 if(extra.length)return {error:why+' Αυτό το κύκλωμα έχει και: '+extra.map(c=>`${P.PARTS[c.type].name} ${c.label||c.id}`).join(', ')+'.'};
 const by={};for(const c of used){(by[c.type]=by[c.type]||[]).push(c);}
 const dup=Object.entries(by).filter(([,v])=>v.length>1);if(dup.length)return {error:why+' Υπάρχουν περισσότερα από ένα: '+dup.map(([k,v])=>`${P.PARTS[k].name} (${v.map(c=>c.label||c.id).join(', ')})`).join('; ')+'.'};
 const comps=[],groups=new Map(),roles=[],notes=[],params={};
 for(const c of used){const [type,role,pm]=V1MAP[c.type];comps.push({id:c.id,type});const p={...P.defaults(c.type),...c.params};
  const pins=c.type==='XFMR'?(p.pol==='opp'?{p1:'p1',p2:'p2',s1:'s2',s2:'s1'}:{p1:'p1',p2:'p2',s1:'s1',s2:'s2'}):pm;
  for(const [sp,vp] of Object.entries(pins)){const n=net.pinNet.get(c.id+':'+sp);const key=n?n.canon:'open:'+c.id+sp;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c.id+':'+vp);}
  let value='';
  if(c.type==='VDC'){params.vin=Math.abs(+p.V);value=eng(+p.V,'V');if(+p.Rs>0)notes.push(`Η εσωτερική αντίσταση της ${c.label||c.id} μετρά μόνο στην προσομοίωση.`);}
  if(c.type==='SW'){const pw=editor.comp(p.pwm);const q=pw?{...P.defaults('PWM'),...pw.params}:null;if(!q)return {error:`Ο διακόπτης ${c.label||c.id} δεν έχει μπλοκ PWM.`};
   if(q.mode!=='fixed')notes.push(`Το ${pw.label||pw.id} είναι σε «${q.mode}»: η ανάλυση χρησιμοποιεί το D = ${fmt(+q.D,4)} των παραμέτρων του.`);
   params.D=+q.D;params.fs=+q.fs;value=`${pw.label||pw.id} · D = ${fmt(+q.D,4)} · f_s = ${eng(+q.fs,'Hz')}`;}
  if(c.type==='D'){value='ιδανική';if(+p.Vf>0)notes.push(`Το V_f της ${c.label||c.id} μετρά μόνο στην προσομοίωση.`);}
  if(c.type==='L'){params.L=+p.L;value=eng(+p.L,'H');if(+p.Rs>0)notes.push(`Η αντίσταση τυλίγματος του ${c.label||c.id} μετρά μόνο στην προσομοίωση.`);}
  if(c.type==='C'){params.C=+p.C;value=eng(+p.C,'F');if(+p.esr>0)notes.push(`Η ESR του ${c.label||c.id} μετρά μόνο στην προσομοίωση.`);}
  if(c.type==='R'){params.R=+p.R;value=eng(+p.R,'Ω');if(p.sched)notes.push(`Το πρόγραμμα R(t) του ${c.label||c.id} αγνοείται: η ανάλυση είναι για R = ${eng(+p.R,'Ω')}.`);}
  if(c.type==='XFMR'){params.L=+p.Lm;params.n=+p.n;value=`n = N₂/N₁ = ${fmt(+p.n,4)} · L_m = ${eng(+p.Lm,'H')}`;}
  roles.push({role,label:c.label||c.id,value});}
 const wires=[];for(const g of groups.values())for(let i=1;i<g.length;i++)wires.push({from:g[0],to:g[i]});
 return {circuit:{components:comps,wires},params,roles,notes};}
let mathToken=0,mathTimer=0;
function scheduleMath(delay=700){clearTimeout(mathTimer);mathTimer=setTimeout(runMath,delay);}
function batteryKey(t){const m=S.tutMeta;if(!m||Math.abs(t.vbus-50)>1e-9)return null;const win=m.above?{min:60,mid:80,max:100}:{min:25,mid:32.5,max:40};return Object.keys(win).find(k=>Math.abs(win[k]-t.vst)<1e-9)||null;}
// solution sources for the current tutorial: code template, data templates, or the circuit itself
function mathChoices(t){const list=(window.Exercises?.allFor?.(t.id)||[]).filter(x=>x.kind!=='code'||S.tutMeta);
 return [...list.filter(x=>x.kind==='code'),{kind:'circuit',id:'circuit',title:'Από το κύκλωμα (αναγνώριση τοπολογίας)'},...list.filter(x=>x.kind==='data')];}
function renderMathChoices(t){const sel=$('#math-tpl');const list=mathChoices(t);const cur=S.mathChoice?.[t.id];const pick=list.find(x=>x.id===cur)||list[0];
 sel.innerHTML=list.map(x=>`<option value="${esc(x.id)}" ${x.id===pick.id?'selected':''}>${esc(x.kind==='code'?'Engine · '+x.title:x.kind==='data'?'Template δεδομένων · '+x.title:x.title)}</option>`).join('');sel.hidden=list.length<2;return pick;}
async function runTemplate(t,ch,box,src,token){const tpl=ch.template;S.tplOverrides=S.tplOverrides||{};const ov=S.tplOverrides[tpl.id]||{};
 const {vals,src:from}=Exercises.resolveInputs(tpl,{meta:S.tutMeta,param:paramsOf,overrides:ov});
 src.textContent=`template δεδομένων «${tpl.id}» (${ch.src}) · ${Object.values(from).filter(x=>x!=='προεπιλογή').length} είσοδοι από κύκλωμα/tutorial`;
 const r=await api('template_solve',{template:tpl,values:vals});if(token!==mathToken)return;
 MathPanel.renderTemplate(box,r,{src:from,onInput:(n,v)=>{(S.tplOverrides[tpl.id]=S.tplOverrides[tpl.id]||{})[n]=v;runMath();},onReset:()=>{delete S.tplOverrides[tpl.id];runMath();},
  onDownload:()=>download(tpl.id+'.template.json',JSON.stringify(tpl,null,1))});}
async function runMath(){
 const t=tutorial(),box=$('#math'),src=$('#math-src'),token=++mathToken;
 try{
  const ch=renderMathChoices(t);
  if(ch.kind==='data'){await runTemplate(t,ch,box,src,token);return;}
  const ex=ch.kind==='code'?ch.code:null;
  if(ex&&S.tutMeta){src.textContent=`από τα δεδομένα της άσκησης (template «${ex.id}») · σημείο λειτουργίας από τις επιλογές του tutorial`;
   const r=await api(ex.engine.action,ex.engine.request(S.tutMeta));if(token!==mathToken)return;
   const ctx={meta:S.tutMeta,test:null,canLoad:x=>!!batteryKey(x),onLoad:x=>{const k=batteryKey(x);if(!k)return;loadTutorial('battery',{...S.tut.options,vst:k,dir:x.p_bus>0?'dis':'chg',ctrl:'fixed',bus:'ideal'},true);$('.bench').scrollIntoView({behavior:'smooth'});}};
   ctx.test=ex.pickTest(r,ctx);MathPanel.renderExercise(box,ex,r,ctx);return;}
  const conv=circuitForMath();
  if(conv.error){src.textContent='από το κύκλωμα';box.innerHTML=`<p class="muted">${esc(conv.error)}</p>`+(t.theory==='formula'?`<h4>Βασικές σχέσεις για αυτό το κύκλωμα</h4>`+formulaTheory(t):'');return;}
  src.textContent='από το κύκλωμα · '+conv.roles.map(r=>r.label).join(', ');
  const B=await api('studio_math',{circuit:conv.circuit,params:conv.params});if(token!==mathToken)return;
  MathPanel.renderConverter(box,B,conv.roles,[...conv.notes,...(B.notes||[])]);
 }catch(e){if(token!==mathToken)return;box.innerHTML=`<p class="bad">Δεν υπολογίστηκε: ${esc(e.message)}</p>${location.protocol==='file:'?'<p>Άνοιξε την εφαρμογή μέσω <code>python run.py</code>.</p>':''}`;}
}
window.addEventListener('resize',()=>{clearTimeout(window.__mr);window.__mr=setTimeout(()=>MathPanel.redraw($('#math')),200);});

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
  onchange:kind=>{if(kind==='struct'||kind==='param'){if(S.batch)S.batch.stale=true;buildSim(false);if(S.theory)setTimeout(()=>{if(tutorial().theory==='v1'||tutorial().theory==='formula')runTheory();},50);scheduleMath();}saveLocal();if(kind==='struct')renderChannels();},
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
 ['#rm-sig','#rm-ev','#rm-ref','#rm-band','#rm-val','#rm-t'].forEach(q=>$(q).onchange=renderMetricsPanel);$('#rm-block').ontoggle=renderMetricsPanel;
 $('#bt-run').onclick=runBatch;$('#bt-clear').onclick=clearBatch;$('#bt-show').onchange=e=>{scope.setRefs(e.target.checked&&S.batch?{label:S.batch.label,data:S.batch.data}:null);};
 $('#bt-block').ontoggle=()=>{if($('#bt-block').open&&!$('#bt-tend').value&&S.sim)$('#bt-tend').placeholder=S.sim.t>0?String(+(S.sim.t*1e3).toPrecision(5)):S.stopT?String(+(S.stopT*1e3).toPrecision(5)):'ms';};
 $('#live-btn').onclick=()=>{scope.cfg.frozen=null;$('#live-btn').hidden=true;draw(true);};
 const navOpen=v=>{$('#scope-nav').hidden=!v;$('#nav-toggle').setAttribute('aria-expanded',v);$('#nav-toggle').classList.toggle('on',v);try{localStorage.setItem('pcl2-nav',v?'1':'0');}catch{}scope.resize();};
 $('#nav-toggle').onclick=()=>navOpen($('#scope-nav').hidden);try{navOpen(localStorage.getItem('pcl2-nav')!=='0');}catch{navOpen(true);}
 $$('#scope-nav [data-nav]').forEach(b=>b.onclick=()=>{scope.nav(b.dataset.nav);$('#live-btn').hidden=!scope.cfg.frozen;$('#nav-follow').classList.toggle('on',scope.cfg.follow!==false);syncScopeInputs();renderChannels();draw(true);});
 const METHOD_NOTE={TR:'2ης τάξης, χωρίς απόσβεση',BDF2:'2ης τάξης, απόσβεση στις υψηλές συχνότητες',BE:'1ης τάξης, ισχυρή απόσβεση'};
 $('#method').onchange=e=>{S.sim?.setMethod(e.target.value);$('#method-note').textContent=METHOD_NOTE[e.target.value];saveLocal();};
 $('#add-signal').onchange=e=>{if(e.target.value)addProbe(e.target.value);e.target.value='';};
 const probeSel=pre=>{const ids=editor.selection().c.filter(id=>{const c=editor.comp(id);return c&&signalsFor(c).some(([p])=>p===pre);});if(!ids.length){notice('Επίλεξε πρώτα στοιχεία στο κύκλωμα (κλικ ή ορθογώνιο).','info');setTimeout(()=>notice(''),2500);return;}ids.forEach(id=>addProbe(pre+id));};
 $('#probe-i').onclick=()=>probeSel('I:');$('#probe-v').onclick=()=>probeSel('V:');
 $('#csv').onclick=exportCSV;$('#clear-cursors').onclick=()=>{scope.cfg.cursors=[];draw(true);};
 $('#fit').onclick=()=>editor.fit();$('#undo').onclick=()=>editor.undo();$('#redo').onclick=()=>editor.redo();$('#rot').onclick=()=>editor.rotateSel();$('#del').onclick=()=>editor.deleteSel();
 $('#tutorials').onclick=()=>gallery(true);$('#gallery-close').onclick=()=>gallery(false);
 $('#open-settings').onclick=openSettings;$('#settings-close').onclick=()=>$('#settings').hidden=true;
 $('#theory-refresh').onclick=()=>runTheory();$('#math-refresh').onclick=()=>runMath();
 $('#math-tpl').onchange=e=>{S.mathChoice=S.mathChoice||{};S.mathChoice[tutorial().id]=e.target.value;runMath();};
 $('#math-open').onclick=()=>$('#tpl-file').click();
 $('#tpl-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const tpl=JSON.parse(await f.text());const r=Exercises.registerData(tpl,'αρχείο '+f.name,true);S.mathChoice=S.mathChoice||{};S.mathChoice[tutorial().id]=r.id;runMath();$('#math-card').scrollIntoView({behavior:'smooth'});}catch(err){notice('Template: '+esc(err.message),'error');}e.target.value='';};
 Exercises.load().then(()=>runMath());
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
 const qs=new URLSearchParams(location.search),want=qs.get('tutorial');let imp=null;
 if(qs.get('import')){try{imp=JSON.parse(localStorage.getItem('pcl2-import'));localStorage.removeItem('pcl2-import');}catch{}history.replaceState(null,'',location.pathname);}
 if(imp&&Array.isArray(imp.components)){S.tut=imp.tutorial||{id:'empty',options:{}};S.tutMeta=null;applyProject(imp);renderTutorial();runTheory();runMath();notice('Άνοιξε το κύκλωμα από τον αναλυτικό πάγκο '+esc(imp.from||'')+'. Οι αρχικές συνθήκες είναι της μόνιμης κατάστασης που υπολόγισε.','info');setTimeout(()=>notice(''),6000);}
 else if(want&&Tutorials.get(want))loadTutorial(want);
 else if(st&&Array.isArray(st.components)){S.tut=st.tutorial||{id:'empty',options:{}};const t=Tutorials.get(S.tut.id);if(t&&S.tut.id!=='empty'){const pr=t.build({...Object.fromEntries(t.options.map(o=>[o.k,o.def])),...S.tut.options});S.tutMeta=pr.meta||null;}applyProject(st);renderTutorial();runTheory();runMath();}
 else loadTutorial('buck');
 fetch('/api/health').then(r=>r.json()).then(h=>{$('#engine').textContent='Engine '+h.version;$('#engine').classList.add('ok');}).catch(()=>{$('#engine').textContent='Χωρίς server: μόνο προσομοίωση';});
 setInterval(()=>{if(S.theory&&(S.running||S.frame))renderTheoryLive();},1000);
}
function renderTheoryLive(){if(document.querySelector('#theory details[open]'))return;renderTheory();}
window.addEventListener('DOMContentLoaded',boot);
window.PCL={get S(){return S;},get editor(){return editor;},get scope(){return scope;},loadTutorial,addProbe,play,pause,reset};
})();
