// Optional browser check. Needs Node + Playwright and a running server:
//   node tests/ui/ui_interactions.js http://127.0.0.1:8766 <screenshot-folder> examples/flyback_dcm_project.json
const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});
 const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(String(e)));
 await p.goto(process.argv[2]);await p.evaluate(()=>localStorage.clear());await p.reload();
 await p.waitForFunction(()=>document.querySelector('#mode-badge').textContent==='CCM',null,{timeout:20000});
 const r=p.locator('[data-comp="R1"] .comp-box');const bb=await r.boundingBox();
 await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);await p.mouse.down();await p.mouse.move(bb.x+bb.width/2-60,bb.y+bb.height/2+20,{steps:6});await p.mouse.up();
 await p.waitForTimeout(300);await p.mouse.click(bb.x+bb.width/2-60,bb.y+bb.height/2+20);await p.waitForTimeout(500);
 console.log('after drag+click inspector hidden:',await p.locator('#inspector').isHidden());
 const bb2=await r.boundingBox();console.log('moved by',Math.round(bb2.x-bb.x),Math.round(bb2.y-bb.y));
 await p.keyboard.press('Enter');await p.waitForTimeout(300);console.log('Enter opens:',await p.locator('#inspector header').innerText().catch(()=>'none'));
 await p.keyboard.press('Escape');console.log('Esc closes:',await p.locator('#inspector').isHidden());
 await p.click('#schematic');await p.keyboard.press('Space');await p.waitForTimeout(800);console.log('space→',await p.locator('#sim-play').innerText());await p.keyboard.press('Space');console.log('space→',await p.locator('#sim-play').innerText());
 await p.selectOption('#preset','boost');await p.waitForFunction(()=>document.querySelector('#model-heading').textContent==='Boost',null,{timeout:20000});await p.waitForTimeout(1500);
 console.log('boost preset:',await p.locator('#mode-badge').innerText(),(await p.locator('#spec-chips').innerText()).replace(/\n/g,' '));
 await p.selectOption('#sim-start','op');await p.selectOption('#sim-speed','1000');await p.click('#sim-play');await p.waitForTimeout(2500);await p.click('#sim-play');
 console.log('boost from OP:',(await p.locator('#sim-compare').innerText()).replace(/\n/g,' | '));
 await p.screenshot({path:process.argv[3]+'/t8_boost.png'});
 // load an example project file
 await p.setInputFiles('#file-input',process.argv[4]);await p.waitForTimeout(3000);
 console.log('project loaded:',await p.locator('#model-heading').innerText(),await p.locator('#mode-badge').innerText(),(await p.locator('#spec-chips').innerText()).replace(/\n/g,' '));
 // narrow layout
 await p.setViewportSize({width:1100,height:900});await p.waitForTimeout(800);await p.screenshot({path:process.argv[3]+'/t9_narrow.png',fullPage:false});
 console.log('ERRORS',JSON.stringify(errs));await b.close();
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
