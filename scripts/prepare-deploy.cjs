const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = ['index.html', 'styles.css', 'app.js', 'cloud.js', 'config.js', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'offline.html'];
const assets = ['icono.png', 'app-icon.svg'];
const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), configContext);
const config = configContext.window.BIRRAS_CONFIG;
if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
  throw new Error('Completá config.js antes de preparar la publicación.');
}
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
fs.writeFileSync(htmlPath, fs.readFileSync(htmlPath, 'utf8').replace(/assets\/icono\.png(?:\?v=[a-f0-9]+)?/g, `assets/icono.png?v=${iconVersion}`));
for (const file of ['app.js', 'cloud.js', 'config.js', 'pwa.js', 'sw.js']) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
if (fs.existsSync(output)) {
  const unexpected = fs.readdirSync(output).filter(file => !files.includes(file) && file !== 'assets');
  if (unexpected.length) throw new Error('dist contiene archivos adicionales. Revisá la carpeta antes de publicar.');
}
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
const unexpectedAssets = fs.readdirSync(path.join(output, 'assets')).filter(file => !assets.includes(file));
if (unexpectedAssets.length) throw new Error('Revisá los archivos adicionales en dist/assets antes de publicar.');
for (const file of assets) fs.copyFileSync(path.join(root, 'assets', file), path.join(output, 'assets', file));
console.log('Listo: dist incluye la app, los íconos y los archivos para instalarla. Subir al proyecto Netlify existente.');
