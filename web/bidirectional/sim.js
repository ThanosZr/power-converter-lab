'use strict';
// Switched-model simulator of the bidirectional half-bridge converter.
//
// Same conventions as engine/bidir.py:
//   D   = duty of the LOWER switch S2 (S1 complementary, no dead time)
//   i_L > 0 from the low-voltage side into the half-bridge midpoint
//   'above': low side = bus, high side = storage;  'below': the opposite
//
// Bus side: 'ideal' (fixed voltage source, PLECS test bench of question 5)
// or 'system' (unidirectional 50 V source with R_src, bus capacitor C+ESR,
// load). Storage: ideal voltage source.
//
// PWM: 'triangle' carrier puts the S2 pulse in the middle of the period and
// samples at t = kT (middle of the S1 pulse), where the instantaneous current
// equals the period average in steady state. 'saw' turns S2 on first at t = kT.
// Control: 'open' (fixed D), 'dd' (temporary ΔD for N periods), 'pi' (sampled
// PI on i_L with optional duty feed-forward D0 = 1 - v_lo/v_hi, anti-windup).
// Fixed step RK4; every step is split exactly at PWM edges and period ends.
(function(root){
 const CAP=1<<19;
 class BidirSim{
  constructor(p){this.alloc();this.configure(p);this.reset();}
  alloc(){
   this.bt=new Float64Array(CAP);this.bi=new Float32Array(CAP);this.bv=new Float32Array(CAP);this.bg=new Uint8Array(CAP);
   this.bd=new Float32Array(CAP);this.br=new Float32Array(CAP);this.bs=new Float32Array(CAP);this.n=0;this.head=0;
  }
  configure(p){
   for(const k of ['Vst','L','fs'])if(!(Number.isFinite(p[k])&&p[k]>0))throw Error('Μη έγκυρη παράμετρος: '+k);
   const c=p.control||{mode:'open',D:.5};
   this.p={pos:p.pos==='below'?'below':'above',Vst:p.Vst,Vbus:p.Vbus||50,bus:p.bus==='system'?'system':'ideal',
     Vsrc:p.Vsrc||50,Rsrc:p.Rsrc||1e-3,C:p.C||.1,ESR:p.ESR??2e-4,L:p.L,fs:p.fs,carrier:p.carrier==='saw'?'saw':'triangle',
     load:p.load||{type:'cpl',P:0},loadSchedule:p.loadSchedule||null,
     control:{mode:c.mode||'open',D:c.D??.5,Kp:c.Kp||0,Ki:c.Ki||0,ff:c.ff!==false,dD:c.dD||0,N:c.N||0,k0:c.k0??1,
       ref:c.ref||[{t:0,I:0}],slew:c.slew||0,dmin:c.dmin??.01,dmax:c.dmax??.99}};
   this.T=1/p.fs;this.h=Math.min(p.h||this.T/500,this.T);
  }
  setStep(h){if(Number.isFinite(h)&&h>0)this.h=Math.min(h,this.T);}
  reset(init={}){
   this.t=0;this.tau=0;this.k=0;this.n=0;this.head=0;this.debt=0;this.stepsTaken=0;
   this.i=init.i0??0;this.vC=init.vC0??(this.p.bus==='system'?this.p.Vsrc:this.p.Vbus);this.xi=0;this.irefNow=null;
   this.history=[];this.last=null;this.newAcc();this.sample();this.record(this.gate()?1:0);
  }
  loadP(t){const s=this.p.loadSchedule;if(!s)return this.p.load.P;let P=s[0].P;for(const e of s)if(e.t<=t)P=e.P;return P;}
  // Bus node: returns {v, iC, isrc, iload, icb}. icb = converter current into the bus.
  bus(i,vC,s2,t){
   const p=this.p,above=p.pos==='above';
   const icb=above?-i:(s2?0:i);
   if(p.bus==='ideal')return {v:p.Vbus,iC:0,isrc:0,iload:0,icb};
   const P=this.loadP(t),Rl=p.load.type==='res'?(P>0?50*50/P:Infinity):0;
   const il=v=>p.load.type==='res'?v/Rl:P/Math.max(v,5);
   const dil=v=>p.load.type==='res'?1/Rl:-P/Math.max(v,5)**2;
   let v=vC;
   for(let it=0;it<6;it++){
    const cond=p.Vsrc-v>0,is=cond?(p.Vsrc-v)/p.Rsrc:0;
    const g=v-vC-p.ESR*(is+icb-il(v)),dg=1-p.ESR*((cond?-1/p.Rsrc:0)-dil(v));
    const nv=v-g/dg;if(Math.abs(nv-v)<1e-12){v=nv;break;}v=nv;
   }
   const isrc=Math.max(0,(p.Vsrc-v)/p.Rsrc),iload=il(v);
   return {v,iC:isrc+icb-iload,isrc,iload,icb};
  }
  sides(vbus){return this.p.pos==='above'?[vbus,this.p.Vst]:[this.p.Vst,vbus];}
  f(s2,i,vC,t){
   const b=this.bus(i,vC,s2,t),[vlo,vhi]=this.sides(b.v);
   return [(vlo-(s2?0:vhi))/this.p.L,this.p.bus==='system'?b.iC/this.p.C:0];
  }
  rk4(s2,h){
   const i=this.i,v=this.vC,t=this.t;
   const a=this.f(s2,i,v,t),b=this.f(s2,i+h/2*a[0],v+h/2*a[1],t+h/2),c=this.f(s2,i+h/2*b[0],v+h/2*b[1],t+h/2),d=this.f(s2,i+h*c[0],v+h*c[1],t+h);
   return [i+h/6*(a[0]+2*b[0]+2*c[0]+d[0]),v+h/6*(a[1]+2*b[1]+2*c[1]+d[1])];
  }
  edges(){const d=this.d,T=this.T;return this.p.carrier==='saw'?[0,d*T]:[(1-d)*T/2,(1+d)*T/2];}
  gate(){const [a,b]=this.edges();return this.tau>=a*(1-1e-12)-1e-18&&this.tau<b*(1-1e-12);}
  refAt(t){let I=this.p.control.ref[0].I;for(const r of this.p.control.ref)if(r.t<=t+1e-15)I=r.I;return I;}
  // Controller update at the start of every period (t = kT).
  sample(){
   const c=this.p.control,T=this.T;
   const b=this.bus(this.i,this.vC,false,this.t),[vlo,vhi]=this.sides(b.v);
   const target=this.refAt(this.t);
   if(this.irefNow===null)this.irefNow=c.mode==='pi'?target:this.i;
   if(c.slew>0){const step=c.slew*T;this.irefNow+=Math.max(-step,Math.min(step,target-this.irefNow));}else this.irefNow=target;
   if(c.mode==='open')this.d=c.D;
   else if(c.mode==='dd')this.d=c.D+(this.k>=c.k0&&this.k<c.k0+c.N?c.dD:0);
   else{
    const e=this.irefNow-this.i,ff=c.ff?1-vlo/vhi:0;
    this.xi+=c.Ki*T*e;let d=ff+c.Kp*e+this.xi;
    if(d>c.dmax||d<c.dmin){this.xi-=c.Ki*T*e;d=Math.min(c.dmax,Math.max(c.dmin,ff+c.Kp*e+this.xi));}
    this.d=d;
   }
   this.d=Math.min(1,Math.max(0,this.d));
  }
  advance(h){
   const s2=this.gate(),[i,v]=this.rk4(s2,h),i0=this.i,v0=this.vC,t0=this.t;
   this.i=i;this.vC=v;this.t+=h;this.tau+=h;this.stepsTaken++;
   this.accumulate(s2,i0,v0,t0,h);
   return s2;
  }
  run(duration,maxSteps=Infinity){
   let left=duration,steps=0;const T=this.T;
   while(left>T*1e-13&&steps<maxSteps){
    const [a,b]=this.edges();let next=T;for(const e of [a,b])if(e>this.tau+T*1e-12&&e<next)next=e;
    let h=Math.min(this.h,left,next-this.tau);if(next-this.tau-h<T*1e-9)h=next-this.tau;if(h<=0)h=Math.min(this.h,left);
    const s2=this.advance(h);left-=h;steps++;
    for(const e of [a,b])if(Math.abs(this.tau-e)<T*1e-9)this.tau=e;
    let wrapped=false;
    if(this.tau>=T*(1-1e-9)){this.tau=0;this.k++;this.closePeriod();this.sample();wrapped=true;}
    this.record(s2?1:0);const now=this.gate()?1:0;if(now!==(s2?1:0)||wrapped)this.record(now);
   }
   return {steps,left};
  }
  play(simTime,maxSteps){
   this.debt+=simTime;let taken=0;
   while(this.debt>=this.h*(1-1e-9)&&taken<maxSteps){const want=Math.min(this.h,this.debt),r=this.run(want,1);this.debt-=want-r.left;taken+=r.steps||1;}
   const limited=this.debt>=this.h&&taken>=maxSteps;if(limited)this.debt=Math.min(this.debt,this.h*maxSteps);
   return {taken,limited};
  }
  newAcc(){this.acc={t0:this.t,i:0,v:0,p:0,src:0,load:0,dur:0,imin:Infinity,imax:-Infinity,vmin:Infinity,vmax:-Infinity};}
  accumulate(s2,i0,v0,t0,h){
   const a=this.acc,b0=this.bus(i0,v0,s2,t0),b1=this.bus(this.i,this.vC,s2,this.t);
   a.i+=h*(i0+this.i)/2;a.v+=h*(b0.v+b1.v)/2;a.p+=h*(b0.v*b0.icb+b1.v*b1.icb)/2;a.src+=h*(b0.isrc+b1.isrc)/2;a.load+=h*(b0.v*b0.iload+b1.v*b1.iload)/2;a.dur+=h;
   a.imin=Math.min(a.imin,i0,this.i);a.imax=Math.max(a.imax,i0,this.i);a.vmin=Math.min(a.vmin,b0.v,b1.v);a.vmax=Math.max(a.vmax,b0.v,b1.v);
  }
  closePeriod(){
   const a=this.acc;if(a.dur>0){const d=a.dur;
    const row={k:this.k,t:this.t,iavg:a.i/d,imin:a.imin,imax:a.imax,vbus:a.v/d,vmin:a.vmin,vmax:a.vmax,pbus:a.p/d,isrc:a.src/d,pload:a.load/d,d:this.d,iref:this.irefNow};
    this.last=row;this.history.push(row);if(this.history.length>400000)this.history.splice(0,200000);}
   this.newAcc();
  }
  record(s2){
   const j=this.head,b=this.bus(this.i,this.vC,!!s2,this.t);
   this.bt[j]=this.t;this.bi[j]=this.i;this.bv[j]=b.v;this.bg[j]=s2;this.bd[j]=this.d;this.br[j]=this.irefNow??0;this.bs[j]=b.isrc;
   this.head=(j+1)%CAP;this.n=Math.min(this.n+1,CAP);
  }
  each(t0,t1,fn,stride=1){
   const start=(this.head-this.n+CAP)%CAP;let lo=0,hi=this.n;
   while(lo<hi){const m=(lo+hi)>>1;if(this.bt[(start+m)%CAP]<t0)lo=m+1;else hi=m;}
   let c=0;for(let m=Math.max(0,lo-1);m<this.n;m++){const j=(start+m)%CAP;if(this.bt[j]>t1)break;if(stride>1&&(c++%stride))continue;fn(this.bt[j],this.bi[j],this.bv[j],this.bg[j],this.bd[j],this.br[j],this.bs[j]);}
  }
  // Instantaneous values for the live labels and arrows.
  now(){
   const s2=this.gate(),b=this.bus(this.i,this.vC,s2,this.t),[vlo,vhi]=this.sides(b.v);
   return {s2,i:this.i,vbus:b.v,vL:vlo-(s2?0:vhi),vlo,vhi,icb:b.icb,isrc:b.isrc,iload:b.iload,iC:b.iC,d:this.d,iref:this.irefNow,
     ist:this.p.pos==='above'?(s2?0:-this.i):this.i};
  }
 }
 root.BidirSim=BidirSim;
 if(typeof module!=='undefined')module.exports={BidirSim};
})(typeof window!=='undefined'?window:globalThis);
