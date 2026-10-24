# Seguridad de la versión privada

## Ampliación de perfiles (migración 005)

La nueva entrega cambia la visibilidad por decisión del usuario: perfiles públicos y reseñas con selector público/privado; las existentes se hacen públicas al agregar `is_public`. Ver `PROFILES.md` antes de aplicar. La tabla de reseñas mantiene RLS del dueño y se expone una proyección limitada mediante funciones revisadas; los emails y el estado de degustación no se devuelven. El bucket sigue privado, con lectura pública solo de imágenes compartidas/avatares. Las pruebas y límites de la entrega 004 se conservan; esta ampliación no habilita escaneo ni catálogo global.

Esta entrega refuerza la app actual. No crea perfiles públicos ni comparte reseñas. No es una garantía de ausencia de vulnerabilidades ni una auditoría del proyecto remoto: desde este entorno se verificó el código local, las pruebas de frontend y el SQL sobre PostgreSQL embebido (PGlite), con esquemas mínimos de Auth/Storage. Pasaron aislamiento entre cuentas, cuotas y bloqueo de usuarios sin email confirmado. Las políticas desplegadas, el proceso real de subir archivos, los correos y las cabeceras requieren la verificación indicada abajo.

## Aplicación y despliegue

- SDK Supabase fijado en `package.json` y `package-lock.json`. Se copia la distribución oficial a `vendor/` y se sirve localmente, con SRI. La app ya no descarga el SDK de un CDN al iniciar. Ejecutar `npm ci --ignore-scripts` al preparar otra máquina y `npm audit --omit=dev` al actualizar dependencias.
- `scripts/prepare-deploy.cjs` valida que se use una clave publishable y genera `_headers` para Netlify: CSP sin scripts inline ni eval, protección de iframes, no-referrer, nosniff y permisos de cámara/micrófono/geolocalización deshabilitados en esta versión. El escaneo futuro requerirá habilitar la cámara deliberadamente.
- La CSP permite únicamente el proyecto Supabase configurado, los archivos propios y Cloudflare Turnstile. El estilo de la página offline tiene un hash específico. Las barras de estadísticas no requieren estilos inline.
- Campos, puntajes, fechas, rutas de fotos y JPEG se validan antes del guardado. Las fotos se decodifican y recodifican a JPEG con un máximo de 1200 píxeles y 2 MB; rechazan más de 25 megapíxeles. Son límites del cliente, no una inspección de imagen ejecutada por el servidor. Storage impone tamaño y MIME; una futura validación binaria independiente del cliente necesitaría una función de subida dedicada.
- Las fotos mostradas se restringen a JPEG locales o URLs HTTPS de Storage del proyecto. Los atributos y textos se escapan, y las fotos pendientes se invalidan al cambiar de sesión/formulario. Los enlaces de imágenes privadas vencen a los 5 minutos; no equivalen a una revocación instantánea de un enlace ya compartido.
- El service worker solo conserva el aviso offline, nunca datos ni respuestas privadas. La sesión del SDK sigue persistida en el navegador; cerrar sesión es necesario en dispositivos compartidos.

## Aplicar en Supabase, antes de publicar

1. Confirmar que ya se ejecutaron `002-buy-again.sql` y `003-optional-fields.sql`.
2. Ejecutar `supabase/004-security.sql` completo en SQL Editor. No volver a ejecutar todo `setup.sql` sobre la base existente.
3. El resultado debe mostrar RLS activado y forzado, `beer-photos.public = false`, tamaño máximo `2097152` y solo `image/jpeg`.
4. Ejecutar `supabase/security-check.sql`. Las comprobaciones deben terminar sin errores y las cuatro columnas de permisos deben ser `false`. Todo se revierte al terminar, incluidos usuarios y reseñas ficticios. Si una prueba interrumpe la transacción, ejecutar `ROLLBACK;` antes de continuar. Hacer primero esta comprobación en una copia/staging si hay otros triggers personalizados para usuarios.
5. En Authentication, mantener confirmación de email habilitada, contraseñas de al menos 8 caracteres y únicamente las URLs de producción/local realmente usadas. Revisar también rate limits de registro y recuperación de correo. La app conserva el acceso de contraseñas existentes; la regla nueva se aplica a altas/cambios.

