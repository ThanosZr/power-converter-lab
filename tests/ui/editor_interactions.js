const {chromium}=require('playwright');const OUT=process.argv[3];
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];
 p.on('pageerror',e=>errs.push(String(e.stack||e)));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
 await p.goto(process.argv[2]);await p.evaluate(()=>localStorage.clear());await p.goto(process.argv[2]+'?tutorial=buck');await p.waitForTimeout(1200);
 const scr=async(x,y)=>p.evaluate(([x,y])=>{const s=PCL.editor.svg,pt=s.createSVGPoint();pt.x=x;pt.y=y;const q=pt.matrixTransform(s.getScreenCTM());return [q.x,q.y];},[x,y]);
 const R={};
 // 1) rectangle selection from empty space (left to right: fully inside)
 let a=await scr(290,110),c=await scr(470,260);const v0=await p.evaluate(()=>({...PCL.editor.view}));
 await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0]+40,a[1]+40,{steps:5});await p.mouse.move(...c,{steps:8});await p.screenshot({path:OUT+'/i1_marquee.png'});await p.mouse.up();
 R.marquee=await p.evaluate(()=>PCL.editor.selection());R.viewUnchanged=JSON.stringify(await p.evaluate(()=>PCL.editor.view))===JSON.stringify(v0);
 R.textSelected=await p.evaluate(()=>String(window.getSelection()));
 // 2) drag R1 by (+60,+40): wires stay orthogonal and attached
 await p.mouse.click(...await scr(900,900));// deselect (empty)
 a=await scr(520,210);await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0]+30,a[1]+20,{steps:4});const d=await scr(580,250);await p.mouse.move(...d,{steps:8});await p.mouse.up();
 R.r1=await p.evaluate(()=>{const e=PCL.editor,c=e.comp('R1');const ws=e.doc.wires.filter(w=>w.a.c==='R1'||w.b.c==='R1');
  return {pos:[c.x,c.y],wires:ws.map(w=>{const pts=e.wirePts(w);return {orth:EditorUtil.orth(pts),pts};})};});
 await p.screenshot({path:OUT+'/i2_drag.png'});
 // 3) drag the top segment of wire J2->R1 (y=150) down by 30
 const seg=await p.evaluate(()=>{const e=PCL.editor;const w=e.doc.wires.find(w=>w.a.c==='J2'&&w.b.c==='R1');const pts=e.wirePts(w);let k=0;for(let i=1;i<pts.length;i++)if(pts[i][1]===pts[i-1][1]&&Math.abs(pts[i][0]-pts[i-1][0])>40){k=i;break;}return {id:w.id,mid:[(pts[k][0]+pts[k-1][0])/2,pts[k][1]]};});
 a=await scr(...seg.mid);await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0],a[1]+10,{steps:3});await p.mouse.move(a[0],a[1]+(await scr(0,30))[1]-(await scr(0,0))[1],{steps:6});await p.mouse.up();
 R.seg=await p.evaluate(id=>{const e=PCL.editor,w=e.wire(id);const pts=e.wirePts(w);return {orth:EditorUtil.orth(pts),pts};},seg.id);
 // 4) undo restores the segment
 await p.keyboard.press('Control+z');R.undo=await p.evaluate(id=>PCL.editor.wirePts(PCL.editor.wire(id)),seg.id);
 // 5) right click on L1 -> scope voltage
 a=await scr(340,150);await p.mouse.click(...a,{button:'right'});await p.waitForTimeout(150);
 R.menu=(await p.locator('#ctx').innerText()).split('\n').slice(0,6);await p.screenshot({path:OUT+'/i3_menu.png'});
 await p.locator('#ctx button',{hasText:'Scope: τάση'}).first().click();R.channels=await p.evaluate(()=>PCL.scope.channels().map(c=>c.key));
 // 6) middle-drag pans
 const v1=await p.evaluate(()=>({...PCL.editor.view}));a=await scr(650,350);await p.mouse.move(...a);await p.mouse.down({button:'middle'});await p.mouse.move(a[0]+80,a[1]+40,{steps:6});await p.mouse.up({button:'middle'});
 const v2=await p.evaluate(()=>({...PCL.editor.view}));R.pan=[v1.cx-v2.cx,v1.cy-v2.cy];
 await p.evaluate(()=>PCL.editor.fit());
 // 7) draw a wire: add R2 and drag from its top pin to J2
 await p.evaluate(()=>PCL.editor.addPart('R',640,210));await p.evaluate(()=>{const c=PCL.editor.comp('R2');c.rot=1;PCL.editor.render();});
 const pin=await p.evaluate(()=>PCL.editor.pin('R2','a'));a=await scr(...pin);const tgt=await scr(430,150);
 await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0]-20,a[1]-20,{steps:4});await p.mouse.move(...tgt,{steps:10});await p.mouse.up();
 R.newWire=await p.evaluate(()=>{const e=PCL.editor;const w=e.doc.wires.find(w=>(w.a.c==='R2'||w.b.c==='R2'));return w?{a:w.a,b:w.b,orth:EditorUtil.orth(e.wirePts(w)),pts:e.wirePts(w)}:null;});
 // 8) drop a wire on the middle of an existing wire -> T junction
 const pin2=await p.evaluate(()=>PCL.editor.pin('R2','b'));a=await scr(...pin2);const mid=await scr(475,270);
 await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(a[0],a[1]+15,{steps:3});await p.mouse.move(...mid,{steps:10});await p.mouse.up();
 R.junction=await p.evaluate(()=>{const e=PCL.editor;const w=e.doc.wires.find(w=>(w.a.c==='R2'&&w.a.p==='b')||(w.b.c==='R2'&&w.b.p==='b'));return w?{to:w.a.c==='R2'?w.b:w.a,type:e.comp(w.a.c==='R2'?w.b.c:w.a.c)?.type}:null;});
 await p.screenshot({path:OUT+'/i4_wired.png'});
 // 9) simulation still consistent: run and read R2 current (parallel to R1 => same voltage)
 await p.evaluate(()=>{PCL.reset();});await p.click('#step10');await p.click('#step10');
 R.sim=await p.evaluate(()=>({vR1:PCL.S.sim.now('V:R1'),vR2:PCL.S.sim.now('V:R2'),warn:PCL.S.sim.net.warnings}));
 console.log(JSON.stringify(R,null,1));console.log('ERR',JSON.stringify(errs.slice(0,5)));await b.close();})().catch(e=>{console.error('FAILED',e);process.exit(1);});
