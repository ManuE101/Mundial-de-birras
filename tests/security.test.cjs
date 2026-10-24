const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const context = {window:{BIRRAS_CONFIG:{supabaseUrl:'https://example.supabase.co'}},URL,Blob,atob,Uint8Array};
vm.runInNewContext(fs.readFileSync('security.js','utf8'),context);
const security = context.window.BirrasSecurity;
const valid = {id:'11111111-1111-4111-8111-111111111111',brand:'Marca',name:'Birra',style:'',notes:'',rating:0,date:null,createdAt:1};

test('beer validation rejects non-finite ratings, invalid dates and oversized text', () => {
  security.validateBeer(valid);
  for(const rating of [NaN,Infinity,-1,11,1.23,'8']) assert.throws(() => security.validateBeer({...valid,rating}));
  assert.throws(() => security.validateBeer({...valid,date:'2026-02-30'}));
  assert.throws(() => security.validateBeer({...valid,brand:' '.repeat(3)}));
  assert.throws(() => security.validateBeer({...valid,notes:'x'.repeat(1501)}));
  assert.throws(() => security.validateBeer({...valid,id:'" onmouseover="alert(1)'}));
});
test('photo display rejects external origins, executable URLs and SVG data', () => {
  for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg/>','https://evil.example/photo.jpg','https://example.supabase.co.evil.example/storage/v1/object/x','https://example.supabase.co/auth/v1/x']) assert.equal(security.safePhotoUrl(url),'');
  assert.ok(security.safePhotoUrl('https://example.supabase.co/storage/v1/object/sign/beer-photos/x?token=test'));
});
test('uploads check JPEG bytes and enforce a 2 MB limit', async () => {
  const blob=await security.jpegBlob('data:image/jpeg;base64,/9j/2Q==');
  assert.equal(blob.type,'image/jpeg');
  await assert.rejects(security.jpegBlob('data:image/jpeg;base64,PHN2Zy8+'));
  await assert.rejects(security.jpegBlob('data:image/jpeg;base64,'+'a'.repeat(3000000)));
  assert.equal(security.ownsPhoto('other/photo.jpg','owner'),false);
  assert.equal(security.ownsPhoto('owner/../photo.jpg','owner'),false);
});
test('Netlify CSP blocks inline scripts and arbitrary third-party connections', () => {
  const headers=fs.readFileSync('_headers','utf8');
  assert.match(headers,/frame-ancestors 'none'/);
  assert.match(headers,/X-Content-Type-Options: nosniff/);
  assert.match(headers,/Referrer-Policy: no-referrer/);
  assert.doesNotMatch(headers,/'unsafe-inline'|'unsafe-eval'|\*\.supabase\.co|cdn\.jsdelivr/);
  assert.match(headers,/Permissions-Policy: camera=\(\)/);
  const html=fs.readFileSync('index.html','utf8');
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(fs.readFileSync('app.js','utf8'),/style="/);
});
test('vendored SDK matches the pinned package and HTML integrity', () => {
  const pkg=require('../package.json'),installed=require('../node_modules/@supabase/supabase-js/package.json');
  assert.equal(pkg.dependencies['@supabase/supabase-js'],installed.version);
  const bytes=fs.readFileSync('vendor/supabase.js');
  const source=fs.readFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js');
  assert.equal(Buffer.compare(bytes,source),0);
  const integrity='sha384-'+crypto.createHash('sha384').update(bytes).digest('base64');
  assert.ok(fs.readFileSync('index.html','utf8').includes(`integrity="${integrity}"`));
});
test('CAPTCHA uses separate fresh tokens for sign-in, registration and recovery', () => {
  const widgets=new Map([['auth-form','widget-auth'],['reset-request-form','widget-reset']]);
  const forms=new Map([...widgets.keys()].map(id=>[id,{hidden:false,querySelector(){return {};}}]));
  let rendered=0;
  const calls=[], ctx={window:{BIRRAS_CONFIG:{turnstileSiteKey:'test-site-key'},turnstile:{
    render(_container){return rendered++ ? 'widget-reset' : 'widget-auth';},
    getResponse(id){return id==='widget-auth'?'auth-token':'reset-token';},
    reset(id){calls.push(id);}
  }},document:{getElementById:id=>forms.get(id)||{},createElement:()=>({}),head:{appendChild(){}}},MutationObserver:class{observe(){}}};
  vm.runInNewContext(fs.readFileSync('captcha.js','utf8'),ctx);
  ctx.window.birrasTurnstileReady();
  assert.equal(ctx.window.BirrasCaptcha.token('auth-form'),'auth-token');
  assert.equal(ctx.window.BirrasCaptcha.token('reset-request-form'),'reset-token');
  ctx.window.BirrasCaptcha.reset('auth-form');
  assert.equal(calls[0],'widget-auth');
  ctx.window.BirrasCaptcha.reset('reset-request-form');
  assert.equal(calls[1],'widget-reset');
});
