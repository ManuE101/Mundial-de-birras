const {test}=require('node:test');
const assert=require('node:assert/strict');
const handlerModule=()=>import('../supabase/functions/recognize-beer/handler.mjs');
const image='data:image/jpeg;base64,/9j/2Q==';
async function setup({user={id:'user',email_confirmed_at:'2026-10-24'},quota=true,quotaStatus=200,providerStatus=200,output={brand:'Brahma',name:'Pomelo',style:''},finish='STOP',secret='private-test-key',environment={}}={}){
  const calls=[];
  const {createHandler}=await handlerModule();
  const envs={SUPABASE_URL:'https://project.supabase.co',SUPABASE_ANON_KEY:'anon-test',GEMINI_API_KEY:secret,...environment};
  const handler=createHandler({env:name=>envs[name],fetch:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return Response.json(user,{status:user?200:401});
    if(url.includes('/rpc/'))return Response.json(quota,{status:quotaStatus});
    return Response.json({candidates:[{finishReason:finish,content:{parts:[{text:JSON.stringify(output)}]}}]},{status:providerStatus});
  }});
  const request=(body={image},headers={},method='POST')=>new Request('https://project.supabase.co/functions/v1/recognize-beer',{method,headers:{origin:'https://puntajedebirras.netlify.app',authorization:'Bearer user-token','content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return {handler,request,calls};
}
test('recognition verifies session and persistent budget before sending image to Google',async()=>{
  const {handler,request,calls}=await setup();const response=await handler(request());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{brand:'Brahma',name:'Pomelo',style:''});
  assert.equal(calls.length,3);assert.match(calls[0].url,/auth\/v1\/user/);assert.match(calls[1].url,/birras_reserve_scan/);
  assert.equal(calls[2].options.headers['x-goog-api-key'],'private-test-key');
  assert.doesNotMatch(calls[2].url,/private-test-key/);
  const payload=JSON.parse(calls[2].options.body);
  assert.equal(payload.contents[0].parts[0].inlineData.data,'/9j/2Q==');
  assert.equal(payload.generationConfig.responseMimeType,'application/json');
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('requests without session, with wrong origin or an unconfirmed account never call Google',async()=>{
  for(const [options,headers,status] of [[{}, {authorization:''},401],[{},{origin:'https://evil.test'},403],[{user:{id:'u'}},{},403],[{user:null},{},401]]){
    const {handler,request,calls}=await setup(options);assert.equal((await handler(request({image},headers))).status,status);
    assert.ok(calls.every(c=>!c.url.includes('googleapis')));
  }
});
test('unconfigured deployments fail safely without transmitting the image',async()=>{
  const {handler,request,calls}=await setup({secret:''});assert.equal((await handler(request())).status,503);assert.equal(calls.length,0);
});
test('new projects use publishable keys without depending on a legacy anon key',async()=>{
  for(const keys of [{default:'sb_publishable_test'},{custom:'sb_publishable_test'}]){
    const {handler,request,calls}=await setup({environment:{SUPABASE_ANON_KEY:'',SUPABASE_PUBLISHABLE_KEYS:JSON.stringify(keys)}});
    assert.equal((await handler(request())).status,200);assert.equal(calls[0].options.headers.apikey,'sb_publishable_test');
  }
});
test('missing configuration identifies the variable without disclosing secret values',async()=>{
  for(const [environment,name] of [[{SUPABASE_ANON_KEY:''},'SUPABASE_PUBLISHABLE_KEYS'],[{SUPABASE_URL:''},'SUPABASE_URL'],[{GEMINI_API_KEY:''},'GEMINI_API_KEY']]){
    const {handler,request,calls}=await setup({environment});const response=await handler(request());
    assert.equal(response.status,503);assert.match(await response.text(),new RegExp(name));assert.equal(calls.length,0);
  }
});
test('invalid and oversized images cannot consume provider quota',async()=>{
  for(const bad of ['https://evil.test/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=',image+'x','data:image/jpeg;base64,'+'a'.repeat(1400000)]){
    const {handler,request,calls}=await setup();assert.ok([400,413].includes((await handler(request({image:bad}))).status));assert.equal(calls.length,1);
  }
});
test('persistent quota denials and errors never call the provider',async()=>{
  for(const [options,status] of [[{quota:false},429],[{quota:{code:'P0001'},quotaStatus:400},429],[{quota:{code:'42883'},quotaStatus:404},503]]){
    const {handler,request,calls}=await setup(options);assert.equal((await handler(request())).status,status);assert.equal(calls.length,2);
  }
});
test('provider quota errors, blocked outputs and malformed identification produce safe messages',async()=>{
  for(const [options,status] of [[{providerStatus:429},429],[{providerStatus:403},503],[{finish:'SAFETY'},422],[{output:{brand:123,name:'x',style:''}},502]]){
    const {handler,request}=await setup(options);const response=await handler(request());assert.equal(response.status,status);assert.doesNotMatch(await response.text(),/private-test-key|user-token/);
  }
});
test('preflight supports Supabase SDK headers and disallows other methods',async()=>{
  const {handler,request,calls}=await setup();let response=await handler(request(null,{},'OPTIONS'));assert.equal(response.status,204);assert.match(response.headers.get('access-control-allow-headers'),/x-client-info/);
  response=await handler(request(null,{},'GET'));assert.equal(response.status,405);assert.equal(calls.length,0);
});
test('provider diagnostics distinguish access, model, request and server failures without leaking secrets',async()=>{
  for(const [status,expected] of [[403,/rechazó el acceso/],[404,/no encuentra el modelo/],[400,/rechazó la solicitud/],[500,/no está disponible/]]){
    const {handler,request}=await setup({providerStatus:status});const response=await handler(request());const message=(await response.json()).error;
    assert.match(message,expected);assert.match(message,new RegExp('HTTP '+status));assert.doesNotMatch(message,/private-test-key|user-token/);
  }
});
