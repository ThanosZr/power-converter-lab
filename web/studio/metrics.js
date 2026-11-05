'use strict';
// Step-response metrics from a sampled signal (per-period averages, so the
// switching ripple does not count as overshoot).
//
// responseMetrics({t, y, tStep, tEnd, ref, band, bandOf})
//   t, y    arrays (same length), t increasing
//   tStep   instant of the step (reference or disturbance)
//   tEnd    end of the evaluation window (default: last sample)
//   ref     number, function of t, or null (then the error is y_final − y)
//   band    settling band as a fraction (default 0.02)
//   bandOf  'final' (± band·|y_final|, textbook) or 'step' (± band·|Δy|)
(function(root){
 function responseMetrics(o){
  const t=o.t,y=o.y,n=t.length,band=o.band??.02,tStep=o.tStep??t[0],tEnd=o.tEnd??t[n-1];
  const refAt=typeof o.ref==='function'?o.ref:Number.isFinite(o.ref)?()=>o.ref:null;
  let i0=-1;for(let i=0;i<n;i++){if(t[i]<=tStep+1e-15)i0=i;else break;}
  const idx=[];for(let i=0;i<n;i++)if(t[i]>tStep+1e-15&&t[i]<=tEnd+1e-15)idx.push(i);
  if(idx.length<3)return {ok:false,why:'Λίγα δείγματα μετά το βήμα: τρέξε την προσομοίωση πιο πολύ.'};
  const y0=i0>=0?y[i0]:y[idx[0]];
  const tail=Math.max(3,Math.round(idx.length*.1));let yf=0;for(let k=idx.length-tail;k<idx.length;k++)yf+=y[idx[k]];yf/=tail;
  const r0=refAt?refAt(tStep-1e-12):null,r1=refAt?refAt(tEnd):null;
  const target=refAt?r1:yf,dy=yf-y0,dir=Math.sign((refAt?r1-(r0??y0):dy))||1;
  const disturbance=Math.abs(refAt?(r1-(r0??r1)):dy)<band*Math.max(Math.abs(yf),1e-12);
  const tol=(o.bandOf==='step'&&!disturbance?Math.abs(dy):Math.abs(yf))*band||band;
  // peak / overshoot, rise time, settling
  let peak=-Infinity,tPeak=NaN,dev=0,tDev=NaN;
  for(const i of idx){const e=dir*(y[i]-yf);if(e>peak){peak=e;tPeak=t[i];}const a=Math.abs(y[i]-yf);if(a>dev){dev=a;tDev=t[i];}}
  let t10=NaN,t90=NaN;if(!disturbance)for(const i of idx){const f=(y[i]-y0)/dy;if(!Number.isFinite(t10)&&f>=.1)t10=t[i];if(!Number.isFinite(t90)&&f>=.9){t90=t[i];break;}}
  let last=-1;for(let k=0;k<idx.length;k++)if(Math.abs(y[idx[k]]-yf)>tol)last=k;
  const settled=last<idx.length-Math.max(2,Math.round(idx.length*.05));
  const ts=last<0?0:settled?t[idx[Math.min(last+1,idx.length-1)]]-tStep:NaN;
  // integral criteria from tStep to tEnd (trapezoidal)
  let IAE=0,ISE=0,ITAE=0;let pt=tStep,pe=(refAt?refAt(tStep):yf)-(i0>=0?y[i0]:y[idx[0]]);
  for(const i of idx){const e=(refAt?refAt(t[i]):yf)-y[i],h=t[i]-pt;IAE+=h*(Math.abs(e)+Math.abs(pe))/2;ISE+=h*(e*e+pe*pe)/2;ITAE+=h*((t[i]-tStep)*Math.abs(e)+(pt-tStep)*Math.abs(pe))/2;pt=t[i];pe=e;}
  return {ok:true,disturbance,y0,yf,dy,target,ess:refAt?target-yf:NaN,
   overshoot:!disturbance&&peak>0?100*peak/Math.abs(dy):0,tPeak:tPeak-tStep,maxDev:dev,tDev:tDev-tStep,
   rise:Number.isFinite(t10)&&Number.isFinite(t90)?t90-t10:NaN,ts,settled:last<0||settled,tol,IAE,ISE,ITAE,n:idx.length,window:[tStep,Math.min(tEnd,t[idx[idx.length-1]])]};
 }
 // all scheduled instants of a project (steps of R, V, I, P, D or the reference)
 function scheduleEvents(project,parseSched){const ev=[];
  for(const c of project.components||[]){const p=c.params||{};const name=c.label||c.id;
   const add=(s,what)=>{const sc=parseSched(s);if(!sc||sc.length<2)return;for(let i=1;i<sc.length;i++)if(sc[i][1]!==sc[i-1][1])ev.push({t:sc[i][0],what:`${what} ${name}: ${sc[i-1][1]} → ${sc[i][1]}`,id:c.id,kind:what});};
   if(c.type==='PWM'){if(p.mode==='pi')add(p.ref,'αναφορά');else add(p.dsched,'D');}
   else if(p.sched)add(p.sched,c.type==='R'?'R':c.type==='CPL'?'P':c.type==='IDC'?'I':'V');}
  ev.sort((a,b)=>a.t-b.t);return ev;}
 const api={responseMetrics,scheduleEvents};
 root.Metrics=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
