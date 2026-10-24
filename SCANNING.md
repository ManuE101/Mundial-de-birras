# Prueba de búsqueda por etiqueta

**Actualización:** ahora el selector ofrece reconocimiento con Google como prueba y conserva el OCR local como alternativa. El modo Google envía la foto a Supabase y luego al proveedor, requiere sesión confirmada y tiene cupos persistentes. Para activarlo seguir [GEMINI-SETUP.md](GEMINI-SETUP.md). Las afirmaciones de procesamiento local y ausencia de nuevas migraciones de las secciones siguientes corresponden únicamente al modo **Leer texto en mi dispositivo**.

En Catálogo → Buscar por foto se puede sacar una foto con la cámara del teléfono o elegir JPG, PNG o WebP de la galería. La cámara usa el selector nativo del navegador, sin acceso a una transmisión de video. La imagen se lee localmente con Tesseract.js 7.0.0 y modelos de español e inglés. No se sube a Supabase ni se envía a un servicio de reconocimiento.

La lectura propone texto editable. Antes de buscar, dejar solo marca, nombre o estilo; quitar cantidades y otras frases de la etiqueta. El buscador actual exige todas las palabras y no corrige automáticamente los errores del OCR. Los resultados abren las fichas existentes con opiniones y puntajes. No se crea ninguna cerveza desde este flujo.

## Publicación

Ejecutar `npm ci` si corresponde y `npm run prepare:deploy`. Subir todo `dist`, incluida `vendor/ocr`, a Netlify. No hay migraciones nuevas de Supabase. El build copia el lector, tres variantes LSTM del motor y los dos modelos desde dependencias con versiones fijadas; la biblioteca tiene SRI. Los archivos pesados se solicitan al leer una foto, no al abrir el catálogo. La primera lectura requiere conexión y puede tardar en un teléfono.

La CSP agrega únicamente `wasm-unsafe-eval` para ejecutar WebAssembly; conserva el bloqueo de eval de JavaScript, scripts inline, workers externos y conexiones arbitrarias. Se mantiene `camera=()` porque no se usa getUserMedia: el usuario elige o captura un archivo mediante el selector del sistema. No se agregan claves ni servicios pagos.

## Límites

- Archivos hasta 15 MB y 25 millones de píxeles; se reducen a 1800 píxeles en el lado mayor para la lectura.
- Una lectura por vez, con límite de espera de dos minutos. Cerrar el diálogo descarta resultados y libera la vista previa; si la inicialización termina después, se termina ese motor sin mostrar el resultado.
- La imagen y el texto reconocido no se guardan en la base ni en almacenamiento local. El texto confirmado se envía al buscador de Supabase como una búsqueda normal.
- Es OCR de texto. No identifica un logo por su forma, no interpreta dibujos ni usa códigos de barras. Reflejos, tipografías decorativas, texto curvo o etiquetas giradas pueden dar malos resultados. HEIC no está soportado: elegir JPEG o capturar una foto compatible.

## Validación

`npm test` incluye un reconocimiento real de una etiqueta sintética legible con el motor y los modelos locales, y pruebas de límites, cancelación, limpieza, rutas de recursos y CSP. La muestra sintética no mide precisión en latas o botellas reales. No había navegador conectado disponible para realizar la prueba visual en esta sesión.

Después de publicar, probar en Android/Chrome e iPhone/Safari: cámara y galería; primer uso; etiqueta de frente y con reflejos; cerrar mientras lee; error de formato; corregir texto; buscar una cerveza existente y una ausente. Verificar consola y red para comprobar que no hay errores de CSP y que los modelos salen del mismo sitio. Para decidir si esta solución alcanza, comparar al menos diez etiquetas reales: texto leído, correcciones necesarias, coincidencia encontrada y tiempo de lectura. No se presupone una tasa de aciertos hasta hacer esa prueba.
