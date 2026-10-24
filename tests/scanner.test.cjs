const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(overrides={}) {
  const elements=new Map(),calls=[];
  const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,open:false,value:'',textContent:'',handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},removeAttribute(){},focus(){},reset(){},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}});return elements.get(id);};
  const canvas={getContext:()=>({fillRect(){},drawImage(){}})};
  const context={window:{addEventListener(){},Tesseract:{createWorker:async(langs,mode,options)=>{calls.push({langs,mode,options});return {setParameters:async()=>{},recognize:async()=>({data:{text:'PATAGONIA\nAMBER LAGER',confidence:90}}),terminate:async()=>calls.push('terminated')};}}},document:{baseURI:'https://example.test/',getElementById:element,createElement:()=>canvas},createImageBitmap:async()=>({width:4000,height:2000,close(){calls.push('bitmap-closed');}}),URL,setTimeout,clearTimeout,...overrides};
  vm.runInNewContext(fs.readFileSync('scanner.js','utf8'),context);
  return {api:context.window.BirrasScanner,calls,canvas,element,context};
}
const file={type:'image/jpeg',size:1024};
test('scanner reads with local workers and models, limits dimensions and releases resources',async()=>{
  const {api,calls,canvas}=setup();
  const result=await api.readLocal(file);
  assert.equal(result.text,'PATAGONIA\nAMBER LAGER');
  assert.equal(canvas.width,1800);assert.equal(canvas.height,900);
  const options=calls.find(c=>c.options).options;
  for(const key of ['workerPath','corePath','langPath'])assert.equal(new URL(options[key]).origin,'https://example.test');
  assert.equal(options.workerBlobURL,false);assert.equal(options.cacheMethod,'none');
  assert.ok(calls.includes('bitmap-closed'));assert.ok(calls.includes('terminated'));
});
test('scanner rejects executable, oversized and undecodable image input',async()=>{
  const {api}=setup();
  await assert.rejects(api.prepare({type:'image/svg+xml',size:1}),/JPG/);
  await assert.rejects(api.prepare({type:'image/png',size:16*1024*1024}),/15 MB/);
  await assert.rejects(setup({createImageBitmap:async()=>{throw Error();}}).api.prepare(file),/abrir/);
  await assert.rejects(setup({createImageBitmap:async()=>({width:9000,height:9000,close(){}})}).api.prepare(file),/grande/);
});
test('cancel during initialization discards results and terminates the late worker',async()=>{
  const {api,context}=setup();let initialized,terminated=0;
  context.window.Tesseract.createWorker=()=>new Promise(resolve=>{initialized=resolve;});
  const reading=api.readLocal(file);await new Promise(resolve=>setImmediate(resolve));
  api.cancel();await assert.rejects(reading,/cancelada/);
  initialized({terminate:async()=>{terminated++;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(terminated,1);
});
test('OCR text is bounded plain search text; closing clears the dialog',()=>{
  const {api,element}=setup();
  assert.equal(api.words('Patagonia\nAmber   Lager!'),'Patagonia Amber Lager');
  assert.ok(api.words('a'.repeat(500)).length<=120);
  api.open();element('scan-text').value='texto';element('scan-query').value='birra';element('scan-dialog').close();
  assert.equal(element('scan-text').value,'');assert.equal(element('scan-query').value,'');
});
test('real OCR engine recognizes a controlled label with locally packaged language data',async()=>{
  const {createWorker}=require('tesseract.js');
  const worker=await createWorker(['spa','eng'],1,{langPath:path.resolve('vendor/ocr'),cacheMethod:'none'});
  try {
    await worker.setParameters({tessedit_pageseg_mode:'11'});
    const {data}=await worker.recognize(path.join(__dirname,'fixtures/label.png'));
    assert.match(data.text,/PATAGONIA/i);assert.match(data.text,/AMBER LAGER/i);
  }finally{await worker.terminate();}
});

test('remote scan sends a reencoded JPEG and proposes brand and name without inventing catalogue entries',async()=>{
  const {api,canvas,context}=setup();let sent;
  canvas.toDataURL=()=> 'data:image/jpeg;base64,/9j/2Q==';
  context.AbortController=AbortController;
  context.window.BirrasCloud={recognizeBeer:async(image,signal)=>{sent={image,signal};return {brand:'Brahma',name:'Pomelo',style:'Estilo inseguro'};}};
  const result=await api.read(file);
  assert.equal(result.query,'Brahma Pomelo');assert.equal(sent.image,'data:image/jpeg;base64,/9j/2Q==');assert.ok(sent.signal);
});
