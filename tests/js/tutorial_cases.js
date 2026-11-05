// The new tutorials, built exactly as the studio builds them, against theory.
// Usage: node tutorial_cases.js -> JSON
const path=require('path');const W=path.resolve(__dirname,'../../web/studio');
global.window=globalThis;global.Parts=require(W+'/parts.js');const MNA=require(W+'/mna.js');require(W+'/tutorials.js');const M=require(W+'/metrics.js');
const T=globalThis.Tutorials;
function build(id,opts){const t=T.get(id);const o={};for(const op of t.options)o[op.k]=opts[op.k]??op.def;return t.build(o);}
function per(s,key){const p=s.per,i=s.chIndex.get(key);const t=[],y=[];const st=(p.head-p.n+p.cap)%p.cap;for(let k=0;k<p.n;k++){const j=(st+k)%p.cap;t.push(p.t[j]);y.push(p.avg[j*p.nch+i]);}return {t,y};}
function last(s,key,n=1){const p=s.per,i=s.chIndex.get(key);let a=0,q=0,mn=Infinity,mx=-Infinity;for(let k=1;k<=n;k++){const j=(p.head-k+p.cap)%p.cap,o=j*p.nch+i;a+=p.avg[o];q+=p.rms[o]**2;mn=Math.min(mn,p.min[o]);mx=Math.max(mx,p.max[o]);}return {avg:a/n,rms:Math.sqrt(q/n),min:mn,max:mx};}
function sim(pr,dur){const s=new MNA.Sim(pr,{hDiv:pr.sim.hDiv,method:pr.sim.method||'TR'});s.run(dur);return s;}
const out={};const t0=Date.now();
for(const ctrl of ['pi','pid']){const pr=build('buck_vloop',{ctrl});const s=sim(pr,pr.sim.stopT);const {t,y}=per(s,'V:C1');
 const ref=t=>t<.004?12:15;const a=M.responseMetrics({t,y,tStep:.004,tEnd:.010,ref}),b=M.responseMetrics({t,y,tStep:.010,tEnd:.018,ref});
 out['vloop_'+ctrl]={vo_end:last(s,'V:C1',20).avg,il_end:last(s,'I:L1',20).avg,os:a.overshoot,ts:a.ts,rise:a.rise,ess:a.ess,iae:a.IAE,load_dev:b.maxDev,load_ts:b.ts,load_disturbance:b.disturbance};}
for(const load of ['r','rl'])for(const alpha of ['0','60','90']){const pr=build('scr1',{load,alpha});const s=sim(pr,load==='rl'?.2:.06);out[`scr1_${load}_${alpha}`]={vd:last(s,'N:'+s.net.pinNet.get('JPR:j').canon,2).avg,id:last(s,'I:R1',2).avg};}
for(const dev of ['diode','30','60'])for(const load of ['r','rl']){const pr=build('bridge3',{dev,load});const s=sim(pr,.06);const vr=last(s,'V:R1',2),ia=last(s,'I:V1',2);out[`b3_${dev}_${load}`]={vR:vr.avg,vmin:vr.min,vmax:vr.max,id:last(s,'I:R1',2).avg,ia_rms:ia.rms};}
{const pr=build('flyback',{lk:'clamp'});const s=sim(pr,3e-3);out.fly_clamp={vo:last(s,'V:C1',20).avg,vsw_max:last(s,'V:S1',5).max,vc:last(s,'V:Cc',20).avg,prc:last(s,'P:Rc',20).avg,im_pk:last(s,'I:T1',5).max};}
{const pr=build('flyback',{lk:'ideal'});const s=sim(pr,3e-3);out.fly_ideal={vo:last(s,'V:C1',20).avg,vsw_max:last(s,'V:S1',5).max};}
for(const ctrl of ['fixed','pi']){const pr=build('battery',{sw:'real',ctrl});const s=sim(pr,ctrl==='pi'?.006:.002);out['bat_real_'+ctrl]={il:last(s,'I:L1',5).avg,psw1:last(s,'PSW:S1',5).avg,psw2:last(s,'PSW:S2',5).avg,p1:last(s,'P:S1',5).avg,p2:last(s,'P:S2',5).avg};}
// steady-state starts (CCM and DCM): the output must not drift away from where it starts
for(const [id,o] of [['buck',{load:'10',start:'steady'}],['buck',{load:'50',start:'steady'}],['boost',{load:'20',start:'steady'}],['boost',{load:'200',start:'steady'}]]){
 const pr=build(id,o);const v0=pr.components.find(c=>c.id==='C1').params.v0;const s=new MNA.Sim(pr,{hDiv:pr.sim.hDiv});s.run(5*s.T);const a=last(s,'V:C1',5).avg;s.run(195*s.T);
 out[`start_${id}_${o.load}`]={v0,first:a,after:last(s,'V:C1',5).avg};}
out.ms=Date.now()-t0;console.log(JSON.stringify(out,null,1));
