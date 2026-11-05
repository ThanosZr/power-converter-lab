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
// 8) synchronous buck with dead time: body diode carries i_L > 0 in both dead times -> Vo = Vin(D - t_d f_s)
function syncBuck(sw,pwm){return project([{id:'V1',type:'VDC',params:{V:24}},{id:'S1',type:'SW',params:{pwm:'PWM1',out:'a',...sw}},{id:'S2',type:'SW',params:{pwm:'PWM1',out:'na',...sw}},{id:'L1',type:'L',params:{L:100e-6,i0:1.1}},
  {id:'C1',type:'C',params:{C:100e-6,v0:10.8}},{id:'R1',type:'R',params:{R:10}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.5,...pwm}}],
  [['V1:p','S1:d'],['S1:s','S2:d'],['S2:s','G:g'],['S1:s','L1:a'],['L1:b','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);}
{const s=new Sim(syncBuck({Ron:1e-6},{dt:500e-9}),{hDiv:400});s.run(500e-5);out.deadtime={vo:periodStats(s,'V:C1',20).avg,both_off:(()=>{let n=0;for(let i=0;i<200;i++){const t=s.t+i*1e-5/200;const k=s.net.ctrls[0];if(!s.gateOf(k,'a',t)&&!s.gateOf(k,'na',t))n++;}return n/200;})()};}
// 9) IGBT buck (V_ce0 = 1 V) and switching losses E_on/E_off
{const pr=project([{id:'V1',type:'VDC',params:{V:24}},{id:'S1',type:'SW',params:{pwm:'PWM1',model:'igbt',Vce0:1,Ron:1e-6,body:false,Eon:100e-6,Eoff:150e-6,Vref:24,Iref:1}},{id:'D1',type:'D',params:{Ron:1e-6}},{id:'L1',type:'L',params:{L:100e-6,i0:1.15}},
  {id:'C1',type:'C',params:{C:100e-6,v0:11.5}},{id:'R1',type:'R',params:{R:10}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.5}}],
  [['V1:p','S1:d'],['S1:s','D1:k'],['D1:a','G:g'],['S1:s','L1:a'],['L1:b','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);
 const s=new Sim(pr,{hDiv:400});s.run(500e-5);const il=periodStats(s,'I:L1',1);out.igbt={vo:periodStats(s,'V:C1',20).avg,vce_on:periodStats(s,'V:S1',1).min,psw:s.lastPeriod('PSW:S1').avg,ilmin:il.min,ilmax:il.max,pcond:periodStats(s,'P:S1',20).avg};}
// 10) transformer with leakage into R: |V_R| = n·V̂·R/|R + jω(L_lk1 n² + L_lk2)| (n = 1)
{const pr=project([{id:'V1',type:'VAC',params:{Vpk:100,f:1000}},{id:'T1',type:'XFMR',params:{n:1,Lm:1,Llk1:1e-3,Llk2:1e-3}},{id:'R1',type:'R',params:{R:10}},{id:'G',type:'GND'}],
  [['V1:p','T1:p1'],['V1:n','T1:p2'],['T1:s1','R1:a'],['T1:s2','R1:b'],['V1:n','G:g'],['T1:s2','G:g']]);
 const s=new Sim(pr,{hDiv:2000});s.run(0.02);const r=periodStats(s,'V:R1',2);out.leakage={vpk:(r.max-r.min)/2};}
// 11) single-phase thyristor bridge, α = 60°: R load and R-L load (continuous)
function scrBridge(alpha,load){const sc=(id,shift)=>({id,type:'SCR',params:{refsrc:'V1',alpha,shift,pw:20}});
 const comps=[{id:'V1',type:'VAC',params:{Vpk:325,f:50}},sc('T1',0),sc('T2',0),sc('T3',180),sc('T4',180),{id:'R1',type:'R',params:{R:10}},{id:'G',type:'GND'}];
 const w=[['V1:p','T1:a'],['T1:k','R1:a'],['T3:k','R1:a'],['V1:n','T3:a'],['T2:k','V1:n'],['T4:k','V1:p'],['T2:a','G:g'],['T4:a','G:g']];
 if(load==='rl'){comps.push({id:'L1',type:'L',params:{L:.5,i0:2*325/Math.PI*Math.cos(alpha*Math.PI/180)/10}});w.push(['R1:b','L1:a'],['L1:b','G:g']);}else w.push(['R1:b','G:g']);
 return project(comps,w);}
{const s=new Sim(scrBridge(60,'r'),{hDiv:2000});s.run(0.06);const a=periodStats(s,'V:R1',2).avg;
 const s2=new Sim(scrBridge(60,'rl'),{hDiv:2000});s2.run(0.2);out.scr1={vR:a,vRL:periodStats(s2,'V:R1',2).avg+periodStats(s2,'V:L1',2).avg,id:periodStats(s2,'I:L1',2).avg};}
// 12) three-phase bridge, diodes and thyristors (α = 30°), R load
function bridge3(alpha){const top=[['a',30],['b',150],['c',270]],bot=[['a',210],['b',330],['c',90]];const comps=[{id:'V1',type:'VAC3',params:{Vpk:325,f:50}},{id:'R1',type:'R',params:{R:20}},{id:'G',type:'GND'}];const w=[['V1:n','G:g']];
 top.forEach(([ph,sh],i)=>{const id='T'+(2*i+1);comps.push(alpha===null?{id,type:'D'}:{id,type:'SCR',params:{refsrc:'V1',alpha,shift:sh,pw:120}});w.push(['V1:'+ph,id+':a'],[id+':k','R1:a']);});
 bot.forEach(([ph,sh],i)=>{const id='B'+(2*i+1);comps.push(alpha===null?{id,type:'D'}:{id,type:'SCR',params:{refsrc:'V1',alpha,shift:sh,pw:120}});w.push(['R1:b',id+':a'],[id+':k','V1:'+ph]);});
 return project(comps,w);}
{const s=new Sim(bridge3(null),{hDiv:3000});s.run(0.06);const st=periodStats(s,'V:R1',2);const s2=new Sim(bridge3(30),{hDiv:3000});s2.run(0.06);
 out.bridge3={vd:st.avg,vmin:st.min,vmax:st.max,vscr:periodStats(s2,'V:R1',2).avg,ia_rms:Math.sqrt((()=>{const p=s.per,i=s.chIndex.get('I:V1');const j=(p.head-1+p.cap)%p.cap;return p.rms[j*p.nch+i]**2;})())};}
out.ms=Date.now()-t0;
console.log(JSON.stringify(out,null,1));
