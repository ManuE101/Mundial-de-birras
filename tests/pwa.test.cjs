const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('manifest links existing square icons and starts within scope', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(icon.src.split('?')[0]));
  const png = fs.readFileSync('assets/icono.png');
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  assert.ok(png.readUInt32BE(16) >= 512);
});
function worker(online) {
  const handlers = {};
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), {
    self: { addEventListener: (name, callback) => { handlers[name] = callback; }, location: { origin: 'https://birras.example' } },
    URL, Response, fetch: async () => { if (!online) throw new Error('offline'); return 'network response'; },
    caches: { match: async () => 'offline page' }
  });
  return handlers;
}
test('service worker leaves database requests and photos to the network', () => {
  const handlers = worker(false);
  for (const request of [
    {method:'GET',mode:'cors',url:'https://example.supabase.co/rest/v1/beers'},
    {method:'GET',mode:'no-cors',url:'https://birras.example/assets/icono.png'},
    {method:'POST',mode:'cors',url:'https://example.supabase.co/auth/v1/token'}
  ]) handlers.fetch({request, respondWith: () => assert.fail('must not intercept')});
});
test('offline page is used only when navigation fails', async () => {
  for (const online of [true, false]) {
    let response;
    worker(online).fetch({request:{method:'GET',mode:'navigate',url:'https://birras.example/'}, respondWith: promise => { response = promise; }});
    assert.equal(await response, online ? 'network response' : 'offline page');
  }
});
