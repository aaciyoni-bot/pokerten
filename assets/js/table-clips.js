(function(root){
  'use strict';
  const {createElement:h,useEffect,useState,useRef}=root.React;
  const limit=256*1024;
  const types=['video/webm;codecs=vp8','video/webm','video/mp4'];
  const call=data=>root.fb.fx('pkTableClip',data);
  const button=(name,fn,disabled=false)=>h('button',{type:'button',onClick:fn,disabled},name);
  function useVideo(blob){
    const [url,setUrl]=useState('');
    useEffect(()=>{
      if(!blob){setUrl('');return;}
      const url=URL.createObjectURL(blob);setUrl(url);
      return ()=>URL.revokeObjectURL(url);
    },[blob]);
    return url;
  }
  function ClipPlayer({tableId,entry,canRemove,canWatch}){
    const [blob,setBlob]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const [expired,setExpired]=useState(false),mounted=useRef(false),clock=useRef(null);
    const url=useVideo(blob);
    useEffect(()=>{
      mounted.current=true;
      return ()=>{mounted.current=false;clearTimeout(clock.current);};
    },[]);
    async function act(op){
      if(busy)return;
      setBusy(true);setError('');
      try{
        const r=await call({op,tableId,sender:entry.uid,clipId:entry.clipId});
        if(!mounted.current)return;
        if(op==='remove'){setBlob(null);setExpired(true);return;}
        const bytes=Uint8Array.from(atob(r.video),ch=>ch.charCodeAt(0));
        setBlob(new Blob([bytes],{type:r.mime}));
        clearTimeout(clock.current);
        clock.current=setTimeout(()=>{setBlob(null);setExpired(true);},Math.min(90000,Math.max(0,r.remainingMs)));
      }catch(e){if(mounted.current){setError(e.message||'Unable to open clip.');if(String(e.code).endsWith('not-found'))setExpired(true);}}
      finally{if(mounted.current)setBusy(false);}
    }
    return h('div',{className:'table-clip'},url&&!expired?h('video',{src:url,playsInline:true,controls:true,autoPlay:true,muted:true,preload:'metadata'}):null,
      canWatch&&!expired&&button(url?'Close video':'Watch clip',()=>url?setBlob(null):act('get'),busy),
      !expired&&canRemove&&button('Remove clip',()=>act('remove'),busy),expired?'Clip expired or removed.':null,error&&!expired&&h('span',{role:'status'},error));
  }
  function Composer({tableId}){
    const [open,setOpen]=useState(false),[status,setStatus]=useState(''),[draft,setDraft]=useState(null),[recording,setRecording]=useState(false),[busy,setBusy]=useState(false);
    const live=useRef(0),rec=useRef(null),stream=useRef(null),timer=useRef(null),camera=useRef(null),cameraPending=useRef(false),clipId=useRef(null),sending=useRef(false);
    const preview=useVideo(draft);
    function release(){
      clearTimeout(timer.current);cameraPending.current=false;
      if(rec.current?.state==='recording')rec.current.stop();
      stream.current?.getTracks().forEach(t=>t.stop());
      stream.current=null;
      if(camera.current)camera.current.srcObject=null;
    }
    function reset(){
      live.current++;release();setOpen(false);setRecording(false);setBusy(false);setDraft(null);setStatus('');
    }
    useEffect(()=>()=>{live.current++;release();},[]);
    useEffect(()=>{
      const pause=()=>{if(document.hidden&&(cameraPending.current||stream.current))reset();};
      document.addEventListener('visibilitychange',pause);
      return ()=>document.removeEventListener('visibilitychange',pause);
    },[]);
    function accept(blob){
      if(!blob.size||blob.size>limit){setStatus('Clip is too large. Record again at a lower resolution.');return;}
      clipId.current=root.crypto.randomUUID();setDraft(blob);setStatus('');
    }
    async function record(){
      const generation=++live.current;cameraPending.current=true;setBusy(true);setStatus('Opening camera…');setDraft(null);
      try{
        const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:240},height:{ideal:320},frameRate:{ideal:12,max:15}},audio:false});
        if(generation!==live.current){media.getTracks().forEach(t=>t.stop());return;}
        cameraPending.current=false;stream.current=media;
        const type=types.find(t=>MediaRecorder.isTypeSupported(t));
        if(!type)throw Error('Camera recording is unavailable here. Choose a short clip instead.');
        const recorder=new MediaRecorder(media,{mimeType:type,videoBitsPerSecond:260000}),parts=[];
        rec.current=recorder;
        recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
        recorder.onerror=()=>{if(generation===live.current){live.current++;release();setRecording(false);setBusy(false);setStatus('Camera recording failed. Try again.');}};
        recorder.onstop=()=>{
          if(generation!==live.current)return;
          release();setRecording(false);setBusy(false);
          accept(new Blob(parts,{type:type.split(';')[0]}));
        };
        recorder.start();setRecording(true);setBusy(false);setStatus('Recording…');
        if(camera.current){camera.current.srcObject=media;camera.current.play().catch(()=>{});}
        timer.current=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},3000);
      }catch(e){if(generation===live.current){release();setRecording(false);setBusy(false);setStatus(e.name==='NotAllowedError'?'Camera permission was declined. You can choose a short clip.':e.message||'Camera unavailable.');}}
    }
    async function choose(file){
      if(!file)return;
      const type=file.type.split(';')[0];
      if(!['video/mp4','video/webm'].includes(type)||file.size>limit||!file.size){setStatus('Choose an MP4 or WebM up to 3 seconds and 256 KB.');return;}
      const generation=++live.current,video=document.createElement('video'),url=URL.createObjectURL(file);
      setBusy(true);setDraft(null);setStatus('Checking clip…');
      try{
        const duration=await new Promise((resolve,reject)=>{
          const done=(fn,value)=>{clearTimeout(timeout);video.onloadedmetadata=video.onerror=null;fn(value);};
          const timeout=setTimeout(()=>done(reject,Error('Could not read this video.')),4000);
          video.preload='metadata';video.onloadedmetadata=()=>done(resolve,video.duration);video.onerror=()=>done(reject,Error('Unsupported video.'));video.src=url;
        });
        if(!Number.isFinite(duration)||duration<=0||duration>3.1)throw Error('Choose a clip up to 3 seconds.');
        if(generation===live.current)accept(file);
      }catch(e){if(generation===live.current)setStatus(e.message);}
      finally{URL.revokeObjectURL(url);video.removeAttribute('src');video.load();if(generation===live.current)setBusy(false);}
    }
    async function send(){
      if(!draft||sending.current)return;
      sending.current=true;const generation=live.current;setBusy(true);setStatus('Sharing…');
      try{
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Unable to read clip.'));reader.readAsDataURL(draft);});
        if(generation!==live.current)return;
        await call({op:'send',tableId,clipId:clipId.current,mime:draft.type.split(';')[0],video:data});
        if(generation===live.current){reset();setStatus('Clip shared at this table.');}
      }catch(e){if(generation===live.current)setStatus(e.message||'Could not share clip.');}
      finally{sending.current=false;if(generation===live.current)setBusy(false);}
    }
    if(!open)return h('div',{className:'table-clip'},button('SnapCam',()=>{setOpen(true);setStatus('');}),status&&h('span',{role:'status'},status));
    const canRecord=!!(navigator.mediaDevices?.getUserMedia&&root.MediaRecorder);
    return h('div',{className:'table-clip'},h('span',null,'Share a 3-second clip with seated players for 90 seconds.'),
      h('video',{ref:camera,hidden:!recording,muted:true,playsInline:true,autoPlay:true}),
      preview&&h('video',{src:preview,controls:true,playsInline:true,muted:true}),
      canRecord&&button(recording?'Stop':'Record without sound',()=>recording?release():record(),busy),
      !recording&&!busy&&h('label',null,'Choose clip',h('input',{type:'file',accept:'video/mp4,video/webm',onChange:e=>{const file=e.target.files[0];e.target.value='';choose(file);}})),
      draft&&button('Share with table',send,busy||recording),button('Cancel',reset,sending.current),status&&h('span',{role:'status'},status));
  }
  root.PokerTableClips={Composer,ClipPlayer};
})(window);
