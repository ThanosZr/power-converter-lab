'use strict';
// Electrical graph editor. Positions are presentation data; wires are physics.
// v1: double-click (or Enter on a selected part) opens the component inspector;
// ON/OFF/IDLE highlighting and live values are CSS/text updates, so a running
// simulation never rebuilds the SVG (which would swallow clicks and drags).
window.CircuitEditor=class CircuitEditor{
 static ports={source:{p:[0,-40],n:[0,40]},switch:{a:[-45,0],b:[45,0]},diode:{a:[-40,0],k:[40,0]},inductor:{a:[-45,0],b:[45,0]},capacitor:{p:[0,-40],n:[0,40]},resistor:{a:[0,-40],b:[0,40]},transformer:{p1:[-45,-50],p2:[-45,50],s1:[45,50],s2:[45,-50]}};
 static templates={
  buck:{source:['in','g'],switch:['in','sw'],diode:['g','sw'],inductor:['sw','out'],capacitor:['out','g'],resistor:['out','g']},
  boost:{source:['in','g'],switch:['sw','g'],diode:['sw','out'],inductor:['in','sw'],capacitor:['out','g'],resistor:['out','g']},
  buck_boost:{source:['in','g'],switch:['in','sw'],diode:['out','sw'],inductor:['sw','g'],capacitor:['g','out'],resistor:['out','g']},
  flyback:{source:['in','pg'],switch:['psw','pg'],diode:['sec','out'],transformer:['in','psw','sg','sec'],capacitor:['out','sg'],resistor:['out','sg']}};
 static names={source:'Πηγή',switch:'Διακόπτης',diode:'Δίοδος',inductor:'Πηνίο',capacitor:'Πυκνωτής',resistor:'Φορτίο',transformer:'Μετασχ. flyback'};
 constructor(holder,{values,onchange,onedit,onselect}){
  this.holder=holder;this.values=values;this.onchange=onchange;this.onedit=onedit;this.onselect=onselect||(()=>{});
  this.components=[];this.wires=[];this.history=[];this.interval='ALL';this.selected=null;this.pending=null;this.view={x:0,y:0,w:1000,h:430};this.liveRefs=new Map();this.lastTap=null;
  this.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');this.svg.setAttribute('tabindex','0');this.svg.setAttribute('aria-label','Επεξεργαστής κυκλώματος. Διπλό κλικ σε στοιχείο: παράμετροι. Σύρε στοιχεία, κλικ σε δύο ακροδέκτες για καλώδιο. R: περιστροφή, Delete: διαγραφή.');this.holder.replaceChildren(this.svg);
  this.svg.addEventListener('pointerdown',e=>this.down(e));this.svg.addEventListener('pointermove',e=>this.move(e));this.svg.addEventListener('pointerup',e=>this.up(e));this.svg.addEventListener('pointercancel',e=>this.up(e));
  this.svg.addEventListener('wheel',e=>{e.preventDefault();const p=this.point(e),factor=e.deltaY>0?1.12:1/1.12;this.zoom(factor,p);},{passive:false});
  this.svg.addEventListener('keydown',e=>{
   if(e.key==='Escape'){this.pending=null;this.selected=null;this.render();}
   if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.remove();}
   if(e.key.toLowerCase()==='r'&&!e.ctrlKey){e.preventDefault();this.rotate();}
   if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();this.undo();}
   if(e.key==='Enter'){if(e.target.dataset?.port)this.port(e.target.dataset.port);else if(this.selected?.component)this.openEditor(this.selected.component);}
  });
  // Native dblclick as a fallback (e.g. assistive tech); the main path is up().
  this.svg.addEventListener('dblclick',e=>{const el=document.elementFromPoint(e.clientX,e.clientY)?.closest?.('[data-comp]');if(el&&!this.lastOpened)this.openEditor(el.dataset.comp,e);this.lastOpened=false;});
  new ResizeObserver(()=>{if(!this.userView&&!this.drag)this.fit();}).observe(this.holder);
  this.holder.addEventListener('dragover',e=>e.preventDefault());this.holder.addEventListener('drop',e=>{e.preventDefault();const type=e.dataTransfer.getData('application/pcl-component');if(CircuitEditor.ports[type]){const p=this.point(e);this.add(type,p.x,p.y);}});
 }
 esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 snapshot(){return JSON.stringify({components:this.components,wires:this.wires});}
 remember(){this.history.push(this.snapshot());if(this.history.length>60)this.history.shift();}
 export(){return JSON.parse(this.snapshot());}
 find(type){return this.components.find(c=>c.type===type);}
 load(data,remember=true){
  if(!data||!Array.isArray(data.components)||!Array.isArray(data.wires)||data.components.length>30||data.wires.length>100)throw Error('Μη έγκυρο σχέδιο κυκλώματος.');
  const components=data.components.map(c=>{if(!CircuitEditor.ports[c.type]||typeof c.id!=='string'||c.id.includes(':')||!Number.isFinite(c.x)||!Number.isFinite(c.y))throw Error('Μη έγκυρο στοιχείο κυκλώματος.');return {id:c.id,type:c.type,x:c.x,y:c.y,rotation:Number.isFinite(c.rotation)?((Math.round(c.rotation/90)*90)%360+360)%360:0};});
  const pins=new Set(components.flatMap(c=>Object.keys(CircuitEditor.ports[c.type]).map(p=>c.id+':'+p)));
  const wires=data.wires.map(w=>{if(!pins.has(w.from)||!pins.has(w.to))throw Error('Μη έγκυρο καλώδιο.');return {from:w.from,to:w.to};});
  if(remember)this.remember();this.components=components;this.wires=wires;this.pending=null;this.selected=null;this.render();
 }
 template(key){
  const definitions=CircuitEditor.templates[key];if(!definitions)return;
  const coords={source:[100,225,0],switch:[300,100,0],diode:[520,100,0],inductor:[460,100,0],capacitor:[700,225,0],resistor:[880,225,0],transformer:[390,200,0]};
  // Bottom row sits 165 px below the top row so labels never overlap.
  if(key!=='flyback'){coords.source[1]=265;coords.capacitor[1]=265;coords.resistor[1]=265;}
  if(key==='buck'){coords.inductor=[480,100,0];coords.diode=[350,265,-90];}
  if(key==='boost'){coords.inductor=[280,100,0];coords.switch=[430,265,90];}
  if(key==='buck_boost'){coords.inductor=[365,265,90];coords.diode=[520,100,180];coords.capacitor=[700,265,180];}
  if(key==='flyback'){coords.switch=[260,300,90];coords.diode=[560,150,0];coords.capacitor=[700,225,0];}
  const components=[],groups={};
  for(const [type,nodes] of Object.entries(definitions)){
   const [x,y,rotation]=coords[type];const id=({source:'Vin',switch:'S',diode:'D',inductor:'L',capacitor:'C',resistor:'R',transformer:'T'})[type]+'1';components.push({id,type,x,y,rotation:(rotation+360)%360});
   Object.keys(CircuitEditor.ports[type]).forEach((p,i)=>{(groups[nodes[i]]??=[]).push(id+':'+p);});
  }
  const wires=Object.values(groups).flatMap(pins=>pins.slice(1).map((pin,i)=>({from:pins[i],to:pin})));
  this.load({components,wires});this.resetView();
 }
 clear(){this.remember();this.components=[];this.wires=[];this.pending=null;this.selected=null;this.render();this.onchange(true);}
 undo(){if(this.history.length){this.load(JSON.parse(this.history.pop()),false);this.onchange(true);}}
 add(type,x=490,y=230){if(!CircuitEditor.ports[type])return;this.remember();let i=1;while(this.components.some(c=>c.id===type+i))i++;this.components.push({id:type+i,type,x,y,rotation:0});this.selected={component:type+i};this.render();this.onchange(true);}
 remove(){if(!this.selected)return;this.remember();if(this.selected.component){const id=this.selected.component;this.components=this.components.filter(c=>c.id!==id);this.wires=this.wires.filter(w=>!w.from.startsWith(id+':')&&!w.to.startsWith(id+':'));}else if(this.selected.wire!==undefined)this.wires.splice(this.selected.wire,1);this.selected=null;this.pending=null;this.render();this.onchange(true);}
 rotate(){const c=this.components.find(c=>c.id===this.selected?.component);if(c){this.remember();c.rotation=(c.rotation+90)%360;this.render();this.onchange(false);}}
 resetView(){this.fit();}
 // Fit the drawing to the pane, matching its aspect ratio (no letterboxing).
 fit(){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const c of this.components){x0=Math.min(x0,c.x-85);x1=Math.max(x1,c.x+85);y0=Math.min(y0,c.y-95);y1=Math.max(y1,c.y+115);}
  if(!Number.isFinite(x0)){x0=0;y0=0;x1=1000;y1=430;}
  const r=this.holder.getBoundingClientRect(),aspect=r.width>20&&r.height>20?r.width/r.height:1000/430;
  let w=Math.max(x1-x0,420),h=Math.max(y1-y0,260);x0=(x0+x1)/2-w/2;y0=(y0+y1)/2-h/2;
  if(w/h<aspect){const nw=h*aspect;x0-=(nw-w)/2;w=nw;}else{const nh=w/aspect;y0-=(nh-h)/2;h=nh;}
  this.view={x:x0,y:y0,w,h};this.userView=false;this.render();
 }
 zoom(factor,p){this.userView=true;if(!p)p={x:this.view.x+this.view.w/2,y:this.view.y+this.view.h/2};const w=Math.min(3000,Math.max(350,this.view.w*factor));factor=w/this.view.w;this.view={x:p.x+(this.view.x-p.x)*factor,y:p.y+(this.view.y-p.y)*factor,w,h:this.view.h*factor};this.render();}
 point(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());}
 // Screen rectangle of a component, for placing the inspector next to it.
 screenBox(id){const c=this.components.find(c=>c.id===id);if(!c)return null;const m=this.svg.getScreenCTM();if(!m)return null;const a=new DOMPoint(c.x-60,c.y-60).matrixTransform(m),b=new DOMPoint(c.x+60,c.y+60).matrixTransform(m);return {left:a.x,top:a.y,right:b.x,bottom:b.y};}
 openEditor(id,e){const c=this.components.find(c=>c.id===id);if(c){this.selected={component:id};this.render();this.onedit(c,e);}}
 portPosition(pin){const [id,name]=pin.split(':'),c=this.components.find(c=>c.id===id);if(!c)return null;const raw=CircuitEditor.ports[c.type][name];if(!raw)return null;const a=c.rotation*Math.PI/180;return {x:c.x+raw[0]*Math.cos(a)-raw[1]*Math.sin(a),y:c.y+raw[0]*Math.sin(a)+raw[1]*Math.cos(a)};}
 port(pin){if(this.pending&&this.pending!==pin){this.remember();if(!this.wires.some(w=>w.from===this.pending&&w.to===pin||w.to===this.pending&&w.from===pin))this.wires.push({from:this.pending,to:pin});this.pending=null;this.onchange(true);}else this.pending=this.pending===pin?null:pin;this.render();}
 down(e){
  this.svg.focus();const port=e.target.closest('[data-port]');if(port){e.preventDefault();this.port(port.dataset.port);return;}
  const comp=e.target.closest('[data-comp]'),wire=e.target.closest('[data-wire]'),p=this.point(e);
  if(e.button===1||e.shiftKey||(!comp&&!wire&&e.button===0&&e.altKey)){e.preventDefault();this.drag={pan:true,p,view:{...this.view},clientX:e.clientX,clientY:e.clientY,scale:this.svg.getScreenCTM().a};}
  else if(comp){const c=this.components.find(c=>c.id===comp.dataset.comp);this.selected={component:c.id};this.drag={id:c.id,dx:p.x-c.x,dy:p.y-c.y,x0:c.x,y0:c.y,before:this.snapshot(),clientX:e.clientX,clientY:e.clientY,moved:false};this.onselect(c);}
  else if(wire){this.selected={wire:Number(wire.dataset.wire)};}
  else{this.selected=null;this.pending=null;this.drag={pan:true,p,view:{...this.view},clientX:e.clientX,clientY:e.clientY,scale:this.svg.getScreenCTM().a,background:true};}
  if(this.drag)this.svg.setPointerCapture(e.pointerId);this.render();
 }
 move(e){const p=this.point(e);this.pointer=p;
  if(this.drag?.pan){const dx=e.clientX-this.drag.clientX,dy=e.clientY-this.drag.clientY;if(this.drag.background&&Math.hypot(dx,dy)<4)return;this.view.x=this.drag.view.x-dx/this.drag.scale;this.view.y=this.drag.view.y-dy/this.drag.scale;this.drag.moved=true;this.userView=true;this.render();}
  else if(this.drag){const c=this.components.find(c=>c.id===this.drag.id);if(!c)return;if(!this.drag.moved&&Math.hypot(e.clientX-this.drag.clientX,e.clientY-this.drag.clientY)<4)return;this.drag.moved=true;c.x=Math.round((p.x-this.drag.dx)/5)*5;c.y=Math.round((p.y-this.drag.dy)/5)*5;this.render();}
  else if(this.pending)this.render();}
 up(e){
  const drag=this.drag;this.drag=null;if(!drag)return;try{this.svg.releasePointerCapture(e.pointerId);}catch{}
  if(drag.pan){return;}
  if(drag.moved){this.history.push(drag.before);if(this.history.length>60)this.history.shift();this.onchange(false);this.lastTap=null;return;}
  // Two taps on the same component within 400 ms open the inspector.
  const now=performance.now(),tap=this.lastTap;
  if(tap&&tap.id===drag.id&&now-tap.time<400){this.lastTap=null;this.lastOpened=true;this.openEditor(drag.id,e);setTimeout(()=>{this.lastOpened=false;},450);}
  else this.lastTap={id:drag.id,time:now};
 }
 activity(type,topology){
  // Which conduction states actually carry current in this element.
  const on=['source','switch','inductor','transformer','capacitor','resistor'].includes(type);
  const off=['diode','inductor','transformer','capacitor','resistor'].includes(type)||(type==='source'&&topology==='boost');
  const idle=['capacitor','resistor'].includes(type);
  return {on,off,idle};
 }
 setInterval(state){this.interval=state;this.svg.setAttribute('class','st-'+state);}
 // live: {id: text}. Only text nodes change; geometry and listeners stay.
 setLive(live){for(const [id,el] of this.liveRefs){const text=live?.[id]??'';if(el.textContent!==text)el.textContent=text;}}
 render(){
  const esc=s=>this.esc(s),v=this.values(),selected=this.selected?.component;
  this.svg.setAttribute('viewBox',`${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);this.svg.setAttribute('class','st-'+this.interval);
  let html='<defs><pattern id="editor-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#cbd9cf"/></pattern></defs><rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#editor-grid)"/>';
  this.wires.forEach((w,i)=>{const a=this.portPosition(w.from),b=this.portPosition(w.to);if(!a||!b)return;const mid=(a.x+b.x)/2;const d=`M${a.x},${a.y} H${mid} V${b.y} H${b.x}`;html+=`<g data-wire="${i}" class="wire${this.selected?.wire===i?' selected':''}"><path d="${d}" class="wire-hit"/><path d="${d}" class="wire-line"/></g>`;});
  if(this.pending){const a=this.portPosition(this.pending),b=this.pointer||a;if(a&&b)html+=`<path d="M${a.x},${a.y} L${b.x},${b.y}" stroke="#c78126" stroke-width="2" stroke-dasharray="5 5"/>`;}
  const fmt=n=>Number.isFinite(n)?Number(n.toPrecision(4)).toLocaleString('el-GR'):'';
  for(const c of this.components){
   let shape='';const type=c.type;
   if(type==='source')shape='<path d="M0,-40 V-22 M0,22 V40"/><circle r="22"/><path d="M-6,-7 H6 M0,-13 V-1 M-6,10 H6"/>';
   if(type==='switch')shape='<path d="M-45,0 H-16 M16,0 H45"/><path class="blade-open" d="M-16,0 L15,-20"/><path class="blade-closed" d="M-16,0 L16,0"/><circle cx="-16" r="2"/><circle cx="16" r="2"/>';
   if(type==='diode')shape='<path d="M-40,0 H-15 M15,0 H40 M15,-15 V15"/><path d="M-15,-15 L13,0 L-15,15 Z"/>';
   if(type==='inductor')shape='<path d="M-45,0 H-30 c0,-24 20,-24 20,0 c0,-24 20,-24 20,0 c0,-24 20,-24 20,0 H45"/>';
   if(type==='capacitor')shape='<path d="M0,-40 V-7 M-18,-7 H18 M-18,7 H18 M0,7 V40"/><path d="M-25,-24 H-15 M-20,-29 V-19" stroke-width="1"/>';
   if(type==='resistor')shape='<path d="M0,-40 V-29 l-9,5 18,9 -18,10 18,10 -18,10 9,5 V40"/>';
   if(type==='transformer')shape='<path d="M-45,-50 V-30 c24,0 24,20 0,20 c24,0 24,20 0,20 c24,0 24,20 0,20 V50 M45,-50 V-30 c-24,0 -24,20 0,20 c-24,0 -24,20 0,20 c-24,0 -24,20 0,20 V50 M-5,-35 V35 M5,-35 V35"/><circle cx="-55" cy="-30" r="3" class="dot-mark"/><circle cx="55" cy="30" r="3" class="dot-mark"/>';
   const act=this.activity(type,v.topology);
   const value=type==='source'?fmt(v.vin)+' V':type==='inductor'?fmt(v.L*1e6)+' μH':type==='capacitor'?fmt(v.C*1e6)+' μF'+(v.resolved?' · Vo='+fmt(v.resolved.signed_output)+' V':''):type==='resistor'?(v.resolved?fmt(v.resolved.R)+' Ω'+(v.load==='constant_power'?' · CPL':''):v.drive==='fixed_duty'&&v.load==='resistive'?fmt(v.resistance)+' Ω':'R = |Vo|²/Po'):type==='transformer'?'Lm='+fmt(v.L*1e6)+' μH · n='+fmt(v.n):type==='switch'?(v.resolved?'D='+fmt(v.resolved.duty)+' · '+fmt(v.fs/1000)+' kHz':v.drive==='fixed_duty'?'D='+fmt(v.duty_set):'D: άγνωστο'):'ιδανική';
   const big=type==='transformer';
   html+=`<g data-comp="${esc(c.id)}" data-type="${type}" class="comp${selected===c.id?' selected':''}"${act.on?' data-on':''}${act.off?' data-off':''}${act.idle?' data-idle':''}><g transform="translate(${c.x} ${c.y}) rotate(${c.rotation})"><rect class="comp-box" x="${big?-67:-53}" y="${big?-62:-48}" width="${big?134:106}" height="${big?124:96}" rx="8"/><g class="shape">${shape}</g></g><text class="comp-name" x="${c.x}" y="${c.y-(big?75:65)}" text-anchor="middle">${esc(c.id)} · ${esc(CircuitEditor.names[type]||type)}</text><text class="comp-value" x="${c.x}" y="${c.y+(big?86:72)}" text-anchor="middle">${esc(value)}</text><text class="comp-live" data-live="${esc(c.id)}" x="${c.x}" y="${c.y+(big?102:88)}" text-anchor="middle"></text><title>${esc(c.id)} · διπλό κλικ για παραμέτρους</title></g>`;
   for(const name of Object.keys(CircuitEditor.ports[type])){const pin=c.id+':'+name,p=this.portPosition(pin);html+=`<g data-port="${esc(pin)}" tabindex="0" role="button" aria-label="Ακροδέκτης ${esc(pin)}" class="editor-port${this.pending===pin?' pending':''}"><circle cx="${p.x}" cy="${p.y}" r="12" fill="transparent"/><circle class="port-dot" cx="${p.x}" cy="${p.y}" r="5"/><title>${esc(pin)}</title></g>`;}
  }
  if(!this.components.length)html+='<text x="500" y="190" text-anchor="middle" font-size="20" fill="#6d7c7f">Σύρε στοιχεία από την παλέτα</text><text x="500" y="225" text-anchor="middle" font-size="13" fill="#6d7c7f">Σύνδεσε δύο ακροδέκτες με διαδοχικά κλικ · σύρσιμο στο κενό: μετακίνηση θέας</text>';
  const previous=new Map([...this.liveRefs].map(([id,el])=>[id,el.textContent]));
  this.svg.innerHTML=html;
  this.liveRefs=new Map([...this.svg.querySelectorAll('[data-live]')].map(el=>[el.dataset.live,el]));
  for(const [id,el] of this.liveRefs)if(previous.has(id))el.textContent=previous.get(id);
  const caption=document.querySelector('#interval-caption');if(caption)caption.textContent=this.pending?'Επίλεξε δεύτερο ακροδέκτη για σύνδεση · Esc: ακύρωση':selected?`${selected} · διπλό κλικ ή Enter: παράμετροι · σύρσιμο: μετακίνηση · R: περιστροφή · Delete: αφαίρεση`:'Διπλό κλικ σε στοιχείο: τιμές · κλικ σε δύο ακροδέκτες: καλώδιο · σύρσιμο στο κενό: μετακίνηση θέας · ροδέλα: zoom';
 }
};
