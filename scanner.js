'use strict';
window.BirrasScanner = (() => {
  let active=null,preview=null;
  const el=id=>document.getElementById(id);
  function words(text) {
    return String(text||'').normalize('NFC').replace(/[^\p{L}\p{N}\s/-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,120);
  }
  async function prepare(file) {
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Elegí una foto JPG, PNG o WebP.');
    if(file.size>15*1024*1024)throw new Error('La foto supera los 15 MB. Probá con una más chica.');
    let bitmap;
    try {bitmap=await createImageBitmap(file);}catch{throw new Error('No pudimos abrir esa foto. Probá con otra.');}
    try {
      if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>25000000)throw new Error('La foto es demasiado grande. Recortá la etiqueta y volvé a intentar.');
      const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return canvas;
    } finally {bitmap.close();}
  }
  function cancel() {active?.cancel();}
  async function readLocal(file,progress=()=>{}) {
    if(active)throw new Error('Ya estamos leyendo una etiqueta. Esperá un momento.');
    let worker,cancelled=false,rejectCancel,timer;
    const interrupted=new Promise((_,reject)=>{rejectCancel=reject;});
    const run={cancel(){if(cancelled)return;cancelled=true;rejectCancel(new Error('Lectura cancelada.'));if(worker)void worker.terminate().catch(()=>{});}};
    active=run;
    const work=(async()=>{
      try {
        const canvas=await prepare(file);
        if(cancelled)throw new Error('Lectura cancelada.');
        if(!window.Tesseract?.createWorker)throw new Error('No se pudo cargar el lector. Recargá la página y probá de nuevo.');
        worker=await window.Tesseract.createWorker(['spa','eng'],1,{
          workerPath:new URL('vendor/ocr/worker.min.js',document.baseURI).href,
          corePath:new URL('vendor/ocr/',document.baseURI).href,
          langPath:new URL('vendor/ocr/',document.baseURI).href,
          workerBlobURL:false,cacheMethod:'none',
          logger(message){if(!cancelled)progress(message);},
          errorHandler(){if(!cancelled){cancelled=true;rejectCancel(new Error('Falló el lector de etiquetas. Probá con otra foto o buscá por texto.'));}}
        });
        if(cancelled)throw new Error('Lectura cancelada.');
        await worker.setParameters({tessedit_pageseg_mode:'11'});
        const result=await worker.recognize(canvas);
        return {text:result.data.text||'',confidence:Number(result.data.confidence)||0};
      } finally {if(worker)await worker.terminate().catch(()=>{});}
    })();
    timer=setTimeout(()=>{run.cancel();},120000);
    try{return await Promise.race([work,interrupted]);}
    finally{clearTimeout(timer);if(active===run)active=null;}
  }
  async function read(file,progress=()=>{},mode='gemini') {
    if(mode==='local')return readLocal(file,progress);
    if(active)throw new Error('Ya estamos leyendo una etiqueta. Esperá un momento.');
    const controller=new AbortController(),run={cancel(){controller.abort();}};active=run;
    const timer=setTimeout(()=>controller.abort(),55000);
    try {
      const canvas=await prepare(file);
      if(controller.signal.aborted)throw new Error('Lectura cancelada.');
      let image=canvas.toDataURL('image/jpeg',0.82);
      if(image.length>1333359)image=canvas.toDataURL('image/jpeg',0.55);
      if(image.length>1333359)throw new Error('La imagen sigue siendo muy grande. Recortá la etiqueta y volvé a probar.');
      progress({status:'identifying'});
      const result=await window.BirrasCloud.recognizeBeer(image,controller.signal);
      if(controller.signal.aborted)throw new Error('Lectura cancelada.');
      const text=[result.brand,result.name,result.style].filter(Boolean).join(' · ');
      // Marca y nombre bastan: un estilo deducido no debe bloquear una coincidencia.
      const query=[result.brand,result.name].filter(Boolean).join(' ')||result.style;
      return {text,query,identified:true};
    }catch(error){if(controller.signal.aborted)throw new Error('La lectura se canceló o tardó demasiado. Podés volver a intentar.');throw error;}
    finally{clearTimeout(timer);if(active===run)active=null;}
  }
  function updateMode() {
    const remote=el('scan-mode').value!=='local';
    el('scan-privacy').textContent=remote?'Al elegir una foto se envía a Google para identificar la etiqueta. En el nivel gratuito, Google puede usarla para mejorar sus productos. La app no la guarda. Requiere iniciar sesión.':'La foto se lee en este dispositivo y no se envía a Google. El lector local puede equivocarse con letras curvas o etiquetas oscuras.';
  }
  function clearPreview() {
    if(preview)URL.revokeObjectURL(preview);preview=null;
    el('scan-preview').removeAttribute('src');el('scan-preview').hidden=true;
  }
  function open() {
    const dialog=el('scan-dialog');
    if(dialog.open)return;
    el('scan-form').reset();el('scan-status').textContent='';el('scan-result').hidden=true;
    updateMode();
    clearPreview();dialog.showModal();
  }
  let selection=0;
  async function choose(file) {
    if(!file)return;
    const request=++selection;
    const inputs=[el('scan-camera'),el('scan-file'),el('scan-mode')];inputs.forEach(input=>{input.disabled=true;});
    el('scan-result').hidden=true;el('scan-status').textContent='Preparando la foto…';clearPreview();
    try {
      // No mostrar formatos ejecutables ni cargar URLs proporcionadas por el usuario.
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw new Error('Elegí JPG, PNG o WebP de hasta 15 MB.');
      preview=URL.createObjectURL(file);el('scan-preview').src=preview;el('scan-preview').hidden=false;
      const result=await read(file,message=>{
        if(request!==selection)return;
        el('scan-status').textContent=message.status==='identifying'?'Identificando la birra…':message.status==='recognizing text'?`Leyendo la etiqueta… ${Math.round((message.progress||0)*100)}%`:'Cargando el lector… La primera vez puede tardar un poco.';
      },el('scan-mode').value);
      if(request!==selection||!el('scan-dialog').open)return;
      el('scan-text').value=result.text.slice(0,4000);el('scan-query').value=words(result.query??result.text);
      el('scan-result').hidden=false;
      el('scan-status').textContent=words(result.text)?'Revisá el texto: dejá solo la marca, el nombre o el estilo para buscar.':'No encontramos texto legible. Probá de frente, sin reflejos, o escribí la marca y el nombre.';
      el('scan-query').focus();
    } catch(error) {if(request===selection&&el('scan-dialog').open){el('scan-status').textContent=error?.message||'No pudimos leer esa etiqueta. Probá con otra foto o buscá por texto.';el('scan-result').hidden=false;el('scan-text').value='';el('scan-query').value='';}}
    finally {if(request===selection)inputs.forEach(input=>{input.disabled=false;if(input.id!=='scan-mode')input.value='';});}
  }
  el('scan-close').addEventListener('click',()=>el('scan-dialog').close());
  el('scan-dialog').addEventListener('close',()=>{selection++;cancel();clearPreview();el('scan-camera').disabled=false;el('scan-file').disabled=false;el('scan-mode').disabled=false;el('scan-text').value='';el('scan-query').value='';});
  el('scan-mode').addEventListener('change',()=>{el('scan-result').hidden=true;el('scan-text').value='';el('scan-query').value='';el('scan-status').textContent='';clearPreview();updateMode();});
  for(const id of ['scan-camera','scan-file'])el(id).addEventListener('change',()=>choose(el(id).files[0]));
  el('scan-form').addEventListener('submit',event=>{
    event.preventDefault();const query=el('scan-query').value.trim();if(!query)return;
    el('scan-dialog').close();window.BirrasCatalog.find(query);
  });
  window.addEventListener('hashchange',()=>{if(el('scan-dialog').open)el('scan-dialog').close();});
  window.addEventListener('birras:session',()=>{if(el('scan-dialog').open)el('scan-dialog').close();});
  return {open,read,readLocal,cancel,words,prepare};
})();
