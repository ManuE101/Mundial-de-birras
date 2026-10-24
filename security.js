'use strict';
window.BirrasSecurity = (() => {
  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  function validateBeer(beer) {
    if (!uuid(beer.id)) throw new Error('El identificador de la cerveza no es válido.');
    for (const [field, max, required] of [['brand',80,true], ['name',100,true], ['style',80,false], ['notes',1500,false]]) {
      if (typeof beer[field] !== 'string' || [...beer[field]].length > max || (required && !beer[field].trim())) throw new Error('Revisá los campos de la cerveza y sus límites de texto.');
    }
    if (typeof beer.rating !== 'number' || !Number.isFinite(beer.rating) || beer.rating < 0 || beer.rating > 10 || Math.abs(beer.rating * 10 - Math.round(beer.rating * 10)) > 1e-8) throw new Error('Poné un puntaje de 0 a 10, con un decimal como máximo.');
    for (const flag of [beer.drunk, beer.buyAgain, beer.isPublic]) if (flag != null && typeof flag !== 'boolean') throw new Error('Revisá las opciones de la cerveza.');
    if (beer.date != null && beer.date !== '') {
      const date = new Date(`${beer.date}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(beer.date) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== beer.date) throw new Error('La fecha no es válida.');
    }
    if (!Number.isFinite(beer.createdAt) || !Number.isFinite(new Date(beer.createdAt).getTime())) throw new Error('La fecha de creación no es válida.');
  }
  function ownsPhoto(path, owner) {
    return typeof path === 'string' && path.startsWith(`${owner}/`) && /^[^/]+\/[^/]+\.jpg$/.test(path) && !path.includes('..');
  }
  function safePhotoUrl(value) {
    if (typeof value !== 'string') return '';
    if (value.startsWith('data:image/jpeg;base64,') && value.length <= Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 30) return value;
    try {
      const url = new URL(value), project = new URL(window.BIRRAS_CONFIG?.supabaseUrl);
      if (url.protocol === 'https:' && url.origin === project.origin && url.pathname.startsWith('/storage/v1/object/')) return url.href;
    } catch {}
    return '';
  }
  async function jpegBlob(value) {
    const prefix = 'data:image/jpeg;base64,';
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + prefix.length) throw new Error('La foto debe ser JPEG y ocupar hasta 2 MB.');
    let raw;
    try { raw = atob(value.slice(prefix.length)); } catch { throw new Error('La foto no es válida.'); }
    if (raw.length < 4 || raw.length > MAX_PHOTO_BYTES || raw.charCodeAt(0) !== 255 || raw.charCodeAt(1) !== 216 || raw.charCodeAt(2) !== 255) throw new Error('La foto no es un JPEG válido.');
    return new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], {type:'image/jpeg'});
  }
  return Object.freeze({ MAX_PHOTO_BYTES, validateBeer, ownsPhoto, safePhotoUrl, jpegBlob });
})();
