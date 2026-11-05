// Browser check of: response metrics, server reference solver overlay, data
// templates in the math panel, new tutorials and "open in studio" from /converter/.
// Usage: python run.py --no-browser --port 8775  then  node tests/ui/features_flow.js http://127.0.0.1:8775/
const {chromium}=require('playwright');
(async()=>{const U=process.argv[2]||'http://127.0.0.1:8775/';const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1500,height:1100}});const p=await ctx.newPage();
 const errs=[],fail=[];p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
 const ok=(c,msg)=>{if(!c)fail.push(msg);};
 await p.goto(U);await p.evaluate(()=>localStorage.clear());
 // voltage loop: run to the end, metrics panel, server comparison
 await p.goto(U+'?tutorial=buck_vloop');await p.waitForTimeout(1200);await p.click('#toend');
 await p.waitForFunction(()=>window.PCL.S.sim.t>=0.0179,null,{timeout:90000});await p.waitForTimeout(500);
 await p.click('#rm-block summary');await p.waitForTimeout(300);const rm=await p.$eval('#rm-out',e=>e.innerText);
 ok(/Υπερύψωση/.test(rm)&&/IAE/.test(rm),'metrics panel');
 await p.click('#bt-block summary');await p.selectOption('#bt-method','LSODA');await p.click('#bt-run');
 await p.waitForFunction(()=>!document.querySelector('#bt-run').disabled,null,{timeout:120000});
 const bt=await p.$eval('#bt-out',e=>e.innerText);ok(/Σύγκριση με LSODA/.test(bt),'batch table');
 const refs=await p.evaluate(()=>Object.keys(window.PCL.scope.refs?.data||{}).length);ok(refs>=3,'overlay traces');
 const dv=await p.evaluate(()=>{const B=window.PCL.S.batch;const t=B.data['V:C1'].t,y=B.data['V:C1'].y;return Math.abs(y[y.length-1]-window.PCL.S.sim.now('V:C1'));});ok(dv<0.05,'batch vs browser end value '+dv);
 const th=await p.$eval('#theory',e=>e.innerText);ok(/υπερύψωση/.test(th),'theory metrics');
 // data template for the battery
 await p.evaluate(()=>window.PCL.loadTutorial('battery',{}));await p.waitForTimeout(2500);
 const opts=await p.$$eval('#math-tpl option',o=>o.map(x=>x.value));ok(opts.includes('pe2_battery_data')&&opts.includes('pe2_battery'),'template choices '+opts);
 await p.selectOption('#math-tpl','pe2_battery_data');await p.waitForTimeout(1500);
 const kv=await p.$eval('#math .kv',e=>e.innerText);ok(/223,2 A/.test(kv),'template ripple');
 await p.fill('[data-tin="L"]','10u');await p.dispatchEvent('[data-tin="L"]','change');await p.waitForTimeout(1500);
 ok(/125 A/.test(await p.$eval('#math .kv',e=>e.innerText)),'template input edit');
 // new tutorials run and compare with theory
 for(const [id,o] of [['scr1',{alpha:'30'}],['bridge3',{dev:'60',load:'rl'}],['flyback',{lk:'clamp'}]]){await p.evaluate(([id,o])=>window.PCL.loadTutorial(id,o),[id,o]);await p.waitForTimeout(400);
  await p.evaluate(()=>{const S=window.PCL.S;S.sim.run(S.sim.T*(S.sim.T>1e-3?4:300));window.PCL.pause();});await p.waitForTimeout(600);
  const t=await p.$eval('#theory',e=>e.innerText);ok(/Προσομοίωση/.test(t)&&!/Προσομοίωση\s*\n?\s*—/.test(t.split('Διαφορά')[1]?.slice(0,30)||''),'theory '+id);}
 // open a /converter/ circuit in the studio
 await p.goto(U+'converter/');await p.waitForTimeout(800);await p.click('.topo-switch button[data-key="boost"]');
 await p.waitForFunction(()=>!state.dirty&&state.result?.config?.topology==='boost',null,{timeout:20000});
 const [q]=await Promise.all([ctx.waitForEvent('page'),p.click('#to-studio')]);await q.waitForLoadState();await q.waitForTimeout(1500);
 const imp=await q.evaluate(()=>({tut:window.PCL.S.tut.id,n:window.PCL.editor.doc.components.length,err:window.PCL.S.error}));ok(imp.tut==='boost'&&imp.n>=8&&!imp.err,'import '+JSON.stringify(imp));
 console.log(JSON.stringify({rm:rm.split('\n').slice(0,4),bt:bt.split('\n').slice(0,4),imp},null,1));
 console.log('ERR',errs);console.log(fail.length?'FAIL '+fail.join(' | '):'PASS');await b.close();process.exit(fail.length||errs.length?1:0);})();
