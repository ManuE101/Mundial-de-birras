'use strict';
(() => {
  const install = document.getElementById('install-app');
  const instructions = document.getElementById('install-dialog');
  const notice = document.getElementById('connection-status');
  const standalone = window.matchMedia('(display-mode: standalone)');
  const mobile = navigator.userAgentData?.mobile ?? /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);
  let installPrompt;
  function updateInstalled() { install.hidden = !mobile || standalone.matches || navigator.standalone === true; }
  function updateConnection() { notice.hidden = navigator.onLine; }
  updateInstalled(); updateConnection();
  standalone.addEventListener('change', updateInstalled);
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; install.hidden = true; });
  install.addEventListener('click', async () => {
    if (!installPrompt) { instructions.showModal(); return; }
    const prompt = installPrompt; installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { instructions.showModal(); }
  });
  document.getElementById('install-close').addEventListener('click', () => instructions.close());
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // La web sigue funcionando aunque el navegador no permita service workers.
      });
    });
  }
})();
