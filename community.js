'use strict';
(() => {
  const el = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const score = value => Number(value).toLocaleString('es-AR',{minimumFractionDigits:1,maximumFractionDigits:1});
  const date = value => value ? new Date(value.includes('T') ? value : value+'T12:00:00').toLocaleDateString('es-AR') : 'Sin indicar';
  let ready=false, currentUser=null, own=null, version=0, offset=0, activeName='', search='', after='', previousPages=[];
  let photo=null, removeAvatar=false, photoTask=Promise.resolve(), photoVersion=0;
  function avatar(url, username, extra='') {
    const safe=window.BirrasSecurity.safePhotoUrl(url);
    return safe ? `<img class="public-avatar ${extra}" src="${escape(safe)}" alt="Foto de ${escape(username)}">` : `<span class="public-avatar avatar-letter ${extra}" aria-hidden="true">${escape(username.slice(0,1).toUpperCase())}</span>`;
  }
  function route() {
    const hash=window.location.hash;
    if (hash==='#/comunidad') return {type:'directory'};
    if (hash==='#/catalogo') return {type:'catalog'};
    const beer=hash.match(/^#\/birra\/([a-f0-9]{32})$/);
    if (beer) return {type:'beer',key:beer[1]};
    const pending=hash.match(/^#\/perfil\/([a-z0-9_]{3,40})\/por-probar$/);
    if (pending) return {type:'wishlist',username:pending[1]};
    const match=hash.match(/^#\/perfil\/([a-z0-9_]{3,40})$/);
    return match ? {type:'profile',username:match[1]} : {type:'personal'};
  }
  function frame(content) {
    el('public-content').innerHTML=content;
  }
  async function ownProfile() {
    if (!currentUser) return null;
    const owner=currentUser.id;
    const profile=await BirrasCloud.ownProfile();
    if (currentUser?.id===owner) own=profile;
    return currentUser?.id===owner ? profile : null;
  }
  async function renderRoute(resetPage=true) {
    const page=route(), request=++version;
    const isPublic=page.type!=='personal';
    document.body.toggleAttribute('data-public-view',isPublic);
    el('public-content').hidden=!isPublic;
    const nav=['catalog','beer'].includes(page.type)?'#/catalogo':isPublic?'#/comunidad':'#/';
    document.querySelectorAll('.main-nav a').forEach(link=>{ if(link.hash===nav) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current'); });
    if (!isPublic) return;
    if (resetPage) { offset=0; after=''; previousPages=[]; }
    frame('<p class="public-loading" role="status">Cargando...</p>');
    if (!ready) return;
    try {
      if (['catalog','beer','wishlist'].includes(page.type)) {
        await window.BirrasCatalog.render(page,offset,currentUser,()=>request===version,next=>{offset=next;renderRoute(false);});
        return;
      }
      if (page.type==='directory') {
        const hasSearch=Boolean(search.trim());
        const profiles=hasSearch ? await BirrasCloud.publicProfiles(search,after) : [];
        if (request!==version) return;
        frame(`<div class="public-heading"><div><h1>Comunidad</h1><p>Los que se sumaron al Mundial de Birras.</p></div></div><form id="profile-search-form" class="public-search"><label for="profile-search">Buscar nombre de usuario</label><div><input id="profile-search" type="search" maxlength="40" value="${escape(search)}" placeholder="Ej. manubirrero"><button class="primary" type="submit">Buscar</button></div></form><div class="profile-grid">${profiles.length ? profiles.map(profile=>`<a class="profile-card" href="#/perfil/${encodeURIComponent(profile.username)}">${avatar(profile.avatar,profile.username)}<strong>@${escape(profile.username)}</strong></a>`).join('') : hasSearch ? '<p>No encontramos perfiles con ese nombre.</p>' : '<p class="field-help">Buscá un usuario para ver su perfil.</p>'}</div><div class="public-pagination" ${hasSearch && profiles.length ? '' : 'hidden'}><button class="text-button" id="profiles-previous" ${previousPages.length?'':'disabled'}>Anterior</button><button class="text-button" id="profiles-next" ${profiles.length===20?'':'disabled'}>Siguiente</button></div>`);
        el('profile-search-form').addEventListener('submit',event=>{event.preventDefault();search=el('profile-search').value.trim().toLowerCase();renderRoute();});
        el('profile-search').addEventListener('input',()=>{if(!el('profile-search').value.trim()){search='';renderRoute();el('profile-search').focus();}});
        el('profiles-next').addEventListener('click',()=>{previousPages.push(after);after=profiles.at(-1).username;renderRoute(false);});
        el('profiles-previous').addEventListener('click',()=>{after=previousPages.pop()||'';renderRoute(false);});
      } else {
        activeName=page.username;
        const profile=await BirrasCloud.publicProfile(page.username,offset);
        if (request!==version) return;
        if (!profile) { frame('<h1>Perfil no encontrado</h1><p>Puede que el usuario haya cambiado su nombre.</p><a href="#/comunidad">Volver a la comunidad</a>'); return; }
        if (offset && offset >= Number(profile.review_count)) {offset=profile.review_count ? Math.floor((profile.review_count-1)/20)*20 : 0;return renderRoute(false);}
        const isOwn=own?.username===profile.username;
        frame(`<a class="back-link" href="#/comunidad">← Comunidad</a><div class="public-profile-heading">${avatar(profile.avatar,profile.username,'large')}<div><h1>@${escape(profile.username)}</h1><p>Se sumó el ${escape(date(profile.created_at))}</p></div>${isOwn?'<button class="text-button" id="edit-public-profile">Editar mi perfil</button>':''}</div><div class="public-profile-stats"><div><span>Reseñas públicas</span><strong>${Number(profile.review_count)}</strong></div><div><span>Puntaje promedio</span><strong>${profile.average==null?'—':score(profile.average)}</strong></div></div><a class="wishlist-profile-link" href="#/perfil/${encodeURIComponent(profile.username)}/por-probar">Por probar ?</a><h2>Sus birras</h2><p class="field-help">Solo las reseñas públicas. Las privadas no aparecen ni cuentan para estos números.</p><div class="public-reviews">${profile.reviews.length ? profile.reviews.map(review=>{
          const safe=window.BirrasSecurity.safePhotoUrl(review.photo);
          return `<article class="public-review">${safe?`<img src="${escape(safe)}" alt="${escape(review.brand+' '+review.name)}" loading="lazy">`:'<div class="public-review-no-photo">Sin foto</div>'}<div><div class="public-review-heading"><div><p class="eyebrow">${escape(review.brand)}</p><h3>${escape(review.name)}</h3></div><strong class="public-score">${score(review.rating)}<small> / 10</small></strong></div><p class="public-review-meta">${escape(displayStyle(review.style||'')||'Sin estilo indicado')} · ${escape(date(review.date))}</p><p class="public-review-notes">${escape(review.notes||'Sin opinión escrita.')}</p>${review.buy_again==null?'':`<p class="buy-again-note">${review.buy_again?'La volvería a comprar':'No la volvería a comprar'}</p>`}</div></article>`;
        }).join('') : '<p class="public-empty">Todavía no compartió ninguna reseña.</p>'}</div><div class="public-pagination"><button class="text-button" id="reviews-previous" ${offset?'':'disabled'}>Anterior</button><span>${profile.review_count ? `${offset+1}–${offset+profile.reviews.length} de ${profile.review_count}`:'0 reseñas'}</span><button class="text-button" id="reviews-next" ${offset+profile.reviews.length<profile.review_count?'':'disabled'}>Siguiente</button></div>`);
        el('edit-public-profile')?.addEventListener('click',openEditor);
        el('reviews-next').addEventListener('click',()=>{offset+=20;renderRoute(false);});
        el('reviews-previous').addEventListener('click',()=>{offset=Math.max(0,offset-20);renderRoute(false);});
      }
    } catch { if (request===version) frame('<h1>No pudimos cargar esta página.</h1><p>Revisá la conexión y volvé a intentar.</p><button class="primary" id="public-retry">Reintentar</button>'); el('public-retry')?.addEventListener('click',()=>renderRoute(false)); }
  }
  async function openEditor() {
    if (!currentUser) return;
    const owner=currentUser.id;
    try {
      const profile=await ownProfile();
      if (!profile || currentUser?.id!==owner) return;
      photo=null;removeAvatar=false;photoVersion++;photoTask=Promise.resolve();
      el('profile-form').reset();el('profile-error').textContent='';
      el('profile-username').value=/^birrero_[a-f0-9]{32}$/.test(profile.username)?'':profile.username;
      el('profile-preview').hidden=true;el('profile-remove-photo').hidden=true;el('profile-preview').removeAttribute('src');
      el('profile-editor').showModal();
      const visible=await BirrasCloud.publicProfile(profile.username);
      if (currentUser?.id===owner && el('profile-editor').open && !photo && !removeAvatar && visible?.avatar) {
        el('profile-preview').src=visible.avatar;el('profile-preview').hidden=false;el('profile-remove-photo').hidden=false;
      }
    } catch { el('status').textContent='No pudimos abrir tu perfil. Revisá la conexión y volvé a intentar.'; }
  }
  el('my-profile-link').addEventListener('click',async()=>{
    try {
      const profile=await ownProfile();
      if (profile) {
        if (/^birrero_[a-f0-9]{32}$/.test(profile.username)) await openEditor();
        else window.location.hash=`/perfil/${profile.username}`;
      }
    } catch { el('status').textContent='No pudimos cargar tu perfil. Revisá la conexión.'; }
  });
  el('profile-close').addEventListener('click',()=>el('profile-editor').close());
  el('profile-editor').addEventListener('close',()=>{photoVersion++;photo=null;el('profile-preview').removeAttribute('src');});
  el('profile-username').addEventListener('input',()=>{el('profile-username').value=el('profile-username').value.toLowerCase();});
  el('profile-photo').addEventListener('change',()=>{
    const file=el('profile-photo').files[0], selection=++photoVersion;
    if (!file) return;
    el('profile-error').textContent='';
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15*1024*1024) {el('profile-error').textContent='Elegí JPG, PNG o WebP de hasta 15 MB.';el('profile-photo').value='';return;}
    photoTask=compress(file).then(value=>{if(selection!==photoVersion)return;photo=value;removeAvatar=false;el('profile-preview').src=value;el('profile-preview').hidden=false;el('profile-remove-photo').hidden=false;}).catch(()=>{if(selection===photoVersion)el('profile-error').textContent='No pudimos leer esa foto. Probá con otra.';});
  });
  el('profile-remove-photo').addEventListener('click',()=>{photoVersion++;photo=null;removeAvatar=true;el('profile-photo').value='';el('profile-preview').hidden=true;el('profile-remove-photo').hidden=true;el('profile-preview').removeAttribute('src');});
  el('profile-form').addEventListener('submit',async event=>{
    event.preventDefault();const owner=currentUser?.id;if(!owner)return;
    const button=event.submitter, editVersion=photoVersion;button.disabled=true;el('profile-form').inert=true;el('profile-error').textContent='';
    try {
      await photoTask;
      if (owner!==currentUser?.id || !el('profile-editor').open || editVersion!==photoVersion) return;
      const profile=await BirrasCloud.updateProfile({username:el('profile-username').value,photo,removeAvatar});
      if (owner!==currentUser?.id) return;
      own={...own,...profile};
      if(!el('profile-editor').open)return;
      el('profile-editor').close();
      if(window.location.hash===`#/perfil/${profile.username}`) renderRoute();
      else window.location.hash=`/perfil/${profile.username}`;
    } catch(error) { if(owner===currentUser?.id)el('profile-error').textContent=error.message||'No se pudo guardar el perfil.'; }
    finally {button.disabled=false;el('profile-form').inert=false;}
  });
  window.addEventListener('birras:session',async event=>{
    ready=true;const user=event.detail.user;
    if (user?.id!==currentUser?.id) {own=null;photoVersion++;el('profile-editor').close();}
    currentUser=user;el('my-profile-link').hidden=!user||event.detail.recovering;
    if(event.detail.recovering){history.replaceState(null,'',window.location.pathname+window.location.search);renderRoute();return;}
    renderRoute(false);
    if(user){try{await ownProfile();if(route().type==='profile')renderRoute(false);}catch{}}
  });
  window.addEventListener('hashchange',()=>renderRoute());
  window.addEventListener('birras:catalog-search',()=>renderRoute());
  window.addEventListener('birras:reviews-changed',()=>{if(route().type!=='personal')renderRoute();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&route().type!=='personal'&&!el('profile-editor').open&&!el('scan-dialog')?.open)renderRoute(false);});
  setInterval(()=>{if(!document.hidden&&route().type!=='personal'&&!el('profile-editor').open&&!el('scan-dialog')?.open&&document.activeElement?.id!=='catalog-search')renderRoute(false);},30000);
  renderRoute();
})();
