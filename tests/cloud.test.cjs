const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function setup({ failWrite = false, resetError = null, updateError = null, recoveryHash = '' } = {}) {
  const uploads = [], removals = [], writes = [];
  const resets = [], updates = [], notifications = [];
  let authCallback;
  const storage = {
    upload: async (path, blob) => { uploads.push({ path, blob }); return { data: {} }; },
    remove: async paths => { removals.push(...paths); return { data: {} }; }
  };
  const query = {
    delete: () => { writes.push({ operation: 'delete' }); return query; },
    insert: row => { writes.push(row); return query; },
    update: row => { writes.push(row); return query; },
    eq: () => query, is: () => query, select: () => query,
    single: async () => failWrite ? { error: { code: '23505' } } : { data: { id: 'beer-id' } }
  };
  const client = {
    auth: {
      onAuthStateChange(callback) { authCallback = callback; },
      getSession: async () => ({ data: { session: { user: { id: 'owner-id' } } } }),
      resetPasswordForEmail: async (email, options) => { resets.push({ email, options }); return { data: {}, error: resetError }; },
      updateUser: async data => { updates.push(data); return { data: {}, error: updateError }; }
    },
    storage: { from: () => storage }, from: () => query
  };
  const context = { window: { location: { origin: 'https://birras.example', hash: recoveryHash }, BIRRAS_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_test' } },
    fakeSDK: { createClient: () => client }, crypto: { randomUUID: () => 'photo-id' }, fetch, setTimeout, atob, URLSearchParams };
  const source = fs.readFileSync('cloud.js', 'utf8').replace(/await import\('[^']+'\)/, 'fakeSDK');
  vm.runInNewContext(source, context);
  const cloud = context.window.BirrasCloud;
  await cloud.init(() => {}, value => notifications.push(value));
  return { cloud, uploads, removals, writes, resets, updates, notifications, emit: (event, session) => authCallback(event, session) };
}
const beer = { id: 'beer-id', brand: 'Marca', name: 'Variedad', style: '', date: '2026-10-21', rating: 0,
  drunk: false, buyAgain: false, notes: '', photo: 'data:image/jpeg;base64,/9j/', createdAt: 1792540800000 };

test('saves zero ratings and false drunk state with the authenticated owner', async () => {
  const { cloud, uploads, writes } = await setup();
  const saved = await cloud.save(beer);
  assert.equal(uploads[0].path, 'owner-id/photo-id.jpg');
  assert.equal(writes[0].user_id, 'owner-id');
  assert.equal(writes[0].rating, 0);
  assert.equal(writes[0].drunk, false);
  assert.equal(writes[0].buy_again, false);
  assert.equal(saved.photoPath, 'owner-id/photo-id.jpg');
});
test('duplicate rejection cleans up the uploaded photo', async () => {
  const { cloud, removals } = await setup({ failWrite: true });
  await assert.rejects(cloud.save(beer), /ya están/);
  assert.equal(removals[0], 'owner-id/photo-id.jpg');
});
test('editing without a new photo preserves the private storage path', async () => {
  const { cloud, uploads, writes } = await setup();
  await cloud.save({ ...beer, photo: 'https://example/photo?signed=temporary' }, { photoPath: 'owner-id/original.jpg' });
  assert.equal(uploads.length, 0);
  assert.equal(writes[0].photo_path, 'owner-id/original.jpg');
});
test('replacing a photo removes the previous file after saving', async () => {
  const { cloud, removals } = await setup();
  await cloud.save(beer, { photoPath: 'owner-id/original.jpg' });
  assert.equal(removals[0], 'owner-id/original.jpg');
});

test('password reset email redirects to the app origin', async () => {
  const { cloud, resets } = await setup();
  await cloud.requestPasswordReset('user@example.com');
  assert.equal(resets[0].email, 'user@example.com');
  assert.equal(resets[0].options.redirectTo, 'https://birras.example');
});
test('recovery event is handled even for the already signed-in user', async () => {
  const { cloud, emit, notifications } = await setup();
  emit('PASSWORD_RECOVERY', { user: { id: 'owner-id' } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(cloud.isRecovering(), true);
  assert.equal(notifications.length, 1);
});
test('ordinary sign-in does not permit the recovery password action', async () => {
  const { cloud, updates } = await setup();
  await assert.rejects(cloud.updatePassword('new-password-123'), /enlace/);
  assert.equal(updates.length, 0);
});
test('successful password update exits recovery and failed update allows retry', async () => {
  const success = await setup({ recoveryHash: '#type=recovery' });
  await success.cloud.updatePassword('new-password-123');
  assert.equal(success.updates[0].password, 'new-password-123');
  assert.equal(success.cloud.isRecovering(), false);
  const failed = await setup({ recoveryHash: '#type=recovery', updateError: new Error('expired') });
  await assert.rejects(failed.cloud.updatePassword('new-password-123'), /expired/);
  assert.equal(failed.cloud.isRecovering(), true);
});
test('reset email delivery errors are surfaced to the UI', async () => {
  const { cloud } = await setup({ resetError: new Error('rate limit') });
  await assert.rejects(cloud.requestPasswordReset('user@example.com'), /rate limit/);
});

test('confirmed deletion deletes the record and then its photo', async () => {
  const { cloud, writes, removals } = await setup();
  await cloud.remove({ ...beer, photoPath: 'owner-id/original.jpg' });
  assert.equal(writes[0].operation, 'delete');
  assert.equal(removals[0], 'owner-id/original.jpg');
});

test('older records leave the buy-again answer unspecified', async () => {
  const { cloud, writes } = await setup();
  const { buyAgain, ...older } = beer;
  await cloud.save(older);
  assert.equal(writes[0].buy_again, null);
});

test('a beer can be saved without a photo or date while keeping its zero score', async () => {
  const { cloud, writes, uploads } = await setup();
  const saved = await cloud.save({ ...beer, photo: null, date: null, rating: 0, style: '' });
  assert.equal(writes[0].photo_path, null);
  assert.equal(writes[0].date, null);
  assert.equal(writes[0].rating, 0);
  assert.equal(uploads.length, 0);
  assert.equal(saved.photoPath, null);
});

