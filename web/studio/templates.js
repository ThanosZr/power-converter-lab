'use strict';
// Solution templates as data (schema "pcl-template-1", see engine/templates.py).
// The files listed in exercises/index.json are loaded at start-up; the user can
// also open a template file. A data template has the same place in the
// "Υπολογισμοί & μαθηματικά" panel as a code template (exercises/*.js): it is
// attached to a tutorial, or to any circuit when opened by the user.
(function(root){
 const reg=root.Exercises=root.Exercises||{list:[],register(t){this.list.push(t);},forTutorial(id){return this.list.find(t=>t.tutorial===id);}};
 reg.data=reg.data||[];
 reg.validate=function(tpl){
  if(!tpl||typeof tpl!=='object')throw Error('Δεν είναι αντικείμενο JSON.');
  if(tpl.schema!=='pcl-template-1')throw Error('Λείπει το "schema": "pcl-template-1".');
  if(typeof tpl.id!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(tpl.id))throw Error('Μη έγκυρο "id".');
  for(const k of ['inputs','steps','sections'])if(tpl[k]!==undefined&&!Array.isArray(tpl[k]))throw Error(`Το "${k}" πρέπει να είναι λίστα.`);
  if(!(tpl.sections||[]).length)throw Error('Το template δεν έχει "sections".');
  return tpl;};
 reg.registerData=function(tpl,src,any=false){this.validate(tpl);const t={kind:'data',id:tpl.id,tutorial:tpl.tutorial||null,any,title:tpl.title||tpl.id,template:tpl,src};
  this.data=this.data.filter(x=>x.id!==t.id);this.data.push(t);return t;};
 // every solution source for a tutorial: code templates, data templates, user templates
 reg.allFor=function(tid){return [...this.list.filter(t=>t.tutorial===tid).map(t=>({kind:'code',id:t.id,title:t.title,src:'exercises/'+t.id+'.js',code:t})),
  ...this.data.filter(t=>t.tutorial===tid||t.any)];};
 reg.load=async function(base='studio/exercises/'){const out=[];try{const idx=await (await fetch(base+'index.json')).json();
  for(const f of idx.templates||[]){try{const t=await (await fetch(base+f)).json();out.push(this.registerData(t,'exercises/'+f));}catch(e){console.warn('template',f,e.message);}}}catch(e){console.warn('templates index',e.message);}return out;};
 // values for the inputs: user override > circuit/tutorial binding > template default
 reg.resolveInputs=function(tpl,{meta,param,overrides}){const vals={},src={};
  for(const inp of tpl.inputs||[]){const o=overrides?.[inp.name];if(Number.isFinite(o)){vals[inp.name]=o;src[inp.name]='χειροκίνητα';continue;}
   const f=String(inp.from||'');let v;
   if(f.startsWith('meta.')){v=+meta?.[f.slice(5)];if(Number.isFinite(v))src[inp.name]='tutorial';}
   else if(f.startsWith('comp.')){const [,id,k]=f.split('.');v=+param(id)?.[k];if(Number.isFinite(v))src[inp.name]='κύκλωμα '+id+'.'+k;}
   if(Number.isFinite(v))vals[inp.name]=v;else src[inp.name]='προεπιλογή';}
  return {vals,src};};
})(window);
