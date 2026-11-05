'use strict';
// Multi-pane oscilloscope over the simulator's recorded data.
//  * raw samples (min/max decimated per pixel column) while the window fits in
//    the ring buffer, per-period mean + min/max band beyond it
//  * roll / period-synchronised display, frozen view with wheel zoom + drag pan
//  * hover readout, two pinned cursors (click / Shift+click), window statistics
(function(root){
 const COLORS=['#147966','#c47a1c','#2f5fa0','#b03a5b','#6b4fa0','#3d8b3d','#1f8fa0','#8a5a2b'];
 const UNIT={V:'V',I:'A',P:'W',N:'V',VN:'V',V2:'V',I2:'A',Im:'A',D:'',G:'',REF:'',MEAS:''};
 function niceStep(span,n){const raw=span/Math.max(1,n),p=Math.pow(10,Math.floor(Math.log10(raw))),m=raw/p;return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p;}
 function fmtT(t,step,tmax){const m=Math.max(Math.abs(tmax??t),step);const [k,u]=m<1e-6?[1e9,'ns']:m<1e-3?[1e6,'μs']:m<1?[1e3,'ms']:[1,'s'];const d=Math.max(0,Math.ceil(-Math.log10(step*k)-1e-9));return (t*k).toLocaleString('el-GR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:false})+' '+u;}
 const eng=(v,u)=>root.Parts.eng(v,u,4);
 class Scope{
  constructor(canvas,opt={}){
   this.cv=canvas;this.ctx=canvas.getContext('2d');this.opt=opt;this.sim=null;
   this.cfg={panes:[{ch:[]}],window:{unit:'T',n:20},trigger:'roll',display:'auto',frozen:null,cursors:[]};
   this.hoverX=null;this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas.parentElement);
   canvas.addEventListener('pointermove',e=>{this.hoverX=e.offsetX;this.hoverY=e.offsetY;if(this.drag)this.panTo(e);if(!this.running)this.draw();});
   canvas.addEventListener('pointerleave',()=>{this.hoverX=null;if(!this.running)this.draw();this.opt.onhover?.(null);});
   canvas.addEventListener('pointerdown',e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);this.drag={x:e.offsetX,view:this.viewRange(),moved:false};});
   canvas.addEventListener('pointerup',e=>{const d=this.drag;this.drag=null;if(d&&!d.moved)this.cursorAt(e);});
   canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoomAt(e.offsetX,Math.exp(e.deltaY*.0015));},{passive:false});
   canvas.addEventListener('dblclick',()=>{this.cfg.frozen=null;this.cfg.cursors=[];this.opt.onchange?.();this.draw();});
  }
  attach(sim){this.sim=sim;this.draw();}
  // navigation buttons: start, left, right, live, focus, in, out, all, autoy
  nav(kind){const s=this.sim;if(!s)return;const T=s.T,end=Math.max(s.t,1e-12);const [a,b]=this.viewRange(),span=b-a,live=!this.cfg.frozen;
   const clamp=(x0,x1)=>{const w=x1-x0;if(x1>=end-1e-12*end){if(w>=end){this.cfg.frozen=[0,end];return;}this.cfg.frozen=null;this.cfg.window={unit:'s',n:w};return;}if(x0<0){x0=0;x1=w;}this.cfg.frozen=[x0,x1];};
   if(kind==='live'){this.cfg.frozen=null;}
   else if(kind==='start')this.cfg.frozen=[0,Math.min(span,end)];
   else if(kind==='left')clamp(a-span/2,b-span/2);
   else if(kind==='right')clamp(a+span/2,b+span/2);
   else if(kind==='focus'){const w=3*T;if(live){this.cfg.window={unit:'T',n:3};}else this.cfg.frozen=[Math.max(0,b-w),b];}
   else if(kind==='in'||kind==='out'){const f=kind==='in'?.5:2,w=Math.max(span*f,4*s.h);if(live){const W=this.cfg.window;this.cfg.window=W.unit==='T'?{unit:'T',n:Math.max(+(W.n*f).toPrecision(6),4*s.h/T)}:{unit:'s',n:w};}else{const c=(a+b)/2;clamp(c-w/2,c+w/2);}}
   else if(kind==='all')this.cfg.frozen=[0,end];
   else if(kind==='autoy')for(const p of this.cfg.panes)p.y={auto:true};
   this.opt.onchange?.();this.draw();}
  resize(){const r=this.cv.parentElement.getBoundingClientRect(),dpr=window.devicePixelRatio||1;this.W=Math.max(200,r.width);this.H=Math.max(160,r.height);
   this.cv.width=Math.round(this.W*dpr);this.cv.height=Math.round(this.H*dpr);this.cv.style.width=this.W+'px';this.cv.style.height=this.H+'px';this.ctx.setTransform(dpr,0,0,dpr,0,0);this.draw();}
  // ------------------------------------------------------------ channels
  static unitOf(key,sim){const pre=key.split(':')[0];if(pre==='REF'||pre==='MEAS'){const k=sim?.net.ctrls.find(c=>c.id===key.split(':')[1]);return k?.qty==='V'?'V':'A';}return UNIT[pre]??'';}
  resolve(key){const s=this.sim;if(!s)return -1;if(key.startsWith('VN:')){const pin=key.slice(3),n=s.net.pinNet.get(pin);if(!n)return -1;if(n.ground)return -2;return s.chIndex.get('N:'+n.canon)??-1;}return s.chIndex.get(key)??-1;}
  channels(){return this.cfg.panes.flatMap((p,pi)=>p.ch.map(c=>({...c,pane:pi})));}
  addChannel(key,label,pane=null){if(this.channels().some(c=>c.key===key))return false;const used=new Set(this.channels().map(c=>c.color));const color=COLORS.find(c=>!used.has(c))||COLORS[this.channels().length%COLORS.length];
   const unit=Scope.unitOf(key,this.sim);let pi=pane;if(pi===null){pi=this.cfg.panes.findIndex(p=>p.ch.length&&Scope.unitOf(p.ch[0].key,this.sim)===unit);if(pi<0){if(this.cfg.panes.length===1&&!this.cfg.panes[0].ch.length)pi=0;else if(this.cfg.panes.length<4){this.cfg.panes.push({ch:[]});pi=this.cfg.panes.length-1;}else pi=this.cfg.panes.length-1;}}
   while(this.cfg.panes.length<=pi)this.cfg.panes.push({ch:[]});this.cfg.panes[pi].ch.push({key,label,color,on:true});this.opt.onchange?.();this.draw();return true;}
  removeChannel(key){for(const p of this.cfg.panes)p.ch=p.ch.filter(c=>c.key!==key);this.cfg.panes=this.cfg.panes.filter((p,i)=>p.ch.length||i===0);this.opt.onchange?.();this.draw();}
  moveChannel(key,pane){let ch=null;for(const p of this.cfg.panes){const i=p.ch.findIndex(c=>c.key===key);if(i>=0)ch=p.ch.splice(i,1)[0];}if(!ch)return;while(this.cfg.panes.length<=pane)this.cfg.panes.push({ch:[]});this.cfg.panes[pane].ch.push(ch);this.cfg.panes=this.cfg.panes.filter((p,i)=>p.ch.length||i===0);this.opt.onchange?.();this.draw();}
  // ------------------------------------------------------------ data access
  windowSec(){const w=this.cfg.window,T=this.sim?.T||1e-3;return w.unit==='T'?w.n*T:w.n;}
  viewRange(){const s=this.sim;if(!s)return [0,1];if(this.cfg.frozen)return this.cfg.frozen;const W=this.windowSec();let t1=s.t;
   if(this.cfg.trigger==='sync'){const T=s.T;t1=Math.max(T,Math.floor(s.t/T+1e-9)*T);}if(t1<W)return [0,Math.max(W,1e-12)];return [t1-W,t1];}
  ringIndex(t){const r=this.sim.ring;const start=(r.head-r.n+r.cap)%r.cap;let lo=0,hi=r.n;while(lo<hi){const m=(lo+hi)>>1;if(r.t[(start+m)%r.cap]<t)lo=m+1;else hi=m;}return lo;}
  ringStart(){const r=this.sim.ring;return r.n?r.t[(r.head-r.n+r.cap)%r.cap]:Infinity;}
  // iterate raw samples of channel ci within [t0,t1] (one sample margin)
  eachRaw(ci,t0,t1,fn){const r=this.sim.ring;const start=(r.head-r.n+r.cap)%r.cap;let i=Math.max(0,this.ringIndex(t0)-1);
   for(;i<r.n;i++){const j=(start+i)%r.cap,t=r.t[j];fn(t,ci===-2?0:r.d[j*r.nch+ci]);if(t>t1)break;}}
  eachPeriod(ci,t0,t1,fn){const p=this.sim.per;const start=(p.head-p.n+p.cap)%p.cap;for(let i=0;i<p.n;i++){const j=(start+i)%p.cap,t=p.t[j];if(t<t0)continue;if(t>t1+this.sim.T)break;const o=j*p.nch+ci;fn(t,ci===-2?0:p.avg[o],ci===-2?0:p.min[o],ci===-2?0:p.max[o]);}}
  valueAt(ci,t){if(ci===-2)return 0;const r=this.sim.ring;if(!r.n)return NaN;const start=(r.head-r.n+r.cap)%r.cap;let i=this.ringIndex(t);i=Math.min(Math.max(i,0),r.n-1);
   const j=(start+i)%r.cap;if(i>0){const jp=(start+i-1)%r.cap,t0=r.t[jp],t1=r.t[j];if(t1>t0&&t<=t1){const a=(t-t0)/(t1-t0);return r.d[jp*r.nch+ci]*(1-a)+r.d[j*r.nch+ci]*a;}}return r.d[j*r.nch+ci];}
  // statistics over the visible window (time weighted)
  stats(key){const s=this.sim;if(!s)return null;const ci=this.resolve(key);if(ci===-1)return null;const [t0,t1]=this.viewRange();
   let S=0,Q=0,D=0,mn=Infinity,mx=-Infinity,pt=null,pv=0;
   if(this.usePeriods(t0)){let n=0;this.eachPeriod(ci,t0,t1,(t,a,lo,hi)=>{S+=a;n++;mn=Math.min(mn,lo);mx=Math.max(mx,hi);});if(!n)return null;return {avg:S/n,rms:NaN,min:mn,max:mx,pp:mx-mn,src:'period'};}
   this.eachRaw(ci,t0,t1,(t,v)=>{const tc=Math.min(Math.max(t,t0),t1);if(pt!==null&&tc>pt){const h=tc-pt;S+=h*(pv+v)/2;Q+=h*(pv*pv+pv*v+v*v)/3;D+=h;}if(t>=t0&&t<=t1){mn=Math.min(mn,v);mx=Math.max(mx,v);}pt=tc;pv=v;});
   if(D<=0)return null;return {avg:S/D,rms:Math.sqrt(Math.max(0,Q/D)),min:mn,max:mx,pp:mx-mn,src:'raw'};}
  usePeriods(t0){const d=this.cfg.display;if(d==='avg')return true;if(d==='raw')return false;const [a,b]=this.viewRange();return t0<this.ringStart()-1e-12&&(b-a)>3*this.sim.T||(b-a)/this.sim.h>4e5;}
  // ------------------------------------------------------------ interaction
  panTo(e){const d=this.drag;if(!d)return;const dx=e.offsetX-d.x;if(Math.abs(dx)>3)d.moved=true;if(!d.moved)return;const [a,b]=d.view,span=b-a,pw=this.plotW();const sh=-dx/pw*span;this.cfg.frozen=[a+sh,b+sh];this.opt.onfreeze?.();this.draw();}
  zoomAt(x,f){const [a,b]=this.viewRange(),pw=this.plotW();const tm=a+(Math.min(Math.max(x-this.padL,0),pw)/pw)*(b-a);const na=tm-(tm-a)*f,nb=tm+(b-tm)*f;if(nb-na<(this.sim?.h||1e-9)*4)return;this.cfg.frozen=[na,nb];this.opt.onfreeze?.();this.draw();}
  cursorAt(e){if(!this.sim)return;const [a,b]=this.viewRange();const t=a+(e.offsetX-this.padL)/this.plotW()*(b-a);if(t<a||t>b)return;
   if(e.shiftKey&&this.cfg.cursors.length)this.cfg.cursors[1]=t;else this.cfg.cursors=e.shiftKey?[t]:(this.cfg.cursors.length===1?[this.cfg.cursors[0],t]:[t]);this.opt.onchange?.();this.draw();}
  plotW(){return this.W-this.padL-this.padR;}
  // ------------------------------------------------------------ drawing
  draw(){
   const c=this.ctx,W=this.W||600,H=this.H||300;if(!c)return;c.clearRect(0,0,W,H);this.padL=64;this.padR=14;
   const css=getComputedStyle(this.cv);const ink=css.getPropertyValue('--scope-ink')||'#203a3f',grid=css.getPropertyValue('--scope-grid')||'#e3ebe7',bg=css.getPropertyValue('--scope-bg')||'#fbfdfc';
   c.fillStyle=bg;c.fillRect(0,0,W,H);
   const s=this.sim;const panes=this.cfg.panes;const top=6,bottom=24,gap=10,ph=(H-top-bottom-gap*(panes.length-1))/panes.length;
   if(!s){return;}
   const [t0,t1]=this.viewRange(),span=t1-t0,pw=this.plotW();const X=t=>this.padL+(t-t0)/span*pw;
   const periods=this.usePeriods(t0);
   const xs=niceStep(span,Math.max(2,Math.floor(pw/90)));
   this.layout=[];
   panes.forEach((pane,pi)=>{
    const y0=top+pi*(ph+gap),y1=y0+ph;const chans=pane.ch.filter(ch=>ch.on);
    // y range
    let lo=Infinity,hi=-Infinity;const data=[];
    for(const ch of chans){const ci=this.resolve(ch.key);if(ci===-1){data.push(null);continue;}
     const cols=new Map();
     if(periods){const pts=[];this.eachPeriod(ci,t0,t1,(t,a,mn,mx)=>{pts.push([t,a,mn,mx]);lo=Math.min(lo,mn);hi=Math.max(hi,mx);});data.push({ch,pts,kind:'per'});}
     else{const arr=[];this.eachRaw(ci,t0,t1,(t,v)=>{arr.push(t,v);if(t>=t0&&t<=t1){if(v<lo)lo=v;if(v>hi)hi=v;}});data.push({ch,arr,kind:'raw'});}
     void cols;}
    if(pane.y&&pane.y.auto===false&&Number.isFinite(pane.y.min)&&Number.isFinite(pane.y.max)&&pane.y.max>pane.y.min){lo=pane.y.min;hi=pane.y.max;}
    else{if(!Number.isFinite(lo)){lo=-1;hi=1;}if(pane.zero){lo=Math.min(lo,0);hi=Math.max(hi,0);}const pad=(hi-lo)*.08||Math.max(Math.abs(hi)*.05,1e-6);lo-=pad;hi+=pad;}
    const Y=v=>y1-(v-lo)/(hi-lo)*(y1-y0);this.layout.push({y0,y1,lo,hi,Y,chans});
    // grid
    c.strokeStyle=grid;c.lineWidth=1;c.fillStyle=ink;c.font='10.5px ui-monospace,Menlo,Consolas,monospace';c.textAlign='right';c.textBaseline='middle';
    const ys=niceStep(hi-lo,Math.max(2,Math.floor(ph/34)));const unit=chans.length?Scope.unitOf(chans[0].key,s):'';
    for(let v=Math.ceil(lo/ys)*ys;v<=hi;v+=ys){const y=Y(v);c.beginPath();c.moveTo(this.padL,y);c.lineTo(W-this.padR,y);c.stroke();c.fillText(eng(Math.abs(v)<ys*1e-6?0:v,unit),this.padL-6,y);}
    for(let t=Math.ceil(t0/xs)*xs;t<=t1;t+=xs){const x=X(t);c.beginPath();c.moveTo(x,y0);c.lineTo(x,y1);c.stroke();}
    if(lo<0&&hi>0){c.strokeStyle='#b8c7c1';c.beginPath();c.moveTo(this.padL,Y(0));c.lineTo(W-this.padR,Y(0));c.stroke();}
    c.strokeStyle='#c9d6d1';c.strokeRect(this.padL+.5,y0+.5,pw-1,ph-1);
    // traces
    c.save();c.beginPath();c.rect(this.padL,y0,pw,ph);c.clip();
    for(const d of data){if(!d)continue;const col=d.ch.color;
     if(d.kind==='per'){c.fillStyle=col+'33';c.beginPath();d.pts.forEach(([t,,mn],i)=>{i?c.lineTo(X(t),Y(mn)):c.moveTo(X(t),Y(mn));});for(let i=d.pts.length-1;i>=0;i--){const [t,,,mx]=d.pts[i];c.lineTo(X(t),Y(mx));}c.closePath();c.fill();
      c.strokeStyle=col;c.lineWidth=1.6;c.beginPath();d.pts.forEach(([t,a],i)=>{i?c.lineTo(X(t),Y(a)):c.moveTo(X(t),Y(a));});c.stroke();continue;}
     const arr=d.arr,n=arr.length/2;c.strokeStyle=col;c.lineWidth=1.5;c.lineJoin='round';c.beginPath();
     if(n<=pw*2){for(let i=0;i<n;i++){const x=X(arr[2*i]),y=Y(arr[2*i+1]);i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}
     else{let col0=-1,mn=0,mx=0,first=0,last=0,started=false;
      const flush=()=>{if(col0<0)return;const x=this.padL+col0+.5;if(!started){c.moveTo(x,Y(first));started=true;}else c.lineTo(x,Y(first));c.lineTo(x,Y(mn));c.lineTo(x,Y(mx));c.lineTo(x,Y(last));};
      for(let i=0;i<n;i++){const cx=Math.floor(X(arr[2*i])-this.padL),v=arr[2*i+1];if(cx!==col0){flush();col0=cx;mn=mx=first=last=v;}else{if(v<mn)mn=v;if(v>mx)mx=v;last=v;}}flush();c.stroke();}
     // average line of the last complete period (dashed) when enabled
     if(this.cfg.avgLine){const st=this.stats(d.ch.key);if(st){c.setLineDash([5,4]);c.lineWidth=1;c.beginPath();c.moveTo(this.padL,Y(st.avg));c.lineTo(W-this.padR,Y(st.avg));c.stroke();c.setLineDash([]);}}
    }
    // cursors
    for(const [i,tc] of this.cfg.cursors.entries()){if(tc<t0||tc>t1)continue;const x=X(tc);c.strokeStyle=i?'#b03a5b':'#2f5fa0';c.setLineDash([4,3]);c.beginPath();c.moveTo(x,y0);c.lineTo(x,y1);c.stroke();c.setLineDash([]);}
    c.restore();
    // pane title
    c.textAlign='left';c.textBaseline='top';c.font='600 10.5px Inter,system-ui,sans-serif';let lx=this.padL+8;
    for(const ch of chans){c.fillStyle=ch.color;const t=ch.label;c.fillText(t,lx,y0+5);lx+=c.measureText(t).width+14;}
   });
   // time axis
   c.fillStyle=ink;c.textAlign='center';c.textBaseline='top';c.font='10.5px ui-monospace,Menlo,Consolas,monospace';
   for(let t=Math.ceil(t0/xs)*xs;t<=t1;t+=xs)c.fillText(fmtT(t,xs,t1),X(t),H-bottom+6);
   c.textAlign='right';c.fillStyle='#7b8e88';c.fillText(periods?'μέση τιμή ανά περίοδο · σκιά: min–max':'',W-this.padR,H-bottom+6);
   // hover readout
   if(this.hoverX!==null&&this.hoverX>this.padL&&this.hoverX<W-this.padR){const t=t0+(this.hoverX-this.padL)/pw*span;c.strokeStyle='#7b8e8899';c.beginPath();c.moveTo(this.hoverX+.5,top);c.lineTo(this.hoverX+.5,H-bottom);c.stroke();
    const rows=[];for(const L of this.layout)for(const ch of L.chans){const ci=this.resolve(ch.key);if(ci===-1)continue;const v=periods?NaN:this.valueAt(ci,t);rows.push([ch,v]);if(Number.isFinite(v)){c.fillStyle=ch.color;c.beginPath();c.arc(this.hoverX,L.Y(v),3,0,7);c.fill();}}
    this.opt.onhover?.({t,rows});}
  }
 }
 Scope.COLORS=COLORS;root.Scope=Scope;
})(window);
