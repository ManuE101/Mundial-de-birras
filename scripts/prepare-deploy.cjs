const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = ['index.html', 'styles.css', 'app.js', 'community.js', 'catalog.js', 'scanner.js', 'cloud.js', 'config.js', 'security.js', 'captcha.js', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'offline.html', '_headers'];
const assets = ['icono.png', 'app-icon.svg'];
const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), configContext);
const config = configContext.window.BIRRAS_CONFIG;
if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
  throw new Error('Completá config.js antes de preparar la publicación.');
}
const project = new URL(config.supabaseUrl);
if (project.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(project.hostname) || project.port || project.pathname !== '/' || project.username || project.password) throw new Error('La URL de Supabase debe ser HTTPS y pertenecer al proyecto.');
if (!config.supabasePublishableKey.startsWith('sb_publishable_')) throw new Error('El despliegue requiere la clave pública publishable; nunca una clave secret o service_role.');
const sdkVersion = require('../package.json').dependencies['@supabase/supabase-js'];
const installedVersion = require('../node_modules/@supabase/supabase-js/package.json').version;
if (sdkVersion !== installedVersion) throw new Error('Ejecutá npm ci para instalar la versión fijada del SDK.');
const sdkSource = path.join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
fs.copyFileSync(sdkSource, path.join(root, 'vendor/supabase.js'));
fs.copyFileSync(path.join(root, 'node_modules/@supabase/supabase-js/LICENSE'), path.join(root, 'vendor/LICENSE-supabase'));
const sdkIntegrity = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(sdkSource)).digest('base64');
// OCR local; las fotos nunca salen del dispositivo.
const ocrFiles = {
  'tesseract.min.js':'tesseract.js/dist/tesseract.min.js',
  'worker.min.js':'tesseract.js/dist/worker.min.js',
  'LICENSE-tesseract':'tesseract.js/LICENSE.md',
  'LICENSE-core':'tesseract.js-core/LICENSE',
  'NOTICE-tesseract':'tesseract.js/dist/tesseract.min.js.LICENSE.txt',
  'NOTICE-worker':'tesseract.js/dist/worker.min.js.LICENSE.txt',
  'spa.traineddata.gz':'@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
  'eng.traineddata.gz':'@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'
};
for(const variant of ['lstm','simd-lstm','relaxedsimd-lstm'])ocrFiles[`tesseract-core-${variant}.wasm.js`]=`tesseract.js-core/tesseract-core-${variant}.wasm.js`;
for(const name of ['tesseract.js','@tesseract.js-data/spa','@tesseract.js-data/eng']) {
  if(require('../package.json').dependencies[name]!==require(path.join(root,'node_modules',name,'package.json')).version)throw new Error('Ejecutá npm ci para instalar las versiones fijadas del lector.');
}
fs.mkdirSync(path.join(root,'vendor/ocr'),{recursive:true});
for(const [target,source] of Object.entries(ocrFiles))fs.copyFileSync(path.join(root,'node_modules',source),path.join(root,'vendor/ocr',target));
const ocrIntegrity='sha384-'+crypto.createHash('sha384').update(fs.readFileSync(path.join(root,'vendor/ocr/tesseract.min.js'))).digest('base64');
const offlineStyle = fs.readFileSync(path.join(root, 'offline.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)?.[1];
const styleHash = crypto.createHash('sha256').update(offlineStyle || '').digest('base64');
const policy = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'sha256-${styleHash}'; img-src 'self' data: blob: ${project.origin}; font-src 'self'; connect-src 'self' ${project.origin} https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`;
fs.writeFileSync(path.join(root, '_headers'), `/*\n  Content-Security-Policy: ${policy}\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n  Strict-Transport-Security: max-age=31536000\n  Cache-Control: no-cache\n/\n  Cache-Control: no-store\n/index.html\n  Cache-Control: no-store\n/config.js\n  Cache-Control: no-store\n/sw.js\n  Cache-Control: no-store\n  Service-Worker-Allowed: /\n`);
// Regenerar el contenedor al reemplazar el PNG y cambiar su URL para evitar cachés viejas.
const icon = fs.readFileSync(path.join(root, 'assets', 'icono.png'));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!icon.subarray(0, 8).equals(pngSignature)) throw new Error('assets/icono.png debe ser un PNG válido.');
const width = icon.readUInt32BE(16), height = icon.readUInt32BE(20);
if (width !== height || width < 512) throw new Error('El ícono debe ser cuadrado y tener al menos 512 píxeles.');
const iconVersion = crypto.createHash('sha256').update(icon).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(root, 'assets', 'app-icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${icon.toString('base64')}"/></svg>`);
const manifestPath = path.join(root, 'manifest.webmanifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.icons.forEach(item => {
  item.src = `${item.src.split('?')[0]}?v=${iconVersion}`;
  if (item.type === 'image/png') item.sizes = `${width}x${height}`;
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const htmlPath = path.join(root, 'index.html');
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8')
  .replace(/assets\/icono\.png(?:\?v=[a-f0-9]+)?/g, `assets/icono.png?v=${iconVersion}`)
  .replace(/<script src="vendor\/ocr\/tesseract.min.js"[^>]*>/, `<script src="vendor/ocr/tesseract.min.js" integrity="${ocrIntegrity}" defer>`)
  .replace(/<script src="vendor\/supabase\.js"[^>]*>/, `<script src="vendor/supabase.js" integrity="${sdkIntegrity}" defer>`));
for (const file of ['app.js', 'community.js', 'catalog.js', 'scanner.js', 'cloud.js', 'config.js', 'security.js', 'captcha.js', 'pwa.js', 'sw.js']) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
if (fs.existsSync(output)) {
  const unexpected = fs.readdirSync(output).filter(file => !files.includes(file) && !['assets', 'vendor'].includes(file));
  if (unexpected.length) throw new Error('dist contiene archivos adicionales. Revisá la carpeta antes de publicar.');
}
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
const unexpectedAssets = fs.readdirSync(path.join(output, 'assets')).filter(file => !assets.includes(file));
if (unexpectedAssets.length) throw new Error('Revisá los archivos adicionales en dist/assets antes de publicar.');
for (const file of assets) fs.copyFileSync(path.join(root, 'assets', file), path.join(output, 'assets', file));
fs.mkdirSync(path.join(output, 'vendor'), { recursive: true });
const vendorFiles = ['supabase.js', 'LICENSE-supabase'];
if (fs.readdirSync(path.join(output, 'vendor')).some(file => !vendorFiles.includes(file) && file!=='ocr')) throw new Error('Revisá los archivos adicionales de dist/vendor.');
for (const file of vendorFiles) fs.copyFileSync(path.join(root, 'vendor', file), path.join(output, 'vendor', file));
fs.mkdirSync(path.join(output,'vendor/ocr'),{recursive:true});
if(fs.readdirSync(path.join(output,'vendor/ocr')).some(file=>!Object.hasOwn(ocrFiles,file)))throw new Error('Revisá los archivos adicionales de dist/vendor/ocr.');
for(const file of Object.keys(ocrFiles))fs.copyFileSync(path.join(root,'vendor/ocr',file),path.join(output,'vendor/ocr',file));
console.log('Listo: dist incluye la app, los íconos y los archivos para instalarla. Subir al proyecto Netlify existente.');
