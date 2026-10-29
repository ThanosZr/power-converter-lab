'use strict';
// Live switched-circuit simulation (time domain, open loop, fixed duty).
// State x=[i, v]: i = inductor current (flyback: primary-referred magnetizing
// current im), v = |vo| on the output capacitor. Fixed user time step h with
// RK4; every step is split exactly at gate edges (DT, T) and at the iL=0
// event, so the time step only affects accuracy inside one linear interval.
// No small-ripple assumption: the load current follows v.
(function(root){
 const CAP=1<<19;
 class SwitchedSim{
  constructor(p){this.configure(p);this.alloc();this.reset('zero');}
  alloc(){
   this.bt=new Float64Array(CAP);this.bi=new Float32Array(CAP);this.bv=new Float32Array(CAP);this.bg=new Uint8Array(CAP);
   this.n=0;this.head=0;
  }
  configure(p){
   const need=['vin','L','C','fs','duty'];
   for(const k of need)if(!(Number.isFinite(p[k])&&p[k]>0))throw Error('Μη έγκυρη παράμετρος προσομοίωσης: '+k);
   if(!(p.duty<1))throw Error('Το duty πρέπει να είναι < 1.');
   this.p={topology:p.topology,vin:p.vin,L:p.L,C:p.C,fs:p.fs,duty:p.duty,n:p.n||1,
     load:p.load==='constant_power'?'constant_power':'resistive',R:p.R,P:p.P,vref:p.vref||1};
   if(this.p.load==='resistive'&&!(this.p.R>0))throw Error('Μη έγκυρη αντίσταση φορτίου.');
   if(this.p.load==='constant_power'&&!(this.p.P>0))throw Error('Μη έγκυρη ισχύς φορτίου.');
   this.T=1/p.fs;this.h=Math.min(p.h||this.T/200,this.T);
   // CPL behaves resistively below 30 % of the reference voltage (undervoltage
   // region). Otherwise an ideal i=P/v load is singular at start-up.
   this.vmin=.3*this.p.vref;
  }
  setStep(h){if(Number.isFinite(h)&&h>0)this.h=Math.min(h,this.T);}
  reset(mode='zero',op=null){
   this.t=0;this.tau=0;this.k=0;this.n=0;this.head=0;this.debt=0;
   if(mode==='op'&&op){this.i=Math.max(0,op.i0);this.v=Math.max(0,op.v0);}else{this.i=0;this.v=0;}
   this.history=[];this.acc=null;this.newPeriodAcc();this.last=null;this.stepsTaken=0;this.record();
  }
  iload(v){const p=this.p;if(p.load==='resistive')return v/p.R;return v>=this.vmin?p.P/v:v*p.P/(this.vmin*this.vmin);}
  // Natural inductor slope and current delivered to the output node.
  slope(gate,i,v){
   const p=this.p,key=p.topology;
   if(gate){return {di:key==='buck'?(p.vin-v)/p.L:p.vin/p.L,out:key==='buck'?i:0};}
   if(key==='buck')return {di:-v/p.L,out:i};
   if(key==='boost')return {di:(p.vin-v)/p.L,out:i};
   if(key==='buck_boost')return {di:-v/p.L,out:i};
   return {di:-v/(p.n*p.L),out:i/p.n};
  }
  f(gate,i,v){
   const s=this.slope(gate,i,v);let di=s.di,out=s.out;
   // Unidirectional switch and diode: the inductor current cannot reverse.
   if(i<=0&&di<0){di=0;out=0;}
   return [di,(out-this.iload(Math.max(v,0)))/this.p.C];
  }
  rk4(gate,h){
   const i=this.i,v=this.v;
   const a=this.f(gate,i,v),b=this.f(gate,i+h/2*a[0],v+h/2*a[1]),c=this.f(gate,i+h/2*b[0],v+h/2*b[1]),d=this.f(gate,i+h*c[0],v+h*c[1]);
   return [i+h/6*(a[0]+2*b[0]+2*c[0]+d[0]),v+h/6*(a[1]+2*b[1]+2*c[1]+d[1])];
  }
  gate(){return this.tau<this.p.duty*this.T*(1-1e-12);}
  conduction(){
   const g=this.gate();if(g)return 'ON';
   if(this.i>0)return 'OFF';
   return this.slope(false,0,this.v).di>0?'OFF':'IDLE';
  }
  // One integration step of length h (already clipped to the next edge).
  advance(h){
   const g=this.gate();let [i,v]=this.rk4(g,h);
   if(i<0){
    // iL=0 event inside the step: locate it, finish the step clamped at zero.
    const z=Math.min(1,Math.max(0,this.i/(this.i-i)));const h1=h*z;
    if(h1>0){[i,v]=this.rk4(g,h1);this.i=0;this.v=v;}else this.i=0;
    i=0;const rest=h-h1;if(rest>0){[,v]=this.rk4(g,rest);}
    i=0;
   }
   this.i=i;this.v=Math.max(v,0);this.t+=h;this.tau+=h;this.stepsTaken++;
  }
  // Advance the clock by `duration` with steps no longer than h.
  run(duration,maxSteps=Infinity){
   let left=duration,steps=0;const T=this.T,DT=this.p.duty*T;
   while(left>T*1e-13&&steps<maxSteps){
    const edge=this.tau<DT*(1-1e-12)?DT:T;let h=Math.min(this.h,left,edge-this.tau);
    if(edge-this.tau-h<T*1e-9)h=edge-this.tau;
    if(h<=0){h=Math.min(this.h,left);}
    const g=this.gate(),i0=this.i,v0=this.v;
    this.advance(h);left-=h;steps++;
    if(Math.abs(this.tau-DT)<T*1e-9)this.tau=DT;
    const during=g?1:(i0>0||this.i>0?2:3);
    this.accumulate(g,i0,v0,h);
    if(this.tau>=T*(1-1e-9)){this.tau=0;this.k++;this.closePeriod();}
    // Record the finished interval's state, then the new one if it changed,
    // so switch/diode currents show vertical edges at the exact instant.
    this.record(during);const now=this.code();if(now!==during)this.record(now);
   }
   return {steps,left};
  }
  // Step debt keeps the user's time step exact when the requested advance per
  // frame is smaller than h (slow motion): full steps are taken when owed.
  play(simTime,maxSteps){
   this.debt+=simTime;let taken=0;
   while(this.debt>=this.h*(1-1e-9)&&taken<maxSteps){const r=this.run(Math.min(this.h,this.debt),1);this.debt-=Math.min(this.h,this.debt)-r.left;taken+=r.steps||1;}
   const limited=this.debt>=this.h&&taken>=maxSteps;if(limited)this.debt=Math.min(this.debt,this.h*maxSteps);
   return {taken,limited};
  }
  newPeriodAcc(){this.acc={t0:this.t,vmin:Infinity,vmax:-Infinity,imin:Infinity,imax:-Infinity,v:0,i:0,is:0,id:0,io:0,dur:0};}
 accumulate(g,i0,v0,h){
  const a=this.acc,p=this.p,mean=h*(i0+this.i)/2;
  a.v+=h*(v0+this.v)/2;a.i+=mean;a.io+=h*(this.iload(v0)+this.iload(this.v))/2;a.dur+=h;
  if(g)a.is+=mean;else a.id+=p.topology==='flyback'?mean/p.n:mean;
  a.vmin=Math.min(a.vmin,v0,this.v);a.vmax=Math.max(a.vmax,v0,this.v);a.imin=Math.min(a.imin,i0,this.i);a.imax=Math.max(a.imax,i0,this.i);
 }
 closePeriod(){
  const a=this.acc;if(a.dur>0){
   const d=a.dur,iin=this.p.topology==='boost'?a.i/d:a.is/d;
   const row={k:this.k,t:this.t,vavg:a.v/d,vmin:a.vmin,vmax:a.vmax,iavg:a.i/d,imin:a.imin,imax:a.imax,isavg:a.is/d,idavg:a.id/d,ioavg:a.io/d,iinavg:iin};
   this.last=row;this.history.push(row);if(this.history.length>200000)this.history.splice(0,100000);
  }
  this.newPeriodAcc();
 }
 code(){const c=this.conduction();return c==='ON'?1:c==='OFF'?2:3;}
  record(code=this.code()){
   const j=this.head;this.bt[j]=this.t;this.bi[j]=this.i;this.bv[j]=this.v;this.bg[j]=code;
   this.head=(j+1)%CAP;this.n=Math.min(this.n+1,CAP);
  }
  // Iterate recorded samples with t in [t0,t1] (oldest first).
  each(t0,t1,fn){
   const start=(this.head-this.n+CAP)%CAP;let lo=0,hi=this.n;
   while(lo<hi){const m=(lo+hi)>>1;if(this.bt[(start+m)%CAP]<t0)lo=m+1;else hi=m;}
   for(let m=Math.max(0,lo-1);m<this.n;m++){const j=(start+m)%CAP;if(this.bt[j]>t1)break;fn(this.bt[j],this.bi[j],this.bv[j],this.bg[j]);}
  }
  // Instantaneous branch currents for the live labels.
  branches(){
   const p=this.p,c=this.conduction(),i=this.i,key=p.topology;
   const iS=c==='ON'?i:0,iD=c==='OFF'?(key==='flyback'?i/p.n:i):0;
   const iin=key==='boost'?i:iS,io=this.iload(this.v),out=key==='buck'?i:iD;
   return {state:c,i,v:this.v,iS,iD,iin,io,iC:out-io};
  }
 }
 root.SwitchedSim=SwitchedSim;
 if(typeof module!=='undefined')module.exports={SwitchedSim};
})(typeof window!=='undefined'?window:globalThis);
