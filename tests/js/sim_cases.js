// Numerical checks of web/studio/mna.js against closed-form results.
// Usage: node sim_cases.js  -> prints JSON {case: {...}}
const path=require('path');
const W=path.resolve(__dirname,'../../web/studio');
global.Parts=require(W+'/parts.js');const MNA=require(W+'/mna.js');const METHOD=process.env.PCL_METHOD||'TR';class Sim extends MNA.Sim{constructor(p,o={}){super(p,{...o,method:METHOD});}}
function project(comps,conns){let n=0;return {components:comps.map(c=>({x:0,y:0,rot:0,...c})),wires:conns.map(([a,b])=>{const [ac,ap]=a.split(':'),[bc,bp]=b.split(':');return {id:'w'+(n++),a:{c:ac,p:ap},b:{c:bc,p:bp},pts:[]};})};}
function periodStats(sim,key,periods=1){ // average over the last `periods` base periods
 const i=sim.chIndex.get(key),p=sim.per;let s=0,mn=Infinity,mx=-Infinity;
 for(let k=1;k<=periods;k++){const j=(p.head-k+p.cap)%p.cap,o=j*p.nch+i;s+=p.avg[o];mn=Math.min(mn,p.min[o]);mx=Math.max(mx,p.max[o]);}
 return {avg:s/periods,min:mn,max:mx,pp:mx-mn};}
