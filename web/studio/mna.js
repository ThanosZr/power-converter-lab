'use strict';
// Real-time switched-circuit simulator (Modified Nodal Analysis).
//
// * Companion models: trapezoidal integration, backward Euler for the first
//   step after any topology change (removes trapezoidal ringing and is exact
//   for piecewise-constant inductor voltages).
// * Ideal-ish switches and diodes as R_on/R_off. A diode that changes state
//   inside a step is located by linear interpolation and the step is cut there,
//   so DCM boundaries are exact up to the interpolation of a linear ramp.
// * Steps never cross PWM edges, controller sampling instants or schedule
//   changes (event-aligned fixed step).
// * Everything is recorded (node voltages, element V/I/P, control signals) in a
//   ring buffer plus per-period statistics, so a probe added later still shows
//   recent history.
(function(root){
 const P=root.Parts||(typeof require!=='undefined'?require('./parts.js'):null);
 const GMIN=1e-9;
 const schedAt=(s,t,dflt)=>{if(!s)return dflt;let v=s[0][1];if(t<s[0][0])return dflt;for(const [ts,val] of s){if(ts<=t+1e-15)v=val;else break;}return v;};
 const num=(v,d)=>{const x=typeof v==='number'?v:P.parseEng(v);return Number.isFinite(x)?x:d;};

 class NetlistError extends Error{}

 // ---------------------------------------------------------------- netlist
 function buildNetlist(project){
  const comps=(project.components||[]).filter(c=>P.PARTS[c.type]);
  const byId=new Map(comps.map(c=>[c.id,c]));
  const parent=new Map(),find=k=>{let r=k;while(parent.get(r)!==r)r=parent.get(r);let x=k;while(parent.get(x)!==r){const n=parent.get(x);parent.set(x,r);x=n;}return r;};
  const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent.set(ra,rb);};
  for(const c of comps)for(const p of Object.keys(P.PARTS[c.type].pins))parent.set(c.id+':'+p,c.id+':'+p);
  for(const w of project.wires||[]){const a=w.a.c+':'+w.a.p,b=w.b.c+':'+w.b.p;if(parent.has(a)&&parent.has(b))union(a,b);}
  const warnings=[];
  const grounds=comps.filter(c=>c.type==='GND');
  for(let i=1;i<grounds.length;i++)union(grounds[0].id+':g',grounds[i].id+':g');
  let groundRoot=grounds.length?find(grounds[0].id+':g'):null;
  if(!groundRoot){const s=comps.find(c=>c.type==='VDC'||c.type==='VAC'||c.type==='IDC');
   if(s){groundRoot=find(s.id+':n');warnings.push('Δεν υπάρχει γείωση: ως 0 V λαμβάνεται ο αρνητικός ακροδέκτης της '+(s.label||s.id)+'.');}}
  // group pins into nets; canonical key = smallest pin key (stable)
  const groups=new Map();for(const k of parent.keys()){const r=find(k);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(k);}
  const nets=[];let gnd=null;
  for(const [r,keys] of groups){keys.sort();const net={root:r,keys,canon:keys[0],index:-1,name:null};if(r===groundRoot){gnd=net;net.ground=true;}else nets.push(net);}
  nets.sort((a,b)=>a.canon<b.canon?-1:1);nets.forEach((n,i)=>n.index=i);
  const pinNet=new Map();for(const n of nets)for(const k of n.keys)pinNet.set(k,n);if(gnd)for(const k of gnd.keys)pinNet.set(k,gnd);
  // wire names label their net
  for(const w of project.wires||[])if(w.name){const n=pinNet.get(w.a.c+':'+w.a.p);if(n&&!n.name)n.name=w.name;}
  // pins that touch nothing else
  const open=[];for(const c of comps){if(c.type==='JUNC'||c.type==='PWM')continue;for(const p of Object.keys(P.PARTS[c.type].pins)){const n=pinNet.get(c.id+':'+p);if(n&&n.keys.length===1&&c.type!=='GND')open.push(c.id+':'+p);}}
  if(open.length)warnings.push('Ανοιχτοί ακροδέκτες: '+open.slice(0,6).join(', ')+(open.length>6?' …':'')+'.');
  let nNodes=nets.length;
  const node=(cid,pin)=>{const n=pinNet.get(cid+':'+pin);return n&&!n.ground?n.index:-1;};
  const internal=()=>nNodes++;
  const els=[],ctrls=[],compInfo=new Map();
  let nRows=0;const row=()=>nRows++;
  for(const c of comps){
   const p={...P.defaults(c.type),...(c.params||{})},T=c.type;
   const info={id:c.id,type:T,label:c.label||c.id,pins:[],els:[]};compInfo.set(c.id,info);
   const add=e=>{e.cid=c.id;els.push(e);info.els.push(e);return e;};
   const series=(a,b,R)=>{if(!(R>0))return a;const m=internal();add({k:'G',a,b:m,R,role:'Rs'});return m;};
   if(T==='R'){const a=node(c.id,'a'),b=node(c.id,'b');info.pins=[a,b];info.main=add({k:'G',a,b,R:Math.max(num(p.R,10),1e-9),sched:P.parseSched(p.sched)});}
   else if(T==='L'){const a=node(c.id,'a'),b=node(c.id,'b');info.pins=[a,b];const m=num(p.Rs,0)>0?internal():b;info.main=add({k:'L',a,b:m,L:Math.max(num(p.L,1e-4),1e-12),i:num(p.i0,0),key:c.id});if(m!==b)add({k:'G',a:m,b,R:num(p.Rs,0)});}
   else if(T==='C'){const a=node(c.id,'p'),b=node(c.id,'n');info.pins=[a,b];const m=num(p.esr,0)>0?internal():b;info.main=add({k:'C',a,b:m,C:Math.max(num(p.C,1e-6),1e-15),v:num(p.v0,0),i:0,key:c.id});if(m!==b)add({k:'G',a:m,b,R:num(p.esr,0)});}
   else if(T==='VDC'||T==='VAC'){
    const a=node(c.id,'p'),b=node(c.id,'n');info.pins=[a,b];
    let top=a;if(T==='VDC'&&p.uni){const m=internal();info.uni=add({k:'D',a:m,b:top,Ron:1e-6,Roff:1e7,Vf:0,on:false,key:c.id+'#u'});top=m;}
    if(T==='VAC'&&num(p.Ls,0)>0){const m=internal();add({k:'L',a:m,b:top,L:num(p.Ls,0),i:0,key:c.id+'#Ls'});top=m;}
    const s=series(top,top,0);let srcTop=top;if(num(p.Rs,0)>0){const m=internal();add({k:'G',a:m,b:top,R:num(p.Rs,0)});srcTop=m;}
    const v=T==='VDC'?{kind:'dc',V:num(p.V,12),sched:P.parseSched(p.sched)}:{kind:'ac',Vpk:num(p.Vpk,325),f:num(p.f,50),ph:num(p.phase,0)*Math.PI/180,off:num(p.off,0)};
    info.main=add({k:'V',a:srcTop,b,row:row(),src:v});}
   else if(T==='IDC'){const a=node(c.id,'p'),b=node(c.id,'n');info.pins=[a,b];info.main=add({k:'I',a,b,I:num(p.I,1),sched:P.parseSched(p.sched)});}
   else if(T==='SW'){const a=node(c.id,'d'),b=node(c.id,'s');info.pins=[a,b];info.main=add({k:'S',a,b,Ron:Math.max(num(p.Ron,1e-3),1e-7),Roff:Math.max(num(p.Roff,1e6),1),gate:p.gate||'pwm',pwm:p.pwm,out:p.out||'a',on:false});
    if(p.body)info.body=add({k:'D',a:b,b:a,Ron:Math.max(num(p.Ron,1e-3),1e-7),Roff:Math.max(num(p.Roff,1e6),1),Vf:0,on:false,key:c.id+'#b'});
    if(p.gate==='pwm'&&!(p.pwm&&byId.get(p.pwm)?.type==='PWM'))warnings.push(`${c.label||c.id}: διάλεξε μπλοκ PWM στις ρυθμίσεις (αλλιώς μένει OFF).`);}
   else if(T==='D'){const a=node(c.id,'a'),b=node(c.id,'k');info.pins=[a,b];info.main=add({k:'D',a,b,Ron:Math.max(num(p.Ron,1e-3),1e-7),Roff:Math.max(num(p.Roff,1e6),1),Vf:num(p.Vf,0),on:false,key:c.id});}
   else if(T==='XFMR'){const p1=node(c.id,'p1'),p2=node(c.id,'p2');let s1=node(c.id,'s1'),s2=node(c.id,'s2');const opp=p.pol==='opp';if(opp)[s1,s2]=[s2,s1];
    info.pins=[p1,p2];info.pins2=opp?[s2,s1]:[s1,s2];info.opp=opp;
    info.main=add({k:'X',p1,p2,s1,s2,n:num(p.n,1)||1,row:row()});info.mag=add({k:'L',a:p1,b:p2,L:Math.max(num(p.Lm,1e-3),1e-12),i:num(p.im0,0),key:c.id+'#m'});}
   else if(T==='CPL'){const a=node(c.id,'p'),b=node(c.id,'n');info.pins=[a,b];info.main=add({k:'CPL',a,b,P:num(p.P,1000),Vmin:Math.max(num(p.Vmin,5),1e-3),sched:P.parseSched(p.sched),v0:null});}
   else if(T==='PWM'){const fs=Math.max(num(p.fs,20e3),1e-3);ctrls.push({id:c.id,label:c.label||c.id,fs,T:1/fs,mode:p.mode||'fixed',D:num(p.D,.5),dsched:P.parseSched(p.dsched),carrier:p.carrier||'triangle',phase:num(p.phase,0)/360,
     sensor:p.sensor,qty:p.qty||'I',ref:P.parseSched(p.ref)||[[0,0]],Kp:num(p.Kp,0),Ki:num(p.Ki,0),ff:p.ff||'none',ffA:p.ffA,ffB:p.ffB,D0:num(p.D0,.5),dmin:num(p.dmin,.01),dmax:num(p.dmax,.99),
     m:num(p.m,.8),fref:num(p.fref,50),refphase:num(p.refphase,0)*Math.PI/180,d:num(p.D,.5),xi:0,k:null,tk:0,meas:0,refNow:0});info.ctrl=ctrls[ctrls.length-1];}
  }
  const rowBase=nNodes;for(const e of els)if(e.row!==undefined)e.row+=rowBase;
  return {nets,gnd,pinNet,nNodes,size:nNodes+nRows,els,ctrls,compInfo,warnings,node,byId};
 }

 // ---------------------------------------------------------------- dense LU
 function luFactor(A,n,piv){
  for(let k=0;k<n;k++){let p=k,max=Math.abs(A[k*n+k]);for(let i=k+1;i<n;i++){const v=Math.abs(A[i*n+k]);if(v>max){max=v;p=i;}}
   if(max<1e-300)throw new NetlistError('Ιδιόμορφο σύστημα: βρόχος ιδανικών πηγών τάσης ή κόμβος χωρίς διαδρομή. Πρόσθεσε μικρή αντίσταση ή γείωση.');
   piv[k]=p;if(p!==k)for(let j=0;j<n;j++){const t=A[k*n+j];A[k*n+j]=A[p*n+j];A[p*n+j]=t;}
   const d=A[k*n+k];for(let i=k+1;i<n;i++){const f=A[i*n+k]/d;if(f===0)continue;A[i*n+k]=f;for(let j=k+1;j<n;j++)A[i*n+j]-=f*A[k*n+j];}}
 }
 function luSolve(A,n,piv,b){
  for(let k=0;k<n;k++){const p=piv[k];if(p!==k){const t=b[k];b[k]=b[p];b[p]=t;}}
  for(let i=1;i<n;i++){let s=b[i];for(let j=0;j<i;j++)s-=A[i*n+j]*b[j];b[i]=s;}
  for(let i=n-1;i>=0;i--){let s=b[i];for(let j=i+1;j<n;j++)s-=A[i*n+j]*b[j];b[i]=s/A[i*n+i];}
 }

 // ---------------------------------------------------------------- simulator
 class Sim{
  constructor(project,opts={}){this.opts={h:opts.h||null,hDiv:opts.hDiv||500,cap:opts.cap||0};this.t=0;this.load(project,true);}
  // base period: first PWM, else first AC source, else 1 ms
  basePeriod(){if(this.net.ctrls.length)return this.net.ctrls[0].T;for(const c of this.net.compInfo.values())if(c.type==='VAC')return 1/Math.max(1e-6,c.main.src.f);return 1e-3;}
  setStep(hDiv,h){this.opts.hDiv=hDiv||this.opts.hDiv;this.opts.h=h||null;this.h=this.opts.h||this.T/this.opts.hDiv;}
  load(project,fresh){
   const old=this.net;const net=buildNetlist(project);
   if(old&&!fresh){ // carry states by key
    const st=new Map();for(const e of old.els)if(e.key)st.set(e.k+e.key,e);
    for(const e of net.els)if(e.key&&st.has(e.k+e.key)){const o=st.get(e.k+e.key);if(e.k==='L')e.i=o.i;if(e.k==='C'){e.v=o.v;e.i=o.i;}if(e.k==='D')e.on=o.on;}
    const oc=new Map(old.ctrls.map(c=>[c.id,c]));for(const c of net.ctrls){const o=oc.get(c.id);if(o&&o.mode===c.mode&&o.T===c.T){c.xi=o.xi;c.d=o.d;c.k=o.k;c.tk=o.tk;c.meas=o.meas;c.refNow=o.refNow;}}
    for(const e of net.els)if(e.k==='CPL'){const o=old.els.find(x=>x.k==='CPL'&&x.cid===e.cid);if(o)e.v0=o.v0;}
   }
   this.net=net;this.n=net.size;this.A=new Float64Array(this.n*this.n);this.piv=new Int32Array(this.n);this.b=new Float64Array(this.n);this.cache=new Map();
   if(!this.x||this.x.length!==this.n||fresh)this.x=new Float64Array(this.n);
   this.hasCPL=net.els.some(e=>e.k==='CPL');this.T=this.basePeriod();this.h=this.opts.h||this.T/this.opts.hDiv;
   const keys=this.channelKeys();const same=!fresh&&this.keys&&keys.join('|')===this.keys.join('|');
   this.keys=keys;this.chIndex=new Map(keys.map((k,i)=>[k,i]));
   if(!same)this.allocRecord();
   this.project=project;
   if(fresh){this.t=0;this.beLeft=2;this.prevSig='';this.periodsDone=0;this.started=false;this.steps=0;for(const c of net.ctrls){c.k=null;c.xi=0;}this.initialSolve();this.sampleControllers(true);this.recordNow();}
   else{this.beLeft=2;this.sampleControllers(false);this.computeVals();}
   return net.warnings;
  }
  reset(project){this.load(project||this.project,true);}
  setControl(id,patch){const k=this.net.ctrls.find(c=>c.id===id);if(!k)return false;Object.assign(k,patch);return true;}
  // ------------------------------------------------------------ channels
  channelKeys(){
   const k=[];for(const n of this.net.nets)k.push('N:'+n.canon);
   for(const c of this.net.compInfo.values()){
    if(['GND','JUNC'].includes(c.type))continue;
    if(c.type==='PWM'){k.push('D:'+c.id,'G:'+c.id,'REF:'+c.id,'MEAS:'+c.id);continue;}
    k.push('V:'+c.id,'I:'+c.id,'P:'+c.id);
    if(c.type==='XFMR')k.push('V2:'+c.id,'I2:'+c.id,'Im:'+c.id);
   }
   return k;
  }
  allocRecord(){
   const nch=this.keys.length,cap=this.opts.cap||Math.max(20000,Math.min(200000,Math.floor(24e6/(4*nch+8))));
   this.ring={t:new Float64Array(cap),d:new Float32Array(cap*nch),g:new Uint8Array(cap),nch,cap,head:0,n:0};
   const pc=20000;this.per={t:new Float64Array(pc),avg:new Float32Array(pc*nch),min:new Float32Array(pc*nch),max:new Float32Array(pc*nch),rms:new Float32Array(pc*nch),nch,cap:pc,head:0,n:0};
   this.acc={t0:this.t,dur:0,s:new Float64Array(nch),q:new Float64Array(nch),mn:new Float64Array(nch).fill(Infinity),mx:new Float64Array(nch).fill(-Infinity)};
   this.vals=new Float64Array(nch);this.prevVals=null;
  }
  V(i){return i<0?0:this.x[i];}
  elCurrent(e){const v=this.V(e.a)-this.V(e.b);
   switch(e.k){case 'G':return v/e.Rnow;case 'L':return e.i;case 'C':return e.i;case 'V':return -this.x[e.row];case 'I':return e.Inow;
    case 'S':return v*(e.on?1/e.Ron:1/e.Roff);case 'D':return e.on?(v-e.Vf)/e.Ron:v/e.Roff;case 'CPL':return e.g*v+e.J;}return 0;}
  // values of all channels at the current solution
  computeVals(){
   const out=this.vals;let j=0;const x=this.x;
   for(const n of this.net.nets)out[j++]=x[n.index];
   for(const c of this.net.compInfo.values()){
    if(c.type==='GND'||c.type==='JUNC')continue;
    if(c.type==='PWM'){const k=c.ctrl;out[j++]=k.d;out[j++]=this.gateOf(k,'a',this.t)?1:0;out[j++]=k.refNow;out[j++]=k.meas;continue;}
    const v=this.V(c.pins[0])-this.V(c.pins[1]);let i;
    if(c.type==='XFMR'){const is=this.x[c.main.row];i=-c.main.n*is+c.mag.i;}
    else if(c.type==='SW')i=this.elCurrent(c.main)-(c.body?this.elCurrent(c.body):0);
    else i=this.elCurrent(c.main);
    const src=c.type==='VDC'||c.type==='VAC'||c.type==='IDC';
    out[j++]=v;out[j++]=i;out[j++]=src?v*i:v*i;
    if(c.type==='XFMR'){const v2=this.V(c.pins2[0])-this.V(c.pins2[1]);const is=this.x[c.main.row]*(c.opp?-1:1);out[j++]=v2;out[j++]=is;out[j++]=c.mag.i;}
   }
   return out;
  }
  recordNow(){
   const r=this.ring,v=this.computeVals(),nch=r.nch,j=r.head;r.t[j]=this.t;const off=j*nch;for(let i=0;i<nch;i++)r.d[off+i]=v[i];
   r.head=(j+1)%r.cap;r.n=Math.min(r.n+1,r.cap);
   // period statistics (trapezoidal in time)
   const a=this.acc;if(this.prevVals){const h=this.t-this.prevT;if(h>0){for(let i=0;i<nch;i++){const y0=this.prevVals[i],y1=v[i];a.s[i]+=h*(y0+y1)/2;a.q[i]+=h*(y0*y0+y0*y1+y1*y1)/3;}a.dur+=h;}}
   for(let i=0;i<nch;i++){const y=v[i];if(y<a.mn[i])a.mn[i]=y;if(y>a.mx[i])a.mx[i]=y;}
   if(!this.prevVals)this.prevVals=new Float64Array(nch);this.prevVals.set(v);this.prevT=this.t;
  }
  closePeriod(){
   const a=this.acc,p=this.per,nch=p.nch;if(a.dur<=0)return;const j=p.head,off=j*nch;p.t[j]=this.t;
   for(let i=0;i<nch;i++){p.avg[off+i]=a.s[i]/a.dur;p.rms[off+i]=Math.sqrt(Math.max(0,a.q[i]/a.dur));p.min[off+i]=a.mn[i];p.max[off+i]=a.mx[i];}
   p.head=(j+1)%p.cap;p.n=Math.min(p.n+1,p.cap);
   a.dur=0;a.s.fill(0);a.q.fill(0);a.mn.fill(Infinity);a.mx.fill(-Infinity);
   if(this.prevVals)for(let i=0;i<nch;i++){const y=this.prevVals[i];a.mn[i]=y;a.mx[i]=y;}
   this.periodsDone=(this.periodsDone||0)+1;
  }
  lastPeriod(key){const i=this.chIndex.get(key),p=this.per;if(i===undefined||!p.n)return null;const j=(p.head-1+p.cap)%p.cap,o=j*p.nch+i;return {t:p.t[j],avg:p.avg[o],rms:p.rms[o],min:p.min[o],max:p.max[o]};}
  now(key){const i=this.chIndex.get(key);if(i===undefined)return NaN;return this.vals[i];}
  // ------------------------------------------------------------ control
  gateOf(k,out,t){
   const T=k.T;
   if(k.mode==='spwm'){const ph=((t/T-k.phase)%1+1)%1;const car=ph<.5?1-4*ph:-3+4*ph;const ref=k.m*Math.sin(2*Math.PI*k.fref*t+k.refphase);
    const a=ref>car,b=-ref>car;return out==='a'?a:out==='na'?!a:out==='b'?b:!b;}
   const tau=t-k.tk,d=Math.min(1,Math.max(0,k.d));let a,b;
   if(k.mode==='pp'){const h=T/2;a=tau>=-1e-15&&tau<d*h*(1-1e-12);b=tau>=h*(1-1e-12)&&tau<h+d*h*(1-1e-12);}
   else{const [e0,e1]=k.carrier==='saw'?[0,d*T]:[(1-d)*T/2,(1+d)*T/2];a=tau>=e0*(1-1e-12)-1e-18&&tau<e1*(1-1e-12);b=a;}
   return out==='a'?a:out==='na'?!a:out==='b'?b:!b;
  }
  ctrlEdges(k){const T=k.T,d=Math.min(1,Math.max(0,k.d));
   if(k.mode==='pp'){const h=T/2;return [k.tk+d*h,k.tk+h,k.tk+h+d*h,k.tk+T];}
   const [e0,e1]=k.carrier==='saw'?[0,d*T]:[(1-d)*T/2,(1+d)*T/2];return [k.tk+e0,k.tk+e1,k.tk+T];}
  compV(cid){const c=this.net.compInfo.get(cid);if(!c||!c.pins)return NaN;return this.V(c.pins[0])-this.V(c.pins[1]);}
  compI(cid){const c=this.net.compInfo.get(cid);if(!c||!c.main)return NaN;if(c.type==='XFMR')return -c.main.n*this.x[c.main.row]+c.mag.i;if(c.type==='SW')return this.elCurrent(c.main)-(c.body?this.elCurrent(c.body):0);return this.elCurrent(c.main);}
  sampleControllers(force){
   for(const k of this.net.ctrls){
    const T=k.T,idx=Math.floor((this.t+1e-12*T)/T-k.phase);
    if(!force&&k.k===idx)continue;
    k.k=idx;k.tk=(idx+k.phase)*T;
    if(k.mode==='fixed'||k.mode==='pp')k.d=schedAt(k.dsched,this.t,k.D);
    else if(k.mode==='pi'){
     k.refNow=schedAt(k.ref,this.t,k.ref[0][1]);k.meas=k.qty==='V'?this.compV(k.sensor):this.compI(k.sensor);if(!Number.isFinite(k.meas))k.meas=0;
     let ff=0;if(k.ff==='ratio'){const a=this.compV(k.ffA),b=this.compV(k.ffB);ff=Math.abs(b)>1e-9?1-a/b:0;}else if(k.ff==='const')ff=k.D0;
     const e=k.refNow-k.meas;if(force&&!this.started){k.xi=0;}
     k.xi+=k.Ki*T*e;let d=ff+k.Kp*e+k.xi;
     if(d>k.dmax||d<k.dmin){k.xi-=k.Ki*T*e;d=Math.min(k.dmax,Math.max(k.dmin,ff+k.Kp*e+k.xi));}
     k.d=d;}
   }
  }
  gateSig(t){let s='';for(const e of this.net.els)if(e.k==='S'){let on=false;if(e.gate==='on')on=true;else if(e.gate==='pwm'){const k=this.net.ctrls.find(c=>c.id===e.pwm);on=k?this.gateOf(k,e.out,t):false;}e.on=on;s+=on?'1':'0';}return s;}
  // ------------------------------------------------------------ assembly
  values(t){ // time-dependent element values at time t
   for(const e of this.net.els){
    if(e.k==='G')e.Rnow=Math.max(schedAt(e.sched,t,e.R),1e-9);
    else if(e.k==='I')e.Inow=schedAt(e.sched,t,e.I);
    else if(e.k==='V'){const s=e.src;e.Vnow=s.kind==='dc'?schedAt(s.sched,t,s.V):s.off+s.Vpk*Math.sin(2*Math.PI*s.f*t+s.ph);}
    else if(e.k==='CPL')e.Pnow=schedAt(e.sched,t,e.P);
   }
  }
  assemble(h,mode){
   const n=this.n,A=this.A;A.fill(0);
   const g=(a,b,G)=>{if(a>=0)A[a*n+a]+=G;if(b>=0)A[b*n+b]+=G;if(a>=0&&b>=0){A[a*n+b]-=G;A[b*n+a]-=G;}};
   for(let i=0;i<this.net.nNodes;i++)A[i*n+i]+=GMIN;
   const tr=mode==='TR';
   for(const e of this.net.els){
    switch(e.k){
     case 'G':g(e.a,e.b,1/e.Rnow);break;
     case 'L':e.g=tr?h/(2*e.L):h/e.L;g(e.a,e.b,e.g);break;
     case 'C':e.g=tr?2*e.C/h:e.C/h;g(e.a,e.b,e.g);break;
     case 'S':g(e.a,e.b,e.on?1/e.Ron:1/e.Roff);break;
     case 'D':g(e.a,e.b,e.on?1/e.Ron:1/e.Roff);break;
     case 'CPL':g(e.a,e.b,e.g);break;
     case 'V':{const r=e.row;if(e.a>=0){A[e.a*n+r]+=1;A[r*n+e.a]+=1;}if(e.b>=0){A[e.b*n+r]-=1;A[r*n+e.b]-=1;}break;}
     case 'X':{const r=e.row,N=e.n;if(e.s1>=0){A[e.s1*n+r]+=1;A[r*n+e.s1]+=1;}if(e.s2>=0){A[e.s2*n+r]-=1;A[r*n+e.s2]-=1;}
      if(e.p1>=0){A[e.p1*n+r]-=N;A[r*n+e.p1]-=N;}if(e.p2>=0){A[e.p2*n+r]+=N;A[r*n+e.p2]+=N;}break;}
    }
   }
  }
  rhs(h,mode){
   const b=this.b;b.fill(0);const tr=mode==='TR';
   const J=(a,c,j)=>{if(a>=0)b[a]-=j;if(c>=0)b[c]+=j;};
   for(const e of this.net.els){
    switch(e.k){
     case 'L':{const v=this.V(e.a)-this.V(e.b);e.g=tr?h/(2*e.L):h/e.L;e.J=tr?e.i+e.g*v:e.i;J(e.a,e.b,e.J);break;}
     case 'C':{const v=e.v;e.g=tr?2*e.C/h:e.C/h;e.J=tr?-(e.g*v+e.i):-e.g*v;J(e.a,e.b,e.J);break;}
     case 'D':if(e.on)J(e.a,e.b,-e.Vf/e.Ron);break;
     case 'CPL':J(e.a,e.b,e.J);break;
     case 'I':J(e.a,e.b,-e.Inow);break;
     case 'V':b[e.row]=e.Vnow;break;
    }
   }
  }
  cplLinearize(){for(const e of this.net.els)if(e.k==='CPL'){let v=e.v0??(this.V(e.a)-this.V(e.b));const P=e.Pnow;
   if(Math.abs(v)<e.Vmin){e.g=P/(e.Vmin*e.Vmin);e.J=0;}else{e.g=-P/(v*v);e.J=2*P/v;}}}
  solveOnce(h,mode){
   let key=null;
   if(!this.hasCPL){key=mode+(h/this.h).toPrecision(10);for(const e of this.net.els)if(e.k==='S'||e.k==='D')key+=e.on?'1':'0';
    for(const e of this.net.els)if(e.k==='G'&&e.sched)key+='|'+e.Rnow;}
   let f=key&&this.cache.get(key);
   if(!f){this.assemble(h,mode);luFactor(this.A,this.n,this.piv);f={A:this.A.slice(),piv:this.piv.slice()};if(key){if(this.cache.size>256)this.cache.clear();this.cache.set(key,f);}}
   this.rhs(h,mode);const sol=this.b.slice();luSolve(f.A,this.n,f.piv,sol);return sol;
  }
  solve(h,mode){
   if(!this.hasCPL)return this.solveOnce(h,mode);
   for(const e of this.net.els)if(e.k==='CPL')e.v0=this.V(e.a)-this.V(e.b);
   let sol;for(let it=0;it<12;it++){this.cplLinearize();sol=this.solveOnce(h,mode);
    let conv=true;for(const e of this.net.els)if(e.k==='CPL'){const va=e.a>=0?sol[e.a]:0,vb=e.b>=0?sol[e.b]:0,v=va-vb;if(Math.abs(v-e.v0)>1e-9*(1+Math.abs(v)))conv=false;e.v0=v;}
    if(conv)break;}
   return sol;
  }
  // diode consistency of a trial solution; returns [{e, frac}] (frac: where the transition occurred inside the step)
  check(sol){
   const bad=[];const V=i=>i<0?0:sol[i];
   for(const e of this.net.els)if(e.k==='D'){const v=V(e.a)-V(e.b);
    if(e.on){const i=(v-e.Vf)/e.Ron;if(i<-1e-9*(1+Math.abs(e.iPrev||0))){const i0=e.iPrev??0;bad.push({e,frac:i0>0?i0/(i0-i):0});}}
    else if(v>e.Vf+1e-7){const v0=e.vPrev??(e.Vf-1);bad.push({e,frac:v0<e.Vf?(e.Vf-v0)/(v-v0):0});}}
   return bad;
  }
  commit(sol,h,mode){
   const old=this.x;this.x=sol;
   for(const e of this.net.els){
    if(e.k==='L'){const v=this.V(e.a)-this.V(e.b);e.i=e.g*v+e.J;}
    else if(e.k==='C'){const v=this.V(e.a)-this.V(e.b);e.i=e.g*v+e.J;e.v=v;}
    else if(e.k==='D'){const v=this.V(e.a)-this.V(e.b);e.vPrev=v;e.iPrev=e.on?(v-e.Vf)/e.Ron:v/e.Roff;}
    else if(e.k==='CPL'){const v=this.V(e.a)-this.V(e.b);e.v0=v;if(Math.abs(v)<e.Vmin){e.g=e.Pnow/(e.Vmin*e.Vmin);e.J=0;}else{e.g=e.Pnow/(v*v);e.J=0;}}
   }
   this.t+=h;this.steps++;
  }
  // consistent initial solution at t=0: inductors act as current sources (i0),
  // capacitors as voltage sources (v0): backward Euler with a vanishing step
  initialSolve(){
   this.values(0);this.gateSig(0);const hs=this.h*1e-6;let sol=null;
   for(const e of this.net.els)if(e.k==='C')e.i=0;
   for(let it=0;it<40;it++){sol=this.solve(hs,'BE');const bad=this.check(sol);if(!bad.length)break;for(const b of bad)b.e.on=!b.e.on;}
   this.x=sol;
   for(const e of this.net.els){const v=this.V(e.a)-this.V(e.b);if(e.k==='D'){e.vPrev=v;e.iPrev=e.on?(v-e.Vf)/e.Ron:v/e.Roff;}if(e.k==='CPL')e.v0=v;}
   this.computeVals();
  }
  // one step of at most h; returns the time actually advanced
  step(h){
   const t0=this.t,mid=t0+h/2;
   const sig=this.gateSig(mid),gateChange=sig!==this.prevSig;if(gateChange)this.beLeft=2;
   const smooth=!gateChange&&this.beLeft<=0;const mode=this.beLeft>0?'BE':'TR';this.prevSig=sig;
   this.values(t0+h);
   let sol=this.solve(h,mode),bad=this.check(sol);
   if(!bad.length){this.commit(sol,h,mode);this.beLeft--;return h;}
   // locate the transition inside the step: current zero-crossings always
   // (diode currents are continuous), voltage crossings only in a smooth regime
   const cands=bad.filter(b=>b.e.on||smooth);
   if(cands.length){
    const frac=Math.min(...cands.map(b=>b.frac));
    if(frac>1e-4&&frac<.999&&frac*h>this.h*1e-4){
     const hh=h*frac;this.values(t0+hh);const s2=this.solve(hh,mode);const V=i=>i<0?0:s2[i];
     const flip=cands.filter(b=>b.frac<=frac*(1+1e-6)+1e-9);
     const ok=flip.every(b=>{const e=b.e,v=V(e.a)-V(e.b);if(e.on){const i=(v-e.Vf)/e.Ron,i0=Math.abs(e.iPrev||0);return Math.abs(i)<=.02*i0+1e-9;}
       const v0=Math.abs((e.vPrev??0)-e.Vf);return Math.abs(v-e.Vf)<=.02*v0+1e-6;})&&this.check(s2).every(b=>flip.some(f=>f.e===b.e));
     if(ok){this.commit(s2,hh,mode);for(const b of flip)b.e.on=!b.e.on;this.beLeft=2;return hh;}
     this.values(t0+h);
    }
   }
   // transition at the start of the step: iterate the states with backward Euler
   for(let it=0;it<30&&bad.length;it++){for(const b of bad)b.e.on=!b.e.on;sol=this.solve(h,'BE');bad=this.check(sol);}
   this.commit(sol,h,'BE');this.beLeft=2;return h;
  }
  nextEvent(tMax){
   let t=tMax;const eps=this.h*1e-6;
   for(const k of this.net.ctrls){if(k.mode==='spwm'){continue;}for(const e of this.ctrlEdges(k))if(e>this.t+eps&&e<t)t=e;}
   const sch=(s)=>{if(s)for(const [ts] of s)if(ts>this.t+eps&&ts<t)t=ts;};
   for(const e of this.net.els){if(e.sched)sch(e.sched);if(e.k==='V'&&e.src.sched)sch(e.src.sched);}
   for(const k of this.net.ctrls){sch(k.dsched);if(k.mode==='pi')sch(k.ref);}
   // base-period boundary for statistics
   const Tb=this.T,kb=Math.floor((this.t+eps)/Tb)+1,tb=kb*Tb;if(tb>this.t+eps&&tb<t)t=tb;
   return t;
  }
  spwmCut(h){ // shorten h to the first SPWM crossing in (t, t+h]
   const sp=this.net.ctrls.filter(k=>k.mode==='spwm');if(!sp.length)return h;
   const sig=t=>sp.map(k=>this.gateOf(k,'a',t)?'1':'0').join('')+sp.map(k=>this.gateOf(k,'b',t)?'1':'0').join('');
   const s0=sig(this.t+h*1e-9);if(sig(this.t+h)===s0)return h;
   let lo=0,hi=h;for(let i=0;i<40;i++){const m=(lo+hi)/2;if(sig(this.t+m)===s0)lo=m;else hi=m;}
   return Math.max(hi,this.h*1e-6);
  }
  run(duration,maxSteps=Infinity,deadline=Infinity){
   const tEnd=this.t+duration;let steps=0;const eps=this.h*1e-7;
   while(this.t<tEnd-eps&&steps<maxSteps){
    const tn=this.nextEvent(tEnd);let h=Math.min(this.h,tn-this.t);if(tn-this.t-h<this.h*1e-3)h=tn-this.t;
    h=this.spwmCut(h);
    this.step(h);steps++;
    // land exactly on event times
    if(Math.abs(this.t-tn)<eps)this.t=tn;
    this.started=true;
    const Tb=this.T,onB=Math.abs(this.t/Tb-Math.round(this.t/Tb))<1e-9;
    this.recordNow();
    if(onB&&this.t>0)this.closePeriod();
    this.sampleControllers(false);
    if((steps&255)===0&&performance.now()>deadline)break;
   }
   this.computeVals();
   return steps;
  }
 }
 const api={Sim,buildNetlist,NetlistError};
 root.MNA=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
