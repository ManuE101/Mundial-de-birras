'use strict';
const $ = id => document.getElementById(id);
let cloudMode = false, sessionUser = null, loading = true, sessionVersion = 0;
let duplicateId = null;
let detailBeerId = null, detailTrigger = null;
let photoVersion = 0;
let beers = [], db, editing = null, currentPhoto = null, photoTask = Promise.resolve();
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
const key = beer => `${normalize(beer.brand)}|${normalize(beer.name)}`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => value.toLocaleString('es-AR', {minimumFractionDigits:1, maximumFractionDigits:1});
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
function transaction(mode, action) { return new Promise((resolve, reject) => { const tx = db.transaction('beers', mode); const request = action(tx.objectStore('beers')); let result; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('No se pudo guardar')); }); }
function setReady(ready) {
 ready = ready && !BirrasCloud.isRecovering();
 loading = !ready;
 $('add').disabled = !ready; $('export').disabled = !ready;
 $('ranking').inert = !ready;
 if (ready) $('app-content').hidden = false;
 else if (cloudMode && (!sessionUser || BirrasCloud.isRecovering())) $('app-content').hidden = true;
 document.body.classList.toggle('auth-view', $('app-content').hidden);
 $('storage-note').hidden = $('app-content').hidden;
}
function notifyCommunity() {
 window.dispatchEvent?.(new CustomEvent('birras:session',{detail:{user:sessionUser,recovering:BirrasCloud.isRecovering()}}));
}
async function loadSession(user) {
 if (user?.id !== sessionUser?.id) {
   clearFilters(false); photoVersion++; currentPhoto = null;
   $('beer-form').reset(); $('preview').removeAttribute('src'); $('preview').hidden = true;
   $('detail-photo').removeAttribute('src');
   ['detail-brand','detail-title','detail-notes','detail-score','detail-position','detail-style','detail-date','detail-state','detail-joke','detail-buy-again','detail-visibility'].forEach(id => $(id).textContent = '');
   detailBeerId = null; detailTrigger = null;
   $('auth-password').value = ''; $('new-password-form').reset();
 }
 const version = ++sessionVersion;
 sessionUser = user; $('app-content').hidden = true; setReady(false); beers = []; render();
 $('beer-detail').close(); $('dialog').close(); $('auth-form').hidden = !!user;
 $('reset-request-form').hidden = true;
 $('new-password-form').hidden = !user || !BirrasCloud.isRecovering(); $('logout').hidden = !user;
 $('migrate').hidden = true;
 $('login-welcome').hidden = !!user;
 $('account-status').textContent = user ? `Tu cuenta: ${user.email}` : 'Iniciá sesión';
 $('storage-note').textContent = 'Tu colección en Supabase. Solo las reseñas públicas aparecen en tu perfil.';
 if (user && BirrasCloud.isRecovering()) {
   $('account-status').textContent = 'Recuperación de contraseña';
   $('new-password').focus(); notifyCommunity();
   return;
 }
 if (!user) { notifyCommunity(); return; }
 try {
   const records = await BirrasCloud.list();
   if (version !== sessionVersion) return;
   beers = records; render(); setReady(true);
   $('status').textContent = '';
 } catch { if (version === sessionVersion) $('status').textContent = 'No pudimos cargar la colección. Revisá la conexión y recargá para reintentar.'; }
 if (version === sessionVersion) notifyCommunity();
}
async function init() {
 setReady(false);
 const linkError = new URLSearchParams(window.location.hash.slice(1)).has('error');
 if (linkError) $('auth-message').textContent = 'El enlace no es válido o venció. Usá Olvidé mi contraseña para pedir uno nuevo.';
 try {
   db = await new Promise((resolve, reject) => { const request = indexedDB.open('mundial-de-birras',1); request.onupgradeneeded = () => request.result.createObjectStore('beers',{keyPath:'id'}); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
 } catch { db = null; }
 cloudMode = BirrasCloud.configured();
 try {
   if (cloudMode) {
     $('account').hidden = false;
     const user = await BirrasCloud.init(loadSession, loadSession);
     await loadSession(user);
   } else {
     $('account').hidden = true;
     if (!db) throw new Error('No pudimos abrir el almacenamiento local.');
     beers = await transaction('readonly', store => store.getAll()); render(); setReady(true);
   }
 } catch (error) { $('status').textContent = error.message || 'No pudimos iniciar la app. Revisá config.js y tu conexión.'; }
}
function tastingState(beer) { return beer.drunk === true ? 'Probada borracho' : beer.drunk === false ? 'Probada sin estar borracho' : 'Estado: sin indicar'; }
const COMMON_STYLES = ['Rubia / Lager', 'Pilsen', 'Golden', 'IPA', 'Session IPA', 'APA', 'Roja', 'Scotch', 'Honey', 'Porter', 'Stout'];
function displayStyle(value = '') {
 const aliases = { 'lager': 'Rubia / Lager', 'pilsner': 'Pilsen', 'golden ale': 'Golden', 'amber lager': 'Roja', 'irish red ale': 'Roja', 'irish red ale (roja)': 'Roja', 'scotch ale': 'Scotch' };
 return (Object.hasOwn(aliases,normalize(value)) ? aliases[normalize(value)] : '') || COMMON_STYLES.find(style => normalize(style) === normalize(value)) || value.trim();
}
function toggleCustomStyle() {
 const other = $('style').value === '__other__';
 $('custom-style-label').hidden = !other;
 $('custom-style').disabled = !other;
 $('custom-style').required = false;
}
function setFormStyle(value = '') {
 value = displayStyle(value);
 const found = COMMON_STYLES.find(style => normalize(style) === normalize(value));
 $('style').value = found || (value.trim() ? '__other__' : '');
 $('custom-style').value = found ? '' : value;
 toggleCustomStyle();
}
function readFormStyle() {
 const value = $('style').value === '__other__' ? $('custom-style').value.trim().replace(/\s+/g, ' ') : $('style').value;
 return COMMON_STYLES.find(style => normalize(style) === normalize(displayStyle(value))) || value;
}
function matchesFilters(beer, query, style, state) {
 return normalize(`${beer.brand} ${beer.name} ${beer.style || ''} ${displayStyle(beer.style || '')}`).includes(normalize(query))
   && (!style || (style === '__none__' ? !normalize(beer.style || '') : `style:${normalize(displayStyle(beer.style || ''))}` === style))
   && (!state || (state === 'yes' ? beer.drunk === true : state === 'no' ? beer.drunk === false : beer.drunk == null));
}
function updateStyleFilter() {
 const selected = $('filter-style').value;
 const labels = new Map();
 beers.forEach(beer => { const style = displayStyle(beer.style || ''); if (style && !labels.has(`style:${normalize(style)}`)) labels.set(`style:${normalize(style)}`, style); });
 // Conservar una selección al recargar o editar: puede quedar sin resultados.
 if (selected.startsWith('style:') && !labels.has(selected)) labels.set(selected, selected.slice(6));
 $('filter-style').innerHTML = '<option value="">Todos los estilos</option>' + [...labels].sort((a,b) => a[1].localeCompare(b[1],'es')).map(([value,label]) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`).join('') + '<option value="__none__">Sin estilo indicado</option>';
 $('filter-style').value = selected;
}
function clearFilters(refresh = true) {
 $('search').value = ''; $('filter-style').value = ''; $('filter-state').value = '';
 if (refresh) render();
}
function groupStatistics(records, labelFor) {
 const groups = new Map();
 records.forEach(beer => {
   const label = labelFor(beer), key = normalize(label);
   if (!groups.has(key)) groups.set(key, { label, count: 0, sum: 0 });
   const group = groups.get(key); group.count++; group.sum += beer.rating;
 });
 return [...groups.values()].map(group => ({ label: group.label, count: group.count, average: group.sum / group.count }));
}
function statisticRows(groups, metric = 'average') {
 return groups.map(group => {
   const value = metric === 'count' ? `${group.count}` : number(group.average);
   const width = metric === 'count' ? group.count / Math.max(1, ...groups.map(g => g.count)) * 100 : group.average * 10;
   return `<div class="insight-row"><div class="insight-row-heading"><span>${escapeHTML(group.label)}</span><strong>${value}${metric === 'average' ? '<small> / 10</small>' : '<small> birras</small>'}</strong></div><meter class="insight-bar" min="0" max="100" value="${width}" aria-hidden="true"></meter><p>${metric === 'count' ? `Promedio ${number(group.average)} / 10` : `${group.count} ${group.count === 1 ? 'birra' : 'birras'}`}</p></div>`;
 }).join('');
}
function renderStatistics() {
 $('insights-empty').hidden = !!beers.length;
 $('insights-content').hidden = !beers.length;
 const byAverage = (a,b) => b.average - a.average || b.count - a.count || a.label.localeCompare(b.label,'es');
 const styles = groupStatistics(beers, beer => displayStyle(beer.style || '') || 'Sin estilo indicado').sort(byAverage);
 const brands = groupStatistics(beers, beer => beer.brand.trim());
 $('stats-styles').innerHTML = statisticRows(styles);
 $('stats-brands-count').innerHTML = statisticRows([...brands].sort((a,b) => b.count - a.count || byAverage(a,b)), 'count');
 $('stats-brands-rating').innerHTML = statisticRows([...brands].sort(byAverage));
 const states = [{ label: 'Sin estar borracho', matches: beer => beer.drunk === false }, { label: 'Borracho', matches: beer => beer.drunk === true }, { label: 'Sin indicar', matches: beer => beer.drunk == null }];
 $('stats-states').innerHTML = states.map(state => {
   const records = beers.filter(state.matches);
   return records.length ? statisticRows([{label:state.label, count:records.length, average:records.reduce((sum,beer) => sum + beer.rating,0)/records.length}]) : `<div class="insight-row insight-no-data"><div class="insight-row-heading"><span>${state.label}</span><strong>—</strong></div><p>0 birras</p></div>`;
 }).join('');
}
function tastingJoke(beer) {
 return beer.drunk === true ? 'No era parámetro en esas condiciones.' : '';
}
function render() {
 const sorted = [...beers].sort((a,b) => b.rating-a.rating || a.createdAt-b.createdAt);
 $('count').textContent = beers.length; $('total').textContent = `${beers.length} ${beers.length===1?'birra':'birras'}`;
 $('average').textContent = beers.length ? number(beers.reduce((sum,b) => sum+b.rating,0)/beers.length) : '—';
 $('champion').textContent = sorted.length ? `${sorted[0].brand} ${sorted[0].name}` : 'Sin definir';
 updateStyleFilter();
 const query = $('search').value;
 const styleFilter = $('filter-style').value, stateFilter = $('filter-state').value;
 const filtered = !!(query.trim() || styleFilter || stateFilter);
 let visible = sorted.filter(b => matchesFilters(b, query, styleFilter, stateFilter));
 $('clear-filters').hidden = !filtered;
 $('filter-summary').textContent = filtered ? `${visible.length} de ${beers.length} birras. Las posiciones corresponden al ranking general.` : '';
 const positions = new Map(sorted.map((b,i) => [b.id, i && b.rating===sorted[i-1].rating ? null : i+1]));
 let last = 1; sorted.forEach(b => { if(positions.get(b.id)) last = positions.get(b.id); else positions.set(b.id,last); });
 if($('sort').value==='recent') visible.sort((a,b) => (b.date || '').localeCompare(a.date || '') || b.createdAt-a.createdAt);
 if($('sort').value==='name') visible.sort((a,b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`,'es'));
 $('ranking').innerHTML = visible.length ? visible.map(b => `<article class="beer-row" data-view="${escapeHTML(b.id)}"><span class="position ${positions.get(b.id)===1?'first':''}">${String(positions.get(b.id)).padStart(2,'0')}</span>${window.BirrasSecurity.safePhotoUrl(b.photo) ? `<img class="beer-photo" src="${escapeHTML(window.BirrasSecurity.safePhotoUrl(b.photo))}" alt="${escapeHTML(`${b.brand} ${b.name}`)}">` : '<span class="beer-photo photo-placeholder">Sin foto</span>'}<div class="beer-info"><h3><button class="beer-name" type="button" data-view="${escapeHTML(b.id)}" aria-haspopup="dialog">${escapeHTML(b.brand)} · ${escapeHTML(b.name)}</button></h3><p>${escapeHTML(displayStyle(b.style || '') || 'Sin estilo indicado')} · ${escapeHTML(b.date ? new Date(b.date+'T12:00:00').toLocaleDateString('es-AR') : 'Sin fecha indicada')}</p><p class="state-badge">${tastingState(b)}</p><p class="visibility-badge">${b.isPublic === false ? 'Privada' : 'Pública'}</p>${b.buyAgain === true || b.buyAgain === false ? `<p class="buy-again-note">${b.buyAgain ? 'La volvería a comprar' : 'No la volvería a comprar'}</p>` : ''}${b.notes?`<p class="tasting">${escapeHTML(b.notes)}</p>`:''}</div><div class="score">${number(b.rating)}<small> / 10</small></div><div class="actions"><button data-edit="${escapeHTML(b.id)}" aria-label="Editar ${escapeHTML(b.name)}">Editar</button><button data-delete="${escapeHTML(b.id)}" aria-label="Eliminar ${escapeHTML(b.name)}">×</button></div></article>`).join('') : `<div class="empty"><div class="empty-icon" aria-hidden="true">—</div><h3>${beers.length?'Ninguna birra por acá.':'Todavía no cargaste ninguna birra.'}</h3><p>${beers.length?'Probá cambiar la búsqueda o limpiar los filtros.':'Arrancá por la que tenés en la heladera. Foto, puntaje y listo.'}</p>${beers.length?'':'<button class="primary" id="first-beer">+ Cargar mi primera birra</button>'}</div>`;
 $('first-beer')?.addEventListener('click', () => openForm());
 renderStatistics();
}
function openDetail(id) {
 if (loading) return;
 const beer = beers.find(item => item.id === id);
 if (!beer) return;
 detailBeerId = id;
 detailTrigger = document.activeElement;
 $('detail-brand').textContent = beer.brand;
 $('detail-title').textContent = beer.name;
 const detailPhoto = window.BirrasSecurity.safePhotoUrl(beer.photo);
 $('detail-photo').hidden = !detailPhoto;
 $('detail-no-photo').hidden = !!detailPhoto;
 if (detailPhoto) $('detail-photo').src = detailPhoto;
 else $('detail-photo').removeAttribute('src');
 $('detail-photo').alt = `${beer.brand} ${beer.name}`;
 $('detail-score').textContent = number(beer.rating);
 const position = 1 + beers.filter(item => item.rating > beer.rating).length;
 const tied = beers.some(item => item.id !== id && item.rating === beer.rating);
 $('detail-position').textContent = `Puesto ${position} de ${beers.length}${tied ? ' (compartido)' : ''} en tu ranking`;
 $('detail-style').textContent = displayStyle(beer.style || '') || 'Sin estilo indicado';
 $('detail-date').textContent = beer.date ? new Date(beer.date + 'T12:00:00').toLocaleDateString('es-AR') : 'Sin indicar';
 $('detail-state').textContent = tastingState(beer);
 $('detail-visibility').textContent = beer.isPublic === false ? 'Privada' : 'Pública';
 $('detail-buy-again').textContent = beer.buyAgain === true ? 'Sí' : beer.buyAgain === false ? 'No' : 'Sin indicar';
 $('detail-joke').textContent = tastingJoke(beer);
 $('detail-joke').hidden = beer.drunk !== true;
 $('detail-notes').textContent = beer.notes || 'No dejaste una opinión sobre esta birra.';
 $('beer-detail').showModal();
}
$('detail-close').addEventListener('click', () => $('beer-detail').close());
$('beer-detail').addEventListener('close', () => {
 if (!$('dialog').open) detailTrigger?.focus({ preventScroll: true });
 detailTrigger = null;
});
$('detail-edit').addEventListener('click', () => {
 const beer = beers.find(item => item.id === detailBeerId);
 $('beer-detail').close();
 if (beer && !loading) openForm(beer);
});
function openForm(beer) { if (loading) return; photoVersion++; editing = beer?.id || null; currentPhoto = beer?.photo || null; photoTask = Promise.resolve(); $('beer-form').reset(); $('form-error').textContent=''; $('form-title').textContent = beer?'Editar birra':'¿Qué tomaste?'; ['brand','name','notes'].forEach(field => $(field).value=beer?.[field] || ''); setFormStyle(beer?.style || ''); $('date').value=beer ? beer.date || '' : today(); $('date').max=today(); $('drunk').value=beer?.drunk === true ? 'yes' : beer?.drunk === false ? 'no' : ''; $('visibility').value=beer?.isPublic === false ? 'private' : 'public'; $('buy-again').value=beer?.buyAgain === true ? 'yes' : beer?.buyAgain === false ? 'no' : ''; checkDuplicate(); $('rating').value=beer?.rating ?? ''; updateRating(); previewPhoto(); $('dialog').showModal(); }
function previewPhoto() { $('preview').hidden=!currentPhoto; $('upload-text').hidden=!!currentPhoto; if(currentPhoto) $('preview').src=currentPhoto; else $('preview').removeAttribute('src'); }
function updateRating() { $('rating-output').innerHTML=`${$('rating').value === '' ? '—' : number(Number($('rating').value))} <small>/ 10</small>`; }
function compress(file) { return new Promise((resolve,reject) => { const url=URL.createObjectURL(file), image=new Image(); image.onload=() => { try { if (image.width * image.height > 25000000) throw new Error('La imagen es demasiado grande. Usá una foto de hasta 25 megapíxeles.'); const scale=Math.min(1,1200/Math.max(image.width,image.height)); const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.width*scale)); canvas.height=Math.max(1,Math.round(image.height*scale)); canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL('image/jpeg',.82)); } catch(error) { reject(error); } finally { URL.revokeObjectURL(url); } }; image.onerror=() => { URL.revokeObjectURL(url); reject(new Error('No pudimos leer esa foto. Probá con JPG, PNG o WebP.')); }; image.src=url; }); }
$('photo').addEventListener('change', () => { const file=$('photo').files[0]; const selection = ++photoVersion; if(!file) return; $('form-error').textContent=''; if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024) { $('form-error').textContent='Elegí una imagen de hasta 15 MB.'; $('photo').value=''; return; } photoTask=compress(file).then(photo => { if (selection !== photoVersion) return; currentPhoto=photo; previewPhoto(); }).catch(error => { if (selection !== photoVersion) return; $('form-error').textContent=error.message; $('photo').value=''; }); });
$('beer-form').addEventListener('submit', async event => { event.preventDefault(); const submit=event.submitter; const savingOwner = sessionUser?.id; submit.disabled=true; setReady(false); $('logout').disabled=true; try { await photoTask; const beer={id:editing || crypto.randomUUID(),brand:$('brand').value.trim(),name:$('name').value.trim(),style:readFormStyle(),isPublic:$('visibility').value !== 'private',date:$('date').value || null,rating:Number($('rating').value),buyAgain:$('buy-again').value==='yes'?true:$('buy-again').value==='no'?false:null,drunk:$('drunk').value==='yes'?true:$('drunk').value==='no'?false:null,notes:$('notes').value.trim(),photo:currentPhoto,createdAt:beers.find(b=>b.id===editing)?.createdAt || Date.now()}; if(!beer.brand || !beer.name) throw new Error('Completá la marca y el nombre de la birra.'); if ($('rating').value === '' || !Number.isFinite(beer.rating) || beer.rating < 0 || beer.rating > 10) throw new Error('Poné un puntaje de 0 a 10.'); if(beer.date>today()) throw new Error('La fecha no puede ser futura.'); if(beers.some(b=>b.id!==editing && key(b)===key(beer))) throw new Error('Esta birra ya está en tu mundial. Podés editar su puntaje desde la clasificación.'); window.BirrasSecurity.validateBeer(beer); if (cloudMode) { const saved = await BirrasCloud.save(beer, beers.find(b=>b.id===beer.id)); Object.assign(beer, saved); } else { await transaction('readwrite', store=>store.put(beer)); } if (savingOwner !== sessionUser?.id) return; beers=beers.filter(b=>b.id!==beer.id).concat(beer); render(); $('dialog').close(); $('status').textContent='Birra guardada. ¡Salud!'; window.dispatchEvent?.(new Event('birras:reviews-changed')); } catch(error) { if (savingOwner !== sessionUser?.id) return; $('form-error').textContent=error.message || 'No se pudo guardar. Revisá la conexión o el espacio del navegador.'; } finally { submit.disabled=false; if (savingOwner === sessionUser?.id) { setReady(!cloudMode || !!sessionUser); $('logout').disabled=false; } } });
function findDuplicate(brand, name, excludedId = null) {
 if (!brand.trim() || !name.trim()) return null;
 return beers.find(beer => beer.id !== excludedId && key(beer) === key({brand,name})) || null;
}
function checkDuplicate() {
 const duplicate = findDuplicate($('brand').value, $('name').value, editing);
 duplicateId = duplicate?.id || null;
 $('duplicate-notice').hidden = !duplicate;
 $('duplicate-message').textContent = duplicate ? `Ya cargaste ${duplicate.brand} ${duplicate.name}, con ${number(duplicate.rating)} / 10. Podés editarla en vez de repetirla.` : '';
}
$('brand').addEventListener('input', checkDuplicate);
$('name').addEventListener('input', checkDuplicate);
$('duplicate-edit').addEventListener('click', () => {
 const beer = beers.find(item => item.id === duplicateId);
 if (beer && confirm('Se descartan los datos de esta carga para editar la birra existente. ¿Continuar?')) openForm(beer);
});
$('ranking').addEventListener('click', async event => {
 const edit=event.target.closest('[data-edit]'), remove=event.target.closest('[data-delete]'), view=event.target.closest('[data-view]');
 if (loading) return;
 if (edit) { openForm(beers.find(beer => beer.id === edit.dataset.edit)); return; }
 if (view && !remove) { openDetail(view.dataset.view); return; }
 if (!remove) return;
 const beer = beers.find(item => item.id === remove.dataset.delete);
 if (!beer || !confirm(`¿Eliminar ${beer.brand} ${beer.name} de tu mundial? Esta acción no se puede deshacer.`)) return;
 setReady(false); $('logout').disabled = true;
 try {
   if (cloudMode) await BirrasCloud.remove(beer);
   else await transaction('readwrite', store => store.delete(beer.id));
   beers = beers.filter(item => item.id !== beer.id); render();
   $('status').textContent = 'Birra eliminada.'; window.dispatchEvent?.(new Event('birras:reviews-changed'));
 } catch { $('status').textContent = 'No se pudo eliminar la birra. Intentá de nuevo.'; }
 finally { setReady(!cloudMode || !!sessionUser); $('logout').disabled = false; }
});
$('export').addEventListener('click', async () => {
 if (loading) return;
 $('export').disabled = true;
 try {
   const records = cloudMode ? await BirrasCloud.backup(beers) : beers;
   const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),beers:records},null,2)],{type:'application/json'});
   const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=`mundial-de-birras-${today()}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
   $('status').textContent='Respaldo exportado con tus puntajes y fotos.';
 } catch { $('status').textContent='No se pudo exportar el respaldo completo. Revisá la conexión y reintentá.'; }
 finally { $('export').disabled = loading; }
});
$('auth-form').addEventListener('submit', async event => {
 event.preventDefault();
 const buttons = [...$('auth-form').querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
 $('auth-message').textContent = '';
 try {
   const email = $('auth-email').value.trim(), password = $('auth-password').value;
   if (event.submitter?.name === 'signup' && password.length < 8) { $('auth-message').textContent = 'Usá al menos 8 caracteres para crear tu cuenta.'; return; }
   const captchaToken = window.BirrasCaptcha.token('auth-form');
   if (event.submitter?.name === 'signup') {
     const result = await BirrasCloud.signup(email,password,captchaToken);
     $('auth-message').textContent = result.session ? 'Cuenta creada.' : 'Revisá tu email para confirmar la cuenta. Después volvé e iniciá sesión.';
   } else await BirrasCloud.login(email,password,captchaToken);
   $('auth-password').value = '';
 } catch { $('auth-message').textContent = 'No se pudo completar. Revisá email, contraseña y confirmación del correo; si acabás de intentarlo, esperá un momento.'; }
 finally { window.BirrasCaptcha.reset('auth-form'); buttons.forEach(b => b.disabled = false); }
});
$('forgot-password').addEventListener('click', () => {
 $('auth-form').hidden = true;
 $('reset-request-form').hidden = false;
 $('reset-email').value = $('auth-email').value;
 $('auth-message').textContent = '';
 $('reset-email').focus();
});
$('back-to-login').addEventListener('click', () => {
 $('reset-request-form').hidden = true;
 $('auth-form').hidden = false;
 $('auth-message').textContent = '';
 $('auth-email').focus();
});
$('reset-request-form').addEventListener('submit', async event => {
 event.preventDefault();
 const button = event.submitter; button.disabled = true;
 $('auth-message').textContent = 'Enviando enlace...';
 try {
   await BirrasCloud.requestPasswordReset($('reset-email').value.trim(), window.BirrasCaptcha.token('reset-request-form'));
   $('auth-message').textContent = 'Si existe una cuenta con ese email, vas a recibir un enlace para cambiar la contraseña. Revisá también spam.';
 } catch {
   $('auth-message').textContent = 'No pudimos enviar el enlace. Revisá tu conexión; si ya pediste uno, esperá unos minutos antes de reintentar.';
 } finally { window.BirrasCaptcha.reset('reset-request-form'); button.disabled = false; }
});
$('new-password-form').addEventListener('submit', async event => {
 event.preventDefault();
 const password = $('new-password').value;
 if (password !== $('confirm-password').value) {
   $('auth-message').textContent = 'Las contraseñas no coinciden.'; $('confirm-password').focus(); return;
 }
 if (password.length < 8) { $('auth-message').textContent = 'Usá al menos 8 caracteres.'; return; }
 const button = event.submitter; button.disabled = true; $('logout').disabled = true;
 $('auth-message').textContent = '';
 try {
   await BirrasCloud.updatePassword(password);
   $('new-password-form').reset();
   $('auth-message').textContent = 'Contraseña actualizada. Ya podés seguir con tu mundial.';
   await loadSession(sessionUser);
 } catch (error) {
   $('auth-message').textContent = error.code === 'same_password' ? 'Elegí una contraseña diferente de la anterior.' : 'No pudimos cambiar la contraseña. Revisá los requisitos de tu cuenta o pedí un nuevo enlace si venció.';
 } finally { button.disabled = false; $('logout').disabled = false; }
});
$('logout').addEventListener('click', async () => {
 $('logout').disabled = true;
 try { await BirrasCloud.logout(); $('auth-message').textContent = ''; }
 catch { $('auth-message').textContent = 'No se pudo cerrar sesión. Intentá de nuevo.'; }
 finally { $('logout').disabled = false; }
});
$('migrate').addEventListener('click', async () => {
 if (loading || !sessionUser || !db) return;
 if (!confirm('Se copiarán las birras de este navegador a la cuenta actual. Los duplicados se omiten y la copia local se conserva. ¿Continuar?')) return;
 setReady(false); $('migrate').disabled = true; $('logout').disabled = true;
 let copied = 0, skipped = 0;
 try {
   const local = await transaction('readonly', store => store.getAll());
   for (const beer of local) {
     if (beers.some(b => key(b) === key(beer))) { skipped++; continue; }
     const saved = await BirrasCloud.save(beer);
     beers.push(saved); copied++;
   }
   $('auth-message').textContent = `${copied} birras copiadas; ${skipped} repetidas omitidas. La copia local se conserva.`;
   render();
 } catch { render(); $('auth-message').textContent = `Se copiaron ${copied} birras antes del error. Revisá la conexión y reintentá: las ya copiadas se omiten.`; }
 finally { setReady(true); $('migrate').disabled = false; $('logout').disabled = false; }
});
// Renueva los enlaces privados de fotos al volver a la app o tras 4 minutos.
setInterval(() => { if (cloudMode && sessionUser && !loading && !$('dialog').open && !$('beer-detail').open) loadSession(sessionUser); }, 4*60*1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && cloudMode && sessionUser && !loading && !$('dialog').open && !$('beer-detail').open) loadSession(sessionUser); });
$('style').addEventListener('change', () => { toggleCustomStyle(); if (!$('custom-style').disabled) $('custom-style').focus(); });
$('filter-style').addEventListener('change', render);
$('filter-state').addEventListener('change', render);
$('clear-filters').addEventListener('click', () => clearFilters());
$('add').addEventListener('click',()=>openForm()); $('close').addEventListener('click',()=>$('dialog').close()); $('rating').addEventListener('input',updateRating); $('search').addEventListener('input',render); $('sort').addEventListener('change',render); init();
