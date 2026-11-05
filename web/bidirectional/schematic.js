'use strict';
// Fixed schematic of the bidirectional half-bridge, drawn for either storage
// position. Current-flow arrows and the active conduction loop are updated
// without rebuilding the SVG (so double-click always hits its target).
window.Schematic=class Schematic{
 constructor(holder,{onedit}){
  this.holder=holder;this.onedit=onedit;this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  this.svg.setAttribute('viewBox','0 0 1000 470');this.svg.setAttribute('role','img');this.svg.setAttribute('aria-label','Σχηματικό αμφίδρομου μετατροπέα. Διπλό κλικ σε στοιχείο για τιμές.');
  holder.replaceChildren(this.svg);this.refs={};this.lastTap=null;
  this.svg.addEventListener('pointerup',e=>{const el=e.target.closest('[data-part]');if(!el)return;const now=performance.now(),id=el.dataset.part;
   if(this.lastTap&&this.lastTap.id===id&&now-this.lastTap.time<420){this.lastTap=null;this.onedit(id,el.getBoundingClientRect());}else this.lastTap={id,time:now};});
  this.svg.addEventListener('keydown',e=>{const el=e.target.closest?.('[data-part]');if(el&&e.key==='Enter'){e.preventDefault();this.onedit(el.dataset.part,el.getBoundingClientRect());}});
 }
 // geometry: rails and positions depend on which side is low.
 render(v){
  this.v=v;const above=v.position==='above',sys=v.bus==='system';
  const Y={hi:80,mid:230,ret:390},X={leg:640,L0:470,L1:610,node:430,hiX:880};
  const nf=(x,d=3)=>Number(Number(x).toPrecision(d)).toLocaleString('el-GR');const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let h=`<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
   <marker id="arrBig" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
   <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#d4ddd6"/></pattern></defs>
   <rect x="0" y="0" width="1000" height="470" fill="url(#grid)"/>`;
  const wire=d=>`<path class="w" d="${d}"/>`;
  const label=(x,y,t,cls='lbl',anchor='middle')=>`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(t)}</text>`;
  const part=(id,x,y,w,hgt,inner,title)=>`<g class="part" data-part="${id}" tabindex="0" role="button" aria-label="${esc(title)} · διπλό κλικ για τιμές"><rect class="hit" x="${x-w/2}" y="${y-hgt/2}" width="${w}" height="${hgt}" rx="8"/>${inner}<title>${esc(title)} · διπλό κλικ για τιμές</title></g>`;
  const src=(id,x,y0,y1,name,val,title,under)=>{const cy=(y0+y1)/2;return wire(`M${x},${y0} V${cy-26} M${x},${cy+26} V${y1}`)+part(id,x,cy,70,80,`<circle class="sh" cx="${x}" cy="${cy}" r="24"/><path class="sh" d="M${x-7},${cy-8} H${x+7} M${x},${cy-15} V${cy-1} M${x-7},${cy+11} H${x+7}"/>`,title)+(under?label(x-6,cy+46,name,'lbl')+label(x-6,cy+62,val,'val'):label(x-34,cy-4,name,'lbl','end')+label(x-34,cy+12,val,'val','end'));};
  const cap=(id,x,y0,y1,name,val,esr)=>{const cy=(y0+y1)/2;return wire(`M${x},${y0} V${cy-8} M${x},${cy+8} V${y1}`)+part(id,x,cy,60,90,`<path class="sh" d="M${x-20},${cy-8} H${x+20} M${x-20},${cy+8} H${x+20}"/>${esr?`<rect class="sh" x="${x-5}" y="${cy+22}" width="10" height="22"/>`:''}`,name)+label(x+28,cy-6,name,'lbl','start')+label(x+28,cy+10,val,'val','start');};
  const res=(id,x,y0,y1,name,val,faded)=>{const cy=(y0+y1)/2;return `<g class="${faded?'faded':''}">`+wire(`M${x},${y0} V${cy-30} M${x},${cy+30} V${y1}`)+part(id,x,cy,60,90,`<path class="sh" d="M${x},${cy-30} l-9,5 18,10 -18,10 18,10 -18,10 9,5"/>`,name)+label(x+22,cy-4,name,'lbl','start')+label(x+22,cy+12,val,'val','start')+'</g>';};
  const sw=(id,x,y0,y1,name,val)=>{const cy=(y0+y1)/2;return wire(`M${x},${y0} V${cy-26} M${x},${cy+26} V${y1}`)+part(id,x,cy,80,80,`<path class="sh blade-open" d="M${x},${cy-26} L${x+16},${cy+20}"/><path class="sh blade-closed" d="M${x},${cy-26} V${cy+26}"/><circle class="dot" cx="${x}" cy="${cy-26}" r="2.5"/><circle class="dot" cx="${x}" cy="${cy+26}" r="2.5"/><path class="sh thin" d="M${x-26},${cy+6} V${cy-6} M${x-32},${cy+6} H${x-20} M${x-26},${cy-6} l-6,8 h12 z"/>`,name)+label(x+24,cy-10,name,'lbl','start')+label(x+24,cy+6,val,'val','start');};
  // ---- low side
  const lo={},hi={};
  if(above){
   const sx=110;
   h+=src('src',sx,Y.mid,Y.ret,sys?'V_src':'V_bus',sys?`${v.V_src} V`:`${v.vbus_sim} V ιδανική`,sys?'Κύρια πηγή (μονόδρομη)':'Ιδανική πηγή ζυγού (δοκιμή PLECS)');
   if(sys){h+=wire(`M${sx},${Y.mid} H150`)+part('rsrc',175,Y.mid,56,40,`<rect class="sh" x="153" y="${Y.mid-8}" width="44" height="16"/>`,'R_src')+wire(`M197,${Y.mid} H222`)+part('src',240,Y.mid,40,40,`<path class="sh" d="M228,${Y.mid-12} L252,${Y.mid} L228,${Y.mid+12} Z M252,${Y.mid-12} V${Y.mid+12}"/>`,'Δίοδος μονόδρομης πηγής')+wire(`M252,${Y.mid} H${X.node}`)+label(175,Y.mid+30,'R_src','lbl')+label(175,Y.mid+46,`${nf(v.R_src*1e3)} mΩ`,'val');}
   else h+=wire(`M${sx},${Y.mid} H${X.node}`);
   h+=cap('cbus',290,Y.mid,Y.ret,'C_bus',`${nf(v.C_bus*1e3)} mF`,true)+label(318,(Y.mid+Y.ret)/2+28,`ESR ${nf(v.ESR*1e3,2)} mΩ`,'val','start');
   h+=res('load',410,Y.mid,Y.ret,'Φορτίο',sys?`${nf(v.P_load/1e3)} kW`:'όχι στο τεστ',!sys);
   lo.portX=X.node;lo.loopX=sys?290:sx;
   h+=label(170,42,'ΖΥΓΟΣ DC · χαμηλή πλευρά','side');
  }else{
   h+=src('st',150,Y.mid,Y.ret,'V_st',`${v.vst_sim} V`,'Αποθήκευση (πηγή τάσης)');
   h+=wire(`M150,${Y.mid} H${X.node}`);lo.portX=X.node;lo.loopX=150;
   h+=label(170,42,'ΑΠΟΘΗΚΕΥΣΗ · χαμηλή πλευρά','side');
  }
  h+=wire(`M${X.node},${Y.mid} H${X.L0}`)+wire(`M${X.L1},${Y.mid} H${X.leg}`);
  // ---- inductor and leg
  h+=part('L',540,Y.mid,170,70,`<path class="sh" d="M${X.L0},${Y.mid} c0,-26 22,-26 22,0 c0,-26 22,-26 22,0 c0,-26 22,-26 22,0 c0,-26 22,-26 22,0 c0,-26 22,-26 22,0 c0,-26 22,-26 22,0 c0,-26 8,-26 8,0"/>`,'Πηνίο L')+label(540,Y.mid+34,'L','lbl')+label(540,Y.mid+50,`${nf(v.L*1e6)} μH`,'val');
  h+=sw('S1',X.leg,Y.hi,Y.mid,'S1','1 − D')+sw('S2',X.leg,Y.mid,Y.ret,'S2','D');
  h+=`<circle class="node" cx="${X.leg}" cy="${Y.mid}" r="4"/>`+label(X.leg+14,Y.mid-8,'μέσο','tiny','start');
  // ---- high side
  if(above){
   h+=wire(`M${X.leg},${Y.hi} H${X.hiX}`)+src('st',X.hiX,Y.hi,Y.ret,'V_st',`${v.vst_sim} V`,'Αποθήκευση (πηγή τάσης)');hi.loopX=X.hiX;
   h+=label(850,42,'ΑΠΟΘΗΚΕΥΣΗ · υψηλή πλευρά','side');
  }else{
   h+=wire(`M${X.leg},${Y.hi} H${sys?856:960}`);
   h+=cap('cbus',700,Y.hi,Y.ret,'C_bus',`${nf(v.C_bus*1e3)} mF`,true)+label(728,(Y.hi+Y.ret)/2+28,`ESR ${nf(v.ESR*1e3,2)} mΩ`,'val','start');
   h+=res('load',830,Y.hi,Y.ret,'Φορτίο',sys?`${nf(v.P_load/1e3)} kW`:'όχι στο τεστ',!sys);
   if(sys){h+=part('src',868,Y.hi,40,40,`<path class="sh" d="M880,${Y.hi-12} L856,${Y.hi} L880,${Y.hi+12} Z M856,${Y.hi-12} V${Y.hi+12}"/>`,'Δίοδος μονόδρομης πηγής')+wire(`M880,${Y.hi} H892`)+part('rsrc',912,Y.hi,50,40,`<rect class="sh" x="892" y="${Y.hi-8}" width="40" height="16"/>`,'R_src')+wire(`M932,${Y.hi} H960`)+label(912,Y.hi-14,`R_src ${nf(v.R_src*1e3)} mΩ`,'val')+src('src',960,Y.hi,Y.ret,'V_src',`${v.V_src} V`,'Κύρια πηγή (μονόδρομη)',true);hi.loopX=700;}
   else{h+=src('src',960,Y.hi,Y.ret,'V_bus',`${v.vbus_sim} V ιδανική`,'Ιδανική πηγή ζυγού (δοκιμή PLECS)',true);hi.loopX=960;}
   h+=label(850,42,'ΖΥΓΟΣ DC · υψηλή πλευρά','side');
  }
  h+=wire(`M${above?110:150},${Y.ret} H${above?X.hiX:960}`);
  h+=label(500,Y.ret+30,'κοινή επιστροφή (0 V)','tiny');
  // ---- dynamic overlays: conduction loops and arrows
  const loop2=`M${lo.loopX},${Y.ret} V${Y.mid} H${X.leg} V${Y.ret} H${lo.loopX}`;
  const loop1=`M${lo.loopX},${Y.ret} V${Y.mid} H${X.leg} V${Y.hi} H${hi.loopX} V${Y.ret} H${lo.loopX}`;
  h+=`<path id="loopS2" class="loop" d="${loop2}"/><path id="loopS1" class="loop" d="${loop1}"/>`;
  h+=`<g id="aIL" class="flow il"><path d="M480,180 H600" marker-end="url(#arr)"/><text x="540" y="170" text-anchor="middle"></text></g>`;
  h+=`<g id="aBus" class="flow bus"><path d="" marker-end="url(#arr)"/><text text-anchor="middle"></text></g>`;
  h+=`<g id="aSt" class="flow st"><path d="" marker-end="url(#arr)"/><text text-anchor="middle"></text></g>`;
  h+=`<g id="aSrc" class="flow src"><path d="" marker-end="url(#arr)"/><text text-anchor="middle"></text></g>`;
  h+=`<g id="aLoad" class="flow load"><path d="" marker-end="url(#arr)"/><text text-anchor="middle"></text></g>`;
  h+=`<g id="aP" class="pflow"><path d="M380,33 H610"/><polygon points="610,23 632,33 610,43"/><text x="500" y="15" text-anchor="middle"></text></g>`;
  h+=`<text id="liveS1" class="live" x="${X.leg+24}" y="${(Y.hi+Y.mid)/2+24}"></text><text id="liveS2" class="live" x="${X.leg+24}" y="${(Y.mid+Y.ret)/2+24}"></text><text id="liveVL" class="live" x="540" y="${Y.mid+68}" text-anchor="middle"></text>`;
  this.svg.innerHTML=h;this.geo={Y,X,lo,hi,above,sys};
  for(const id of ['loopS1','loopS2','aIL','aBus','aSt','aSrc','aLoad','aP','liveS1','liveS2','liveVL'])this.refs[id]=this.svg.querySelector('#'+id);
 }
 arrow(id,x0,y0,x1,y1,text,show=true,tx,ty){
  const g=this.refs[id];if(!g)return;g.style.display=show?'':'none';if(!show)return;
  g.querySelector('path').setAttribute('d',`M${x0},${y0} L${x1},${y1}`);const t=g.querySelector('text');t.textContent=text;
  t.setAttribute('x',tx??(x0+x1)/2);t.setAttribute('y',ty??(Math.min(y0,y1)-8));
 }
 // s: {i, s2 (bool|null), vbus, vst, vL, isrc, iload, pbus, mode:'avg'|'inst'}
 update(s){
  if(!this.geo)return;const {Y,X,above,sys}=this.geo,fmt=x=>Number.isFinite(x)?Number(x.toPrecision(4)).toLocaleString('el-GR'):'—';
  const i=s.i,pos=i>=0,mag=Math.abs(i);
  // inductor arrow: positive = low side -> midpoint
  this.arrow('aIL',pos?480:600,190,pos?600:480,190,`i_L ${s.mode==='avg'?'⌀ ':''}${fmt(i)} A`,mag>1e-6||s.mode==='avg',540,175);
  // bus and storage port currents (averages): direction of power
  const pb=s.pbus;const dis=pb>0;
  if(above){
   this.arrow('aBus',dis?X.node:X.node-80,Y.mid-16,dis?X.node-80:X.node,Y.mid-16,`I_bus ${fmt(Math.abs(s.ibus))} A`,Math.abs(s.ibus)>1e-6,X.node-40,Y.mid-24);
   this.arrow('aSt',dis?X.hiX-10:X.hiX-90,Y.hi+18,dis?X.hiX-90:X.hiX-10,Y.hi+18,`I_st ${fmt(Math.abs(s.ist))} A`,Math.abs(s.ist)>1e-6,X.hiX-50,Y.hi+38);
  }else{
   this.arrow('aSt',dis?190:300,Y.mid-16,dis?300:190,Y.mid-16,`I_st ${fmt(Math.abs(s.ist))} A`,Math.abs(s.ist)>1e-6,245,Y.mid-24);
   this.arrow('aBus',dis?650:708,Y.hi-14,dis?708:650,Y.hi-14,`I_bus ${fmt(Math.abs(s.ibus))} A`,Math.abs(s.ibus)>1e-6,679,Y.hi-22);
  }
  if(sys){
   if(above)this.arrow('aSrc',150,Y.mid-22,215,Y.mid-22,`i_src ${fmt(s.isrc)} A`,s.isrc>1,182,Y.mid-30);
   else this.arrow('aSrc',954,Y.hi+20,884,Y.hi+20,`i_src ${fmt(s.isrc)} A`,s.isrc>1,910,Y.hi+40);
   const lx=above?410:830,ly=above?Y.mid:Y.hi;this.arrow('aLoad',lx-14,ly+12,lx-14,ly+46,`${fmt(s.iload)} A`,s.iload>1,lx-48,ly+34);
  }else{this.arrow('aSrc',0,0,0,0,'',false);this.arrow('aLoad',0,0,0,0,'',false);}
  // power banner: low <-> high
  const lowToHigh=i>=0,pk=Math.abs(pb)/1e3;
  const g=this.refs.aP;g.style.display=pk>1e-3?'':'none';g.querySelector('path').setAttribute('d',lowToHigh?'M380,33 H610':'M620,33 H390');g.querySelector('polygon').setAttribute('points',lowToHigh?'610,23 632,33 610,43':'390,23 368,33 390,43');
  g.querySelector('text').textContent=`${pb>0?'Εκφόρτιση':'Φόρτιση'} · ${fmt(pk)} kW · ${pb>0?'αποθήκευση → ζυγός':'ζυγός → αποθήκευση'} · ${s.modeName||''}`;
  g.setAttribute('class','pflow '+(pb>0?'dis':'chg'));
  // conduction loop (instantaneous only)
  const L1=this.refs.loopS1,L2=this.refs.loopS2;
  if(s.s2===null||s.s2===undefined){L1.setAttribute('class','loop');L2.setAttribute('class','loop');}
  else{L2.setAttribute('class','loop'+(s.s2?' on':'')+(i<0?' rev':''));L1.setAttribute('class','loop'+(!s.s2?' on':'')+(i<0?' rev':''));}
  this.svg.classList.toggle('st-S2',s.s2===true);this.svg.classList.toggle('st-S1',s.s2===false);
  this.refs.liveS1.textContent=s.s2===null||s.s2===undefined?'':(s.s2?'S1 OFF':'S1 ON');this.refs.liveS2.textContent=s.s2===null||s.s2===undefined?'':(s.s2?'S2 ON':'S2 OFF');
  this.refs.liveVL.textContent=Number.isFinite(s.vL)?`v_L = ${fmt(s.vL)} V`:'';
 }
};
