'use strict';
window.BirrasCloud = (() => {
  let client, user, recovering = false;
  const recoveryKey = 'birras-password-recovery';
  function rememberRecovery(value) {
    recovering = value;
    try { value ? sessionStorage.setItem(recoveryKey, '1') : sessionStorage.removeItem(recoveryKey); } catch {}
  }
  const bucket = () => client.storage.from('beer-photos');
  const check = result => { if (result.error) throw result.error; return result.data; };
  const configured = () => Boolean(window.BIRRAS_CONFIG?.supabaseUrl || window.BIRRAS_CONFIG?.supabasePublishableKey);
  function requireUser() { if (!user) throw new Error('Iniciá sesión para continuar.'); }
  async function init(onSession, onRecovery = () => {}) {
    const config = window.BIRRAS_CONFIG;
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Completá los dos valores de config.js para conectar Supabase.');
    if (config.supabasePublishableKey.startsWith('sb_secret_')) throw new Error('Usá la clave pública publishable, nunca una clave secreta.');
    if (config.supabasePublishableKey.startsWith('eyJ')) {
      try {
        const payload = JSON.parse(atob(config.supabasePublishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.role !== 'anon') throw new Error('La clave debe ser publishable o anon.');
      } catch { throw new Error('La clave debe ser publishable o anon.'); }
    }
    const incomingRecovery = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
    let remembered = false;
    try { remembered = sessionStorage.getItem(recoveryKey) === '1'; } catch {}
    rememberRecovery(incomingRecovery || remembered);
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm');
    client = createClient(config.supabaseUrl, config.supabasePublishableKey);
    // El callback no realiza llamadas a Supabase mientras el SDK procesa el evento.
    let previous;
    client.auth.onAuthStateChange((event, session) => {
      const next = session?.user || null;
      if (event === 'PASSWORD_RECOVERY' && next) {
        rememberRecovery(true);
        setTimeout(() => onRecovery(next), 0);
      }
      if (event === 'SIGNED_OUT') rememberRecovery(false);
      if (next?.id === previous) return;
      previous = next?.id;
      user = next;
      setTimeout(() => onSession(next), 0);
    });
    const session = check(await client.auth.getSession()).session;
    user = session?.user || null;
    if (!user) rememberRecovery(false);
    previous = user?.id;
    return user;
  }
  async function login(email, password) { check(await client.auth.signInWithPassword({ email, password })); }
  async function signup(email, password) {
    return check(await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }));
  }
  async function logout() { check(await client.auth.signOut()); }
  async function requestPasswordReset(email) {
    check(await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }));
  }
  async function updatePassword(password) {
    requireUser();
    if (!recovering) throw new Error('Abrí el enlace de recuperación que recibiste por email.');
    check(await client.auth.updateUser({ password }));
    rememberRecovery(false);
  }
  const isRecovering = () => recovering;
  async function list() {
    requireUser();
    const rows = [];
    for (let from = 0; ; from += 500) {
      const page = check(await client.from('beers').select('*').order('id').range(from, from + 499));
      rows.push(...page);
      if (page.length < 500) break;
    }
    const photos = new Map();
    const photoRows = rows.filter(row => row.photo_path);
    for (let i = 0; i < photoRows.length; i += 100) {
      const urls = check(await bucket().createSignedUrls(photoRows.slice(i, i + 100).map(row => row.photo_path), 3600));
      urls.forEach(item => { if (item.error) throw new Error('No se pudo cargar una foto. Recargá para reintentar.'); photos.set(item.path, item.signedUrl); });
    }
    return rows.map(row => ({ id: row.id, brand: row.brand, name: row.name, style: row.style, date: row.date,
      rating: Number(row.rating), drunk: row.drunk, buyAgain: row.buy_again, notes: row.notes, photo: photos.get(row.photo_path) || null,
      photoPath: row.photo_path, createdAt: new Date(row.created_at).getTime() }));
  }
  async function save(beer, previous) {
    requireUser();
    let path = previous?.photoPath || null, uploaded = false;
    if (beer.photo?.startsWith('data:image/jpeg;base64,')) {
      const blob = await (await fetch(beer.photo)).blob();
      path = `${user.id}/${crypto.randomUUID()}.jpg`;
      check(await bucket().upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
      uploaded = true;
    }
    if (beer.photo && !path) throw new Error('La foto debe ser una imagen JPEG válida.');
    const row = { id: beer.id, user_id: user.id, brand: beer.brand, name: beer.name, style: beer.style,
      date: beer.date || null, rating: beer.rating, drunk: beer.drunk ?? null, buy_again: beer.buyAgain ?? null, notes: beer.notes, photo_path: path,
      created_at: new Date(beer.createdAt).toISOString() };
    try {
      check(await (previous ? client.from('beers').update(row).eq('id', beer.id) : client.from('beers').insert(row)).select('id').single());
    } catch (error) {
      if (uploaded) await bucket().remove([path]);
      if (error.code === '23505') throw new Error('Esta marca y variedad ya están en tu mundial.');
      throw error;
    }
    // La fila ya quedó guardada. La limpieza no debe convertir ese éxito en un error.
    if (uploaded && previous?.photoPath) await bucket().remove([previous.photoPath]).catch(() => {});
    return { ...beer, photoPath: path };
  }
  async function remove(beer) {
    requireUser();
    check(await client.from('beers').delete().eq('id', beer.id).select('id').single());
    if (beer.photoPath) await bucket().remove([beer.photoPath]).catch(() => {});
  }
  async function backup(beers) {
    requireUser();
    const result = [];
    for (const beer of beers) {
      if (!beer.photoPath) { const { photoPath, ...record } = beer; result.push({...record, photo: null}); continue; }
      const blob = check(await bucket().download(beer.photoPath));
      const photo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      const { photoPath, ...record } = beer;
      result.push({ ...record, photo });
    }
    return result;
  }
  return { configured, init, login, signup, logout, requestPasswordReset, updatePassword, isRecovering, list, save, remove, backup };
})();
