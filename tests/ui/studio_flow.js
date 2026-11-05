// End-to-end browser check of the studio (needs Node + Playwright).
// Usage: python run.py --no-browser --port 8775  then  node tests/ui/studio_flow.js http://127.0.0.1:8775/ <out-dir>
const {chromium}=require('playwright');const fs=require('fs');const OUT=process.argv[3]||'.';
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});const p=await ctx.newPage();const errs=[];
 p.on('pageerror',e=>errs.push(String(e.stack||e)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
 const base=process.argv[2];await p.goto(base);await p.evaluate(()=>localStorage.clear());await p.goto(base+'?tutorial=buck');await p.waitForTimeout(900);
 const scr=async(x,y)=>p.evaluate(([x,y])=>{const s=PCL.editor.svg,pt=s.createSVGPoint();pt.x=x;pt.y=y;const q=pt.matrixTransform(s.getScreenCTM());return [q.x,q.y];},[x,y]);
 const R={};
 // inspector by double click, live edit
 await p.mouse.dblclick(...await scr(340,150));await p.waitForTimeout(200);R.inspector=await p.locator('#inspector').isVisible();
 await p.fill('#inspector [data-k="L"]','200u');await p.press('#inspector [data-k="L"]','Enter');await p.waitForTimeout(150);
 R.Lparam=await p.evaluate(()=>PCL.editor.comp('L1').params.L);R.Lsim=await p.evaluate(()=>PCL.S.sim.net.compInfo.get('L1').main.L);
 await p.keyboard.press('Escape');
 // probes from the selection
 await p.mouse.click(...await scr(430,210));await p.click('#probe-v');R.chan=await p.evaluate(()=>PCL.scope.channels().map(c=>c.key));
 // live duty: steady buck, then D 0.5 -> 0.25 while running
 await p.selectOption('[data-topt="start"]','steady');await p.waitForTimeout(300);await p.selectOption('#speed','max');await p.click('#play');await p.waitForTimeout(800);
 R.vo1=await p.evaluate(()=>PCL.S.sim.lastPeriod('V:C1').avg);
 await p.evaluate(()=>{const r=document.querySelector('[data-d="PWM1"]');r.value=0.25;r.dispatchEvent(new Event('input'));r.dispatchEvent(new Event('change'));});
 await p.waitForTimeout(2500);R.vo2=await p.evaluate(()=>PCL.S.sim.lastPeriod('V:C1').avg);await p.click('#play');R.t=await p.evaluate(()=>PCL.S.sim.t);
 await p.screenshot({path:OUT+'/flow_live_d.png'});
 // settings: left drag pans when chosen
 await p.click('#open-settings');await p.selectOption('#settings [data-set="leftDrag"]','pan');await p.click('#settings-close');
 const v0=await p.evaluate(()=>({...PCL.editor.view}));let a=await scr(620,60);await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0]+60,a[1]+30,{steps:5});await p.mouse.up();
 R.leftPan=await p.evaluate(v0=>Math.abs(PCL.editor.view.cx-v0.cx)>1,v0);
 await p.click('#open-settings');await p.selectOption('#settings [data-set="leftDrag"]','select');await p.click('#settings-close');
 // copy / paste
 await p.evaluate(()=>PCL.editor.fit());await p.mouse.click(...await scr(520,210));await p.keyboard.press('Control+c');await p.keyboard.press('Control+v');
 R.pasted=await p.evaluate(()=>PCL.editor.doc.components.filter(c=>c.type==='R').map(c=>c.id));
 // save and reopen
 const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#save')]);const file=OUT+'/saved.pcl.json';await dl.saveAs(file);const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 await p.goto(base+'?tutorial=flyback');await p.waitForTimeout(600);
 const [fc]=await Promise.all([p.waitForEvent('filechooser'),p.click('#open')]);await fc.setFiles(file);await p.waitForTimeout(600);
 R.reopen={saved:saved.components.length,loaded:await p.evaluate(()=>PCL.editor.doc.components.length),hasR2:await p.evaluate(()=>!!PCL.editor.comp('R2'))};
 // gallery
 await p.click('#tutorials');await p.click('#gallery [data-tut="sepic"]');await p.waitForTimeout(500);R.gallery=await p.locator('#tut-title').innerText();
 console.log(JSON.stringify(R,null,1));console.log('ERR',JSON.stringify(errs.slice(0,5)));
 const ok=R.inspector&&Math.abs(R.Lsim-200e-6)<1e-12&&R.chan.includes('V:C1')&&Math.abs(R.vo1-12)<.2&&Math.abs(R.vo2-6)<.3&&R.leftPan&&R.pasted.length===2&&R.reopen.hasR2&&R.gallery==='SEPIC'&&!errs.length;
 console.log(ok?'PASS':'FAIL');await b.close();process.exit(ok?0:1);})().catch(e=>{console.error('FAILED',e);process.exit(1);});
