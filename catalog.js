'use strict';
window.BirrasCatalog = (() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const score = value => Number(value).toLocaleString('es-AR',{minimumFractionDigits:1,maximumFractionDigits:1});
  let search='';
  function image(item) {
    const url=window.BirrasSecurity.safePhotoUrl(item.photo);
    return url ? `<img src="${esc(url)}" alt="${esc([item.brand,item.name].filter(Boolean).join(' '))}" loading="lazy">` : '<div class="public-review-no-photo">Sin foto</div>';
  }
  function cards(items) {
    return `<div class="catalog-grid">${items.map(item=>`<a class="catalog-card" href="#/birra/${encodeURIComponent(item.key)}">${image(item)}<div><p class="eyebrow">${esc(item.brand)}</p><h2>${esc(item.name)}</h2><p>${esc((item.styles||[]).map(displayStyle).join(' · ')||'Sin estilo indicado')}</p><strong class="public-score">${score(item.average)}<small> / 10</small></strong><p class="field-help">${Number(item.review_count)} ${Number(item.review_count)===1?'reseña pública':'reseñas públicas'}</p></div></a>`).join('')}</div>`;
  }
  function pagination(offset,count,total) {
    return `<div class="public-pagination"><button class="text-button" id="catalog-previous" ${offset?'':'disabled'}>Anterior</button><span>${total?`${offset+1}–${offset+count} de ${total}`:'Sin resultados'}</span><button class="text-button" id="catalog-next" ${offset+count<total?'':'disabled'}>Siguiente</button></div>`;
  }
  async function render(page,offset,user,isCurrent,refresh) {
    const frame=html=>{el('public-content').innerHTML=html;};
    let data,count,total;
    if(page.type==='beer') {
      data=await BirrasCloud.catalogDetail(page.key,offset);
      if(!isCurrent())return;
      if(!data){frame('<h1>Esta birra no está en el catálogo</h1><p>No tiene reseñas públicas disponibles.</p><a href="#/catalogo">Volver al catálogo</a>');return;}
      count=data.reviews.length;total=Number(data.review_count);
      if(offset>=total&&offset){refresh(0);return;}
      frame(`<a class="back-link" href="#/catalogo">← Catálogo</a><div class="catalog-detail">${image(data)}<div><p class="eyebrow">${esc(data.brand)}</p><h1>${esc(data.name)}</h1><p>${esc((data.styles||[]).map(displayStyle).join(' · ')||'Sin estilo indicado')}</p><div class="public-profile-stats"><div><span>Puntaje global</span><strong>${score(data.average)}<small> / 10</small></strong></div><div><span>Reseñas públicas</span><strong>${total}</strong></div><div><span>La volverían a comprar</span><strong>${data.buy_answers?Math.round(100*data.buy_yes/data.buy_answers)+'%':'—'}</strong><small>${Number(data.buy_answers)} respuestas</small></div></div>${user?(data.tried?'<p>Ya está entre tus birras probadas.</p>':`<button class="primary" id="wishlist-toggle">${data.saved?'Quitar de Por probar':'Agregar a Por probar'}</button><p class="field-help">Tu lista Por probar es pública.</p>`):'<p><a href="#/">Iniciá sesión</a> para guardarla en Por probar.</p>'}<p id="wishlist-status" role="status"></p></div></div><h2>Lo que opinaron</h2><div class="public-reviews">${data.reviews.map(review=>`<article class="public-review">${image({...review,brand:data.brand,name:data.name})}<div><div class="public-review-heading"><a href="#/perfil/${encodeURIComponent(review.username)}">@${esc(review.username)}</a><strong class="public-score">${score(review.rating)}<small> / 10</small></strong></div><p class="public-review-meta">${esc(displayStyle(review.style||'')||'Sin estilo indicado')}${review.date?' · '+esc(review.date):''}</p><p class="public-review-notes">${esc(review.notes||'Sin opinión escrita.')}</p>${review.buy_again==null?'':`<p>${review.buy_again?'La volvería a comprar':'No la volvería a comprar'}</p>`}</div></article>`).join('')}</div>${pagination(offset,count,total)}`);
      el('wishlist-toggle')?.addEventListener('click',async()=>{
        const button=el('wishlist-toggle');button.disabled=true;
        try {await BirrasCloud.setWishlist(page.key,!data.saved);if(isCurrent())refresh(offset);}
        catch(error){if(isCurrent()){el('wishlist-status').textContent=error.message||'No se pudo guardar. Volvé a intentar.';button.disabled=false;}}
      });
    } else {
      data=page.type==='wishlist'?await BirrasCloud.wishlist(page.username,offset):await BirrasCloud.catalog(search,offset);
      if(!isCurrent())return;
      count=data.items.length;total=Number(data.total);
      if(offset>=total&&offset){refresh(0);return;}
      const heading=page.type==='wishlist'?`<a class="back-link" href="#/perfil/${encodeURIComponent(page.username)}">← @${esc(page.username)}</a><h1>Por probar</h1><p>Las birras que @${esc(page.username)} tiene pendientes.</p>`:`<h1>Catálogo</h1><p>Las birras que compartimos, con el puntaje de todos.</p><form id="catalog-search-form" class="public-search"><label for="catalog-search">Buscar birra</label><div><input id="catalog-search" type="search" maxlength="120" value="${esc(search)}" placeholder="Marca, nombre, estilo, opinión, usuario…"><button class="primary" type="submit">Buscar</button></div><p class="field-help">Podés combinar palabras de distintos campos.</p></form>`;
      frame(`${heading}${page.type==='catalog'?'<button id="catalog-scan" class="text-button" type="button">Buscar por foto</button>':''}${count?cards(data.items):`<p class="public-empty">${page.type==='wishlist'?'Todavía no hay birras pendientes con reseñas públicas.':search?'No encontramos birras con esos datos.':'Todavía no hay birras publicadas.'}</p>`}${pagination(offset,count,total)}`);
      if(page.type==='catalog')el('catalog-scan').addEventListener('click',()=>window.BirrasScanner.open());
      el('catalog-search-form')?.addEventListener('submit',event=>{event.preventDefault();search=el('catalog-search').value.trim();refresh(0);});
    }
    el('catalog-next')?.addEventListener('click',()=>refresh(offset+20));
    el('catalog-previous')?.addEventListener('click',()=>refresh(Math.max(0,offset-20)));
  }
  function find(value) {
    search=String(value||'').trim().slice(0,120);
    if(window.location.hash==='#/catalogo')window.dispatchEvent(new CustomEvent('birras:catalog-search'));
    else window.location.hash='/catalogo';
  }
  return {render,find};
})();
