// Batch-solver requests built exactly as the studio builds them (MNA.exportForBatch).
// Usage: node batch_requests.js -> JSON {name: request}
const path=require('path');const W=path.resolve(__dirname,'../../web/studio');
global.window=globalThis;global.Parts=require(W+'/parts.js');const MNA=require(W+'/mna.js');require(W+'/tutorials.js');
const T=globalThis.Tutorials;const build=(id,opts={})=>{const t=T.get(id);const o={};for(const op of t.options)o[op.k]=opts[op.k]??op.def;return t.build(o);};
function project(comps,conns){let n=0;return {components:comps.map(c=>({x:0,y:0,rot:0,...c})),wires:conns.map(([a,b])=>{const [ac,ap]=a.split(':'),[bc,bp]=b.split(':');return {id:'w'+(n++),a:{c:ac,p:ap},b:{c:bc,p:bp},pts:[]};})};}
// same buck DCM as sim_cases.js (exact steady-state start)
const buckDcm=project([{id:'V1',type:'VDC',params:{V:24}},{id:'S1',type:'SW',params:{pwm:'PWM1',body:false}},{id:'D1',type:'D'},{id:'L1',type:'L',params:{L:10e-6}},
  {id:'C1',type:'C',params:{C:100e-6,v0:18}},{id:'R1',type:'R',params:{R:50}},{id:'G',type:'GND'},{id:'PWM1',type:'PWM',params:{fs:100e3,D:.3,carrier:'saw'}}],
  [['V1:p','S1:d'],['S1:s','D1:k'],['D1:a','G:g'],['S1:s','L1:a'],['L1:b','C1:p'],['C1:p','R1:a'],['R1:b','G:g'],['C1:n','G:g'],['V1:n','G:g']]);
const cases={buck_dcm:[buckDcm,null,['V:C1','I:L1']],rectifier:['rectifier',{},['I:R1']],bridge3_scr:['bridge3',{dev:'30',load:'r'},['V:R1']],
 battery_pi:['battery',{ctrl:'pi'},['I:L1','D:PWM1']],deadtime:['battery',{sw:'real',ctrl:'pi'},['I:L1']]};
const out={};for(const [k,[id,o,keys]] of Object.entries(cases)){const r=MNA.exportForBatch(typeof id==='string'?build(id,o):id,keys);out[k]={net:r.net,channels:r.channels};}
console.log(JSON.stringify(out));