La migración agrega una política restrictiva por dueño, evita cambiar identidad/propietario/fecha de creación y exige email confirmado para insertar/editar y subir imágenes. Los checks nuevos de ruta se agregan `NOT VALID`: protegen escrituras nuevas sin borrar ni bloquear por adelantado datos anteriores. Se puede revisar su compatibilidad y validarlos posteriormente.

### Cuotas del servidor

- Hasta 120 inserciones/ediciones por minuto y 2000 por día UTC y usuario.
- Hasta 10.000 cervezas por cuenta.
- Hasta 20 nuevas fotos por minuto y 200 por día UTC y usuario.
- Hasta 500 fotos y 100 MB por cuenta; presupuesto conjunto de 800 MB para `beer-photos`.
- Cada foto nueva reserva conservadoramente 2 MB al evaluar el presupuesto. Los objetos aún sin metadata de tamaño cuentan como 2 MB.

Estos límites se aplican mediante triggers de Postgres y no se evitan omitiendo la interfaz. Son configurables en la migración. Los accesos administrativos sin JWT de usuario no consumen estas cuotas. No limitan todos los intentos fallidos ni el tráfico de lectura: Auth tiene sus propios controles y el proveedor sigue siendo responsable de la protección de red. Un atacante con muchas cuentas podría agotar el presupuesto global; el CAPTCHA y la confirmación de email reducen ese riesgo, no lo eliminan. La prueba real de subidas mediante Storage es necesaria porque la migración incorpora un trigger a `storage.objects`.

## Activar protección contra bots

La integración de CAPTCHA está implementada pero **no está activada** hasta configurar ambos servicios:

1. Crear un widget **Cloudflare Turnstile** y autorizar el hostname real `magnificent-starship-900076.netlify.app` y `localhost` si se prueba allí.
2. Pegar solo la **site key pública** en `config.js → turnstileSiteKey` y preparar/publicar `dist`.
3. En Supabase Authentication → Bot and Abuse Protection, elegir Turnstile y cargar la **secret key directamente en el panel**. Nunca copiarla al proyecto ni al chat.
4. Activar CAPTCHA en Supabase y probar registro, inicio de sesión y solicitud de recuperación: los tres envían tokens nuevos, que se reinician tras cada intento.

Si se habilita en Supabase sin desplegar la site key, los accesos pueden fallar. Con la site key vacía esta app sigue funcionando sin CAPTCHA; no se presenta como protección activa.

## Comprobación después de desplegar

- Usar dos cuentas reales de prueba y verificar lectura, edición, eliminación y fotos propias/ajenas; también una cuenta sin correo confirmado.
- Probar una foto PNG y una JPEG normales, reemplazo y borrado, y rechazos de tamaño/formato. La validación manual del Storage API no se sustituye por pruebas con mocks.
- Probar registro, recuperación y enlace vencido; confirmar que la app instalada sigue entrando.
- Revisar en la respuesta de Netlify que `_headers` se aplica y que no hay violaciones CSP en la consola. Un servidor Python local no aplica esas cabeceras.
- Revisar Supabase Security Advisor, logs de Auth/Storage y consumo. Las cuotas y pruebas SQL no se pueden confirmar solo mirando archivos locales.

## Respaldo e integridad

Antes de cada migración, obtener una copia de la base desde las herramientas disponibles en el proyecto (Dashboard/CLI de Supabase) y una copia separada de los objetos de `beer-photos`. Un dump SQL no contiene los archivos de Storage. Guardar los respaldos fuera de Netlify, del repositorio y de `dist` y probar la restauración en otro proyecto. Los backups automáticos y recuperación disponibles dependen del plan: no se presupone que existan en Free. No se han generado backups remotos desde esta sesión.

Referencias: https://supabase.com/docs/guides/auth/auth-captcha · https://supabase.com/docs/guides/api/securing-your-api · https://docs.netlify.com/manage/security/content-security-policy/

## Catálogo y pendientes

`006-catalog.sql` agrega consultas públicas sobre reseñas compartidas y una lista Por probar por usuario. La tabla de pendientes no tiene permisos directos para clientes; su RPC exige sesión confirmada, determina al dueño desde `auth.uid()` y aplica cuotas. Las reseñas privadas quedan fuera de búsqueda, promedios, opiniones y fotos públicas. Las listas públicas solo muestran fichas con reseñas públicas actuales. Detalles en [CATALOG.md](CATALOG.md).
