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
    const createClient = window.supabase?.createClient;
    if (!createClient) throw new Error('No se pudo cargar la conexión. Recargá la app.');
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
  async function login(email, password, captchaToken) { check(await client.auth.signInWithPassword({ email, password, options: { captchaToken } })); }
  async function signup(email, password, captchaToken) {
    if (password.length < 8) throw new Error('Usá al menos 8 caracteres.');
    return check(await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin, captchaToken } }));
  }
  async function logout() { check(await client.auth.signOut()); }
  async function requestPasswordReset(email, captchaToken) {
    check(await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin, captchaToken }));
  }
  async function updatePassword(password) {
    requireUser();
    if (!recovering) throw new Error('Abrí el enlace de recuperación que recibiste por email.');
    if (password.length < 8) throw new Error('Usá al menos 8 caracteres.');
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
      const urls = check(await bucket().createSignedUrls(photoRows.slice(i, i + 100).map(row => row.photo_path), 300));
      urls.forEach(item => { if (item.error) throw new Error('No se pudo cargar una foto. Recargá para reintentar.'); photos.set(item.path, item.signedUrl); });
    }
    return rows.map(row => ({ id: row.id, brand: row.brand, name: row.name, style: row.style, date: row.date,
      rating: Number(row.rating), isPublic: row.is_public !== false, drunk: row.drunk, buyAgain: row.buy_again, notes: row.notes, photo: photos.get(row.photo_path) || null,
      photoPath: row.photo_path, createdAt: new Date(row.created_at).getTime() }));
  }
  async function save(beer, previous) {
    requireUser();
    window.BirrasSecurity.validateBeer(beer);
    if (previous?.photoPath && !window.BirrasSecurity.ownsPhoto(previous.photoPath, user.id)) throw new Error('La foto no pertenece a esta cuenta.');
    let path = previous?.photoPath || null, uploaded = false;
    if (beer.photo?.startsWith('data:image/jpeg;base64,')) {
      const blob = await window.BirrasSecurity.jpegBlob(beer.photo);
      path = `${user.id}/${crypto.randomUUID()}.jpg`;
      check(await bucket().upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
      uploaded = true;
    }
    if (beer.photo && !path) throw new Error('La foto debe ser una imagen JPEG válida.');
    const row = { id: beer.id, user_id: user.id, brand: beer.brand, name: beer.name, style: beer.style,
      date: beer.date || null, rating: beer.rating, is_public: beer.isPublic !== false, drunk: beer.drunk ?? null, buy_again: beer.buyAgain ?? null, notes: beer.notes, photo_path: path,
      created_at: new Date(beer.createdAt).toISOString() };
    if (previous) delete row.created_at;
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
    if (beer.photoPath && window.BirrasSecurity.ownsPhoto(beer.photoPath, user.id)) await bucket().remove([beer.photoPath]).catch(() => {});
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
  async function signPhotos(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return new Map();
    const results = check(await bucket().createSignedUrls(unique, 300));
    return new Map(results.filter(item => !item.error && item.signedUrl).map(item => [item.path,item.signedUrl]));
  }
  async function ownProfile() {
    requireUser();
    return check(await client.from('profiles').select('user_id,username,avatar_path,created_at').eq('user_id',user.id).single());
  }
  async function publicProfile(username, offset = 0) {
    const data = check(await client.rpc('birras_public_profile',{profile_name:username,page_offset:offset}));
    if (!data) return null;
    const urls = await signPhotos([data.avatar_path,...data.reviews.map(review => review.photo_path)]);
    return {...data,avatar:urls.get(data.avatar_path) || null,reviews:data.reviews.map(review => ({...review,photo:urls.get(review.photo_path) || null}))};
  }
  async function publicProfiles(search = '', after = '') {
    if (!search.trim()) return [];
    const profiles = check(await client.rpc('birras_public_profiles',{search_name:search,after_name:after}));
    const urls = await signPhotos(profiles.map(profile => profile.avatar_path));
    return profiles.map(profile => ({...profile,avatar:urls.get(profile.avatar_path) || null}));
  }
  async function updateProfile({username,photo = null,removeAvatar = false}) {
    requireUser();
    username = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,40}$/.test(username)) throw new Error('Usá entre 3 y 40 letras sin acentos, números o guiones bajos.');
    const owner = user.id, previous = await ownProfile();
    let path = removeAvatar ? null : previous.avatar_path, uploaded = false;
    if (photo) {
      const blob = await window.BirrasSecurity.jpegBlob(photo);
      path = `${owner}/${crypto.randomUUID()}.jpg`;
      check(await bucket().upload(path,blob,{contentType:'image/jpeg',upsert:false})); uploaded = true;
    }
    if (user?.id !== owner) { if (uploaded) await bucket().remove([path]); throw new Error('La sesión cambió. Volvé a intentarlo.'); }
    try {
      check(await client.from('profiles').update({username,avatar_path:path}).eq('user_id',owner).select('username').single());
    } catch(error) {
      if (uploaded) await bucket().remove([path]);
      if (error.code === '23505') throw new Error('Ese nombre de usuario ya está ocupado. Probá otro.');
      throw error;
    }
    if ((uploaded || removeAvatar) && previous.avatar_path && window.BirrasSecurity.ownsPhoto(previous.avatar_path,owner)) await bucket().remove([previous.avatar_path]).catch(() => {});
    return {username,avatar_path:path};
  }
  async function catalogItems(method, args) {
    const data = check(await client.rpc(method,args));
    const urls = await signPhotos(data.items.map(item => item.photo_path));
    return {...data,items:data.items.map(item => ({...item,photo:urls.get(item.photo_path)||null}))};
  }
  function catalog(search = '', offset = 0) {
    return catalogItems('birras_catalog',{search_text:search,page_offset:offset});
  }
  function wishlist(username, offset = 0) {
    return catalogItems('birras_wishlist',{profile_name:username,page_offset:offset});
  }
  async function catalogDetail(key, offset = 0) {
    const data = check(await client.rpc('birras_catalog_detail',{beer_key:key,page_offset:offset}));
    if (!data) return null;
    const urls = await signPhotos([data.photo_path,...data.reviews.map(item => item.photo_path)]);
    return {...data,photo:urls.get(data.photo_path)||null,reviews:data.reviews.map(item => ({...item,photo:urls.get(item.photo_path)||null}))};
  }
  async function setWishlist(key,wanted) {
    requireUser();
    check(await client.rpc('birras_set_wishlist',{beer_key:key,wanted}));
  }
  async function recognizeBeer(image,signal) {
    requireUser();const owner=user.id;
    const {data,error}=await client.functions.invoke('recognize-beer',{body:{image},signal});
    if(user?.id!==owner)throw new Error('La sesión cambió. Volvé a intentar.');
    if(error){let message;try{message=(await error.context?.json())?.error;}catch{}throw new Error(message||'No pudimos conectar con el reconocimiento. Revisá que esté configurado en Supabase.');}
    if(!data||['brand','name','style'].some(field=>typeof data[field]!=='string'))throw new Error('La respuesta del reconocimiento no es válida.');
    return data;
  }
  return { configured, init, login, signup, logout, requestPasswordReset, updatePassword, isRecovering, list, save, remove, backup, ownProfile, publicProfile, publicProfiles, updateProfile, catalog, catalogDetail, wishlist, setWishlist, recognizeBeer };
})();
