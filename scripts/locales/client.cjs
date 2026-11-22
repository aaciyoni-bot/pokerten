'use strict';
const fs=require('node:fs');
const {englishEntry}=require('./english.cjs');
const path=require('node:path');
const {parse}=require('@babel/parser');

const attributes=new Set(['aria-label','aria-description','title','alt','placeholder']);
const setters=new Set(['showToast','alert','confirm','setStatus','setError','setMessage']);
const displayNames=new Set(['label','title','subtitle','heading','sub','caption','placeholder','hint','description']);
const prop=n=>n?.computed?n.property?.value:n?.property?.name;
const key=n=>n?.key?.name??n?.key?.value;
const element=n=>n?.type==='CallExpression'&&(n.callee.name==='h'||prop(n.callee)==='createElement');
function walk(n,visit){
  if(!n?.type)return;
  visit(n);
  for(const [k,v] of Object.entries(n)){
    if(k==='loc'||k==='extra'||k.endsWith('Comments'))continue;
    if(Array.isArray(v))v.forEach(child=>walk(child,visit));
    else if(v?.type)walk(v,visit);
  }
}
const json=v=>JSON.stringify(v).replaceAll('<','\\u003c');
function translateScript(source,labels,seen=new Set(),runtime=new Set()){
  const ast=parse(source,{sourceType:'unambiguous',plugins:['jsx']});
  const helpers=new Map(), edits=new Map();
  walk(ast,n=>{
    const f=n.type==='FunctionDeclaration'?n:n.type==='VariableDeclarator'?n.init:null;
    if(!f?.params||!n.id?.name||!/(?:createElement|\bh\()/.test(source.slice(f.start,f.end)))return;
    const slots=f.params.flatMap((p,i)=>displayNames.has(p.name)?[i]:[]);
    if(slots.length)helpers.set(n.id.name,slots);
  });
  function note(value){
    const k=value?.trim();
    if(k&&/[a-z]/i.test(k))seen.add(k);
    return k;
  }
  function literal(value){
    const k=note(value);
    return k&&Object.hasOwn(labels,k)?value.replace(k,()=>labels[k]):value;
  }
  function edit(n,text){edits.set(n.start,{end:n.end,text});}
  function wrap(n){edit(n,'window.PokerDisplayLabel('+source.slice(n.start,n.end)+')');}
  function constant(n){
    if(n?.type==='StringLiteral'){const k=note(n.value);if(k)runtime.add(k);}
    if(n?.type==='ConditionalExpression'){constant(n.consequent);constant(n.alternate);}
  }
  function visual(n){
    if(!n)return;
    switch(n.type){
      case 'StringLiteral':{const next=literal(n.value);if(next!==n.value)edit(n,json(next));break;}
      case 'TemplateLiteral':
        for(const q of n.quasis){
          const s=q.value.cooked;if(s==null)continue;
          const out=literal(s);if(out!==s)edit(q,out.replaceAll('\\','\\\\').replaceAll('`','\\`').replaceAll('${','\\${'));
        }break;
      case 'ConditionalExpression':visual(n.consequent);visual(n.alternate);break;
      case 'LogicalExpression':visual(n.right);break;
      case 'BinaryExpression':if(n.operator==='+'){visual(n.left);visual(n.right);}break;
      case 'Identifier':if(displayNames.has(n.name))wrap(n);break;
      case 'MemberExpression':case 'OptionalMemberExpression':
        if(prop(n)==='label')wrap(n);
        break;
    }
  }
  walk(ast,n=>{
    if(element(n)){
      const props=n.arguments[1]?.properties||[],tag=n.arguments[0]?.value;
      const dialog=props.some(p=>key(p)==='role'&&p.value?.value==='dialog');
      for(const p of props){
        if(attributes.has(key(p)))visual(p.value);
        if((dialog||['section','nav','form','details','aside','table'].includes(tag))&&key(p)==='dir'&&p.value?.value==='ltr')edit(p.value,'"rtl"');
      }
      n.arguments.slice(2).forEach(visual);
    }else if(n.type==='CallExpression'){
      const fn=n.callee.name||prop(n.callee);
      if(setters.has(fn))visual(n.arguments[0]);
      if(fn==='button'&&source.includes("const button=(name,fn,disabled=false)=>h('button'"))visual(n.arguments[0]);
      for(const i of helpers.get(fn)||[])constant(n.arguments[i]);
    }else if(n.type==='ObjectProperty'&&displayNames.has(key(n)))constant(n.value);
    else if(n.type==='FunctionDeclaration'&&n.id?.name==='errorText')
      walk(n.body,ch=>{if(ch.type==='ReturnStatement')visual(ch.argument);});
  });
  let end=source.length;const parts=[];
  for(const [pos,e] of [...edits].sort((a,b)=>b[0]-a[0])){
    if(e.end>end)throw Error('Overlapping interface translations');
    parts.push(source.slice(e.end,end),e.text);end=pos;
  }
  return [...parts,source.slice(0,end)].reverse().join('');
}
function build(root,out=root,options={}){
  const version=require(path.resolve(__dirname,'../../assets/release.json')).version;
  const labels=options.labels||require('./he.json');
  const seen=new Set(),runtime=new Set();
  const put=(name,value)=>{if(options.collect)return;const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,value);};
  const english=englishEntry(fs.readFileSync(path.join(root,'index.html'),'utf8'),version);
  put('index.html',english);
  let he=english.replace(/<html lang="en" dir="ltr"/,'<html lang="he" dir="rtl"');
  he=he.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(original,attrs,source)=>{
    const m=attrs.match(/\bsrc="(assets\/js\/[\w.-]+\.js)([^"]*)"/);
    if(m){
      if(/(?:equity-worker|range-model|viewer-access|sound-pack|poker-runtime|native-update|app-update)\.js$/.test(m[1]))return original;
      const value=fs.readFileSync(path.join(root,m[1]),'utf8');
      const changed=translateScript(value,labels,seen,runtime);
      if(changed===value)return original;
      const f=m[1].replace(/\.js$/,'.he.js');put(f,changed);
      return original.replace(m[1]+m[2],f+'?v='+version);
    }
    if(!source.trim()||/\bsrc=|application\//.test(attrs))return original;
    return '<script'+attrs+'>'+translateScript(source,labels,seen,runtime)+'</script>';
  });
  he=he.replace('<meta charset="UTF-8">','<meta charset="UTF-8"><script src="assets/js/hebrew-labels.js?v='+version+'"></script><link rel="stylesheet" href="assets/css/hebrew-ui.css?v='+version+'">');
  const data=Object.fromEntries([...runtime].filter(k=>Object.hasOwn(labels,k)).map(k=>[k,labels[k]]));
  put('assets/js/hebrew-labels.js','(function(){const d='+json(data)+';window.PokerDisplayLabel=v=>typeof v==="string"&&Object.hasOwn(d,v)?d[v]:v;})();\n');
  put('he.html',he);return seen;
}
if(require.main===module)build(process.argv[2]||'.',process.argv[3]||process.argv[2]||'.');
module.exports={build,englishEntry,translateScript};
