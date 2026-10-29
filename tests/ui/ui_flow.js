// Optional browser check. Needs Node + Playwright and a running server:
//   python run.py --no-browser --port 8766
//   node tests/ui/ui_flow.js http://127.0.0.1:8766 <screenshot-folder>
const {chromium}=require('playwright');
const OUT=process.argv[3];
(async()=>{
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});
 const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push(String(e)));
 const log=(...a)=>console.log(...a);
 await p.goto(process.argv[2]);await p.evaluate(()=>localStorage.clear());await p.reload();
 await p.waitForFunction(()=>document.querySelector('#mode-badge').textContent==='CCM',null,{timeout:20000});
 await p.waitForTimeout(1500);
 await p.screenshot({path:OUT+'/t1_boot.png'});
 // double click inductor
 const box=await p.locator('[data-comp="L1"] .comp-box').boundingBox();
 await p.mouse.dblclick(box.x+box.width/2,box.y+box.height/2);
 await p.waitForSelector('#inspector:not([hidden])',{timeout:3000});
 log('inspector title:',await p.locator('#inspector header').innerText());
 await p.screenshot({path:OUT+'/t2_inspector.png'});
 await p.fill('#inspector [data-key="L"]','2');await p.click('#insp-apply');
 await p.waitForFunction(()=>document.querySelector('#mode-badge').textContent==='DCM',null,{timeout:20000});
 log('mode after L=2μH:',await p.locator('#mode-badge').innerText(),'| chips:',(await p.locator('#spec-chips').innerText()).replace(/\n/g,' '));
 // run sim at 10x
 await p.selectOption('#sim-speed','1000');await p.click('#sim-play');await p.waitForTimeout(4000);
 log('readout:',(await p.locator('#sim-readout').innerText()).replace(/\n/g,' '));
 log('compare:',(await p.locator('#sim-compare').innerText()).replace(/\n/g,' | '));
 log('live L label:',await p.locator('[data-live="L1"]').textContent(),'| C:',await p.locator('[data-live="C1"]').textContent());
 await p.screenshot({path:OUT+'/t3_sim_fast.png'});
 // slow motion, 1 period window, T/50
 await p.selectOption('#sim-speed','1');await p.selectOption('#sim-window','1');await p.selectOption('#sim-step','50');await p.waitForTimeout(2500);
 log('slow svg class:',await p.locator('#schematic svg').getAttribute('class'),'| live S:',await p.locator('[data-live="S1"]').textContent(),'| D:',await p.locator('[data-live="D1"]').textContent());
 log('step note:',await p.locator('#sim-step-note').innerText(),'| speed note:',await p.locator('#sim-speed-note').innerText());
 await p.screenshot({path:OUT+'/t4_sim_slow.png'});
 await p.click('#sim-play');// pause
 // chip click -> capacitor inspector, C for target ripple
 await p.locator('#spec-chips .chip',{hasText:'C'}).filter({hasText:'μF'}).first().click();
 await p.waitForSelector('#inspector:not([hidden])');
 log('chip inspector:',(await p.locator('#inspector header').innerText()).replace(/\n/g,' '));
 await p.fill('#insp-ripple','50');await p.click('#insp-cmin');const cval=await p.inputValue('#inspector [data-key="C"]');log('C for 50 mV:',cval);
 await p.click('#insp-apply');await p.waitForTimeout(2500);
 log('ripple chip after:',(await p.locator('#spec-chips').innerText()).replace(/\n/g,' '));
 // switch drive mode via switch inspector
 const sb=await p.locator('[data-comp="S1"] .comp-box').boundingBox();await p.mouse.dblclick(sb.x+sb.width/2,sb.y+sb.height/2);
 await p.waitForSelector('#inspector:not([hidden])');await p.selectOption('#inspector [data-choice="drive"]','fixed_duty');
 await p.fill('#inspector [data-key="duty_set"]','0.4');await p.click('#insp-apply');await p.waitForTimeout(2500);
 log('fixed duty chips:',(await p.locator('#spec-chips').innerText()).replace(/\n/g,' '),'| badge',await p.locator('#mode-badge').innerText());
 // topology flyback
 await p.click('#topologies button[data-key="flyback"]');await p.waitForTimeout(3000);
 log('flyback badge:',await p.locator('#mode-badge').innerText(),'| status:',await p.locator('#circuit-status').innerText());
 const tb=await p.locator('[data-comp="T1"] .comp-box').boundingBox();await p.mouse.dblclick(tb.x+tb.width/2,tb.y+tb.height/2);
 await p.waitForSelector('#inspector:not([hidden])');await p.screenshot({path:OUT+'/t5_flyback_inspector.png'});
 await p.keyboard.press('Escape');
 await p.selectOption('#sim-speed','100');await p.selectOption('#sim-window','10');await p.selectOption('#sim-step','500');await p.click('#sim-reset');await p.click('#sim-play');await p.waitForTimeout(3000);await p.click('#sim-play');
 await p.screenshot({path:OUT+'/t6_flyback_sim.png'});
 for(const tab of ['design','custom','symbolic','waves','verify','workspace']){await p.click(`.tabs button[data-tab="${tab}"]`);await p.waitForTimeout(2500);log('tab',tab,'content chars',(await p.locator('#content').innerText()).length);}
 await p.screenshot({path:OUT+'/t7_full.png',fullPage:true});
 log('ERRORS',JSON.stringify(errs));await b.close();
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
