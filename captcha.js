'use strict';
window.BirrasCaptcha = (() => {
  const widgets = new Map();
  let lastError = '';
  const enabled = () => Boolean(window.BIRRAS_CONFIG?.turnstileSiteKey);
  function showError(code) {
    const value = String(code || '').replace(/[^0-9]/g, '').slice(0, 6);
    const domain = window.location?.hostname || 'este dominio';
    const descriptions = {
      '110100': 'La Site Key no es válida. Revisá la configuración del widget.',
      '110110': 'No se encontró la Site Key. Revisá la configuración del widget.',
      '110200': `El dominio ${domain} no está autorizado en Cloudflare Turnstile.`,
      '200500': 'No se pudo cargar la verificación de Cloudflare. Probá en otro navegador o red para identificar un posible bloqueo.',
      '200100': 'Cloudflare detectó un problema de reloj o caché. Revisá la fecha y hora del dispositivo y recargá.',
      '110600': 'La verificación tardó demasiado. Recargá la página para volver a intentar.',
      '110620': 'La verificación venció. Recargá la página para volver a intentar.'
    };
    lastError = `${descriptions[value] || 'No se pudo completar la verificación. Recargá la página o probá otro navegador.'}${value ? ` Código: ${value}.` : ''}`;
    document.getElementById('auth-message').textContent = lastError;
  }
  function renderVisible() {
    if (!enabled() || !window.turnstile) return;
    for (const formId of ['auth-form', 'reset-request-form']) {
      const form = document.getElementById(formId), container = form.querySelector('.captcha-widget');
      if (!form.hidden && !widgets.has(formId)) {
        const id = window.turnstile.render(container, {
          sitekey: window.BIRRAS_CONFIG.turnstileSiteKey, theme:'light', size:'flexible',
          'error-callback': showError,
          callback: () => {
            const message = document.getElementById('auth-message');
            if (message.textContent === lastError) message.textContent = '';
          }
        });
        widgets.set(formId, id);
      }
    }
  }
  function token(formId) {
    if (!enabled()) return undefined;
    renderVisible();
    const id = widgets.get(formId), value = id == null ? '' : window.turnstile?.getResponse(id);
    if (!value) throw new Error('Completá la verificación de seguridad antes de continuar.');
    return value;
  }
  function reset(formId) { const id = widgets.get(formId); if (id != null) window.turnstile?.reset(id); }
  if (enabled()) {
    window.birrasTurnstileReady = renderVisible;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=birrasTurnstileReady&render=explicit';
    script.async = true;
    script.onerror = () => { document.getElementById('auth-message').textContent = 'No se pudo cargar la verificación de seguridad. Revisá la conexión y recargá.'; };
    document.head.appendChild(script);
    new MutationObserver(renderVisible).observe(document.getElementById('account'), {subtree:true, attributes:true, attributeFilter:['hidden']});
  }
  return Object.freeze({token, reset, enabled});
})();