const out={};const t0=Date.now();
// 1) buck CCM
{const pr=project([{id:'V1',type:'VDC',params:{V:24}},{id:'S1',type:'SW',params:{pwm:'PWM1',body:false}},{id:'D1',type:'D'},{id:'L1',type:'L',params:{L:100e-6,i0:1.2}},
  {id:'C1',type:'C',params:{C:100e-6,v0:12}},{id:'R1',type:'R',params:{R:10}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.5}}],
  [['V1:p','S1:d'],['S1:s','D1:k'],['D1:a','G:g'],['S1:s','L1:a'],['L1:b','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);
 const s=new Sim(pr,{hDiv:200});s.run(400e-5);out.buck_ccm={vo:periodStats(s,'V:C1',10).avg,il:periodStats(s,'I:L1',10),steps:s.steps};}
// 2) buck DCM: Vo/Vin = 2/(1+sqrt(1+4K/D^2)), K=2L/(RT)
{const pr=project([{id:'V1',type:'VDC',params:{V:24}},{id:'S1',type:'SW',params:{pwm:'PWM1',body:false}},{id:'D1',type:'D'},{id:'L1',type:'L',params:{L:10e-6}},
  {id:'C1',type:'C',params:{C:100e-6,v0:18}},{id:'R1',type:'R',params:{R:50}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.3,carrier:'saw'}}],
  [['V1:p','S1:d'],['S1:s','D1:k'],['D1:a','G:g'],['S1:s','L1:a'],['L1:b','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);
 const s=new Sim(pr,{hDiv:200});s.run(300e-5);const il=periodStats(s,'I:L1',1);out.buck_dcm={vo:periodStats(s,'V:C1',10).avg,ilmin:il.min,ilmax:il.max};}
// 3) boost DCM: Vo/Vin=(1+sqrt(1+4D^2/K))/2
{const pr=project([{id:'V1',type:'VDC',params:{V:12}},{id:'L1',type:'L',params:{L:10e-6}},{id:'S1',type:'SW',params:{pwm:'PWM1',body:false}},{id:'D1',type:'D'},
  {id:'C1',type:'C',params:{C:470e-6,v0:42.497}},{id:'R1',type:'R',params:{R:100}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:50e3,D:.3,carrier:'saw'}}],
  [['V1:p','L1:a'],['L1:b','S1:d'],['S1:s','G:g'],['L1:b','D1:a'],['D1:k','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);
 const s=new Sim(pr,{hDiv:200});s.run(200/50e3);out.boost_dcm={vo:periodStats(s,'V:C1',20).avg,ilmin:periodStats(s,'I:L1',1).min};}
// 4) flyback CCM: Vo = Vin n D/(1-D)
{const pr=project([{id:'V1',type:'VDC',params:{V:24}},{id:'T1',type:'XFMR',params:{n:.5,Lm:200e-6,im0:.8333,pol:'opp'}},{id:'S1',type:'SW',params:{pwm:'PWM1',body:false}},{id:'D1',type:'D'},
  {id:'C1',type:'C',params:{C:220e-6,v0:8}},{id:'R1',type:'R',params:{R:8}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.4,carrier:'saw'}}],
  [['V1:p','T1:p1'],['T1:p2','S1:d'],['S1:s','G:g'],['T1:s1','D1:a'],['D1:k','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['T1:s2','G:g'],['V1:n','G:g']]);
 const s=new Sim(pr,{hDiv:200});s.run(15e-3);out.flyback={vo:periodStats(s,'V:C1',20).avg,im:periodStats(s,'Im:T1',20).avg,is:periodStats(s,'I2:T1',20).avg};}
// 5) bridge rectifier charging a battery E=200 V, R=2 Ω from 230 V rms
{const pr=project([{id:'V1',type:'VAC',params:{Vpk:230*Math.SQRT2,f:50}},{id:'D1',type:'D'},{id:'D2',type:'D'},{id:'D3',type:'D'},{id:'D4',type:'D'},{id:'R1',type:'R',params:{R:2}},{id:'E1',type:'VDC',params:{V:200}},{id:'G',type:'GND'}],
  [['V1:p','D1:a'],['V1:p','D3:k'],['V1:n','D2:a'],['V1:n','D4:k'],['D1:k','R1:a'],['D2:k','R1:a'],['R1:b','E1:p'],['E1:n','D3:a'],['E1:n','D4:a'],['E1:n','G:g']]);
 const s=new Sim(pr,{hDiv:4000});s.run(0.04);const ib=periodStats(s,'I:R1',1);out.rectifier={iavg:ib.avg,ipk:ib.max};}
// 6) bidirectional, storage above the bus: D=0.5, i_L(0)=-800 A (PE2 test B)
function bidir(control,i0){return project([{id:'VB',type:'VDC',params:{V:50}},{id:'L1',type:'L',params:{L:5.6e-6,i0}},{id:'S1',type:'SW',params:{pwm:'PWM1',out:'na',Ron:1e-6}},{id:'S2',type:'SW',params:{pwm:'PWM1',out:'a',Ron:1e-6}},
  {id:'VS',type:'VDC',params:{V:100}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:20e3,...control}}],
  [['VB:p','L1:a'],['L1:b','S1:s'],['L1:b','S2:d'],['S2:s','G:g'],['S1:d','VS:p'],['VS:n','G:g'],['VB:n','G:g']]);}
{const s=new Sim(bidir({D:.5},-800),{hDiv:500});s.run(40/20e3);const il=periodStats(s,'I:L1',1);out.bidir_open={iavg:il.avg,ripple:il.pp,pbus:-periodStats(s,'P:VB',1).avg};}
{const s=new Sim(bidir({mode:'pi',sensor:'L1',qty:'I',ref:'0:-800, 0.005:800',Kp:3.4417e-4,Ki:0.45965,ff:'ratio',ffA:'VB',ffB:'VS'},0),{hDiv:500});
 s.run(0.005);const a=periodStats(s,'I:L1',1).avg;s.run(0.005);const b=periodStats(s,'I:L1',1).avg;out.bidir_pi={at5ms:a,at10ms:b};}
// 7) bidirectional full system: unidirectional source + R_src, C_bus + ESR, CPL 60 kW, PI at -800 A
{const pr=project([{id:'VSRC',type:'VDC',params:{V:50,Rs:1e-3,uni:true}},{id:'CB',type:'C',params:{C:.1,v0:49.596,esr:2e-4}},{id:'LD',type:'CPL',params:{P:60e3,sched:'0:60000, 0.005:30000'}},
  {id:'L1',type:'L',params:{L:5.6e-6,i0:-800}},{id:'S1',type:'SW',params:{pwm:'PWM1',out:'na',Ron:1e-6}},{id:'S2',type:'SW',params:{pwm:'PWM1',out:'a',Ron:1e-6}},{id:'VS',type:'VDC',params:{V:100}},{id:'G',type:'GND'},
  {id:'PWM1',type:'PWM',params:{fs:20e3,mode:'pi',sensor:'L1',qty:'I',ref:'-800',Kp:3.4417e-4,Ki:0.45965,ff:'ratio',ffA:'CB',ffB:'VS'}}],
  [['VSRC:p','CB:p'],['CB:p','LD:p'],['CB:p','L1:a'],['L1:b','S1:s'],['L1:b','S2:d'],['S2:s','G:g'],['S1:d','VS:p'],['VS:n','G:g'],['VSRC:n','G:g'],['CB:n','G:g'],['LD:n','G:g']]);
 const s=new Sim(pr,{hDiv:500});s.run(99/20e3);const b=periodStats(s,'V:CB',1).avg,isb=periodStats(s,'I:VSRC',1).avg;s.run(40/20e3);
 out.bidir_system={vbus_before:b,isrc_before:isb,vbus_after:periodStats(s,'V:CB',1).avg,isrc_after:periodStats(s,'I:VSRC',1).avg};}
out.ms=Date.now()-t0;
console.log(JSON.stringify(out,null,1));
