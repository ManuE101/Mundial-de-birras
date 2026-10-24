# Mundial de birras

## Campos obligatorios y opcionales

Obligatorios: marca, nombre de la cerveza y puntaje de 0 a 10. El puntaje se ingresa explícitamente, sin un valor precargado; cero es válido. Foto, estilo, fecha, estado, recompra y notas son opcionales. **Otro** no exige escribir un estilo. La fecha propone hoy al crear, pero puede borrarse; al editar se conserva una fecha vacía. Marca + nombre siguen identificando duplicados, independientemente del estilo.

Antes de publicar esta actualización ejecutar `supabase/003-optional-fields.sql` en SQL Editor. Solo quita NOT NULL a `photo_path` y `date`. El ranking y la ficha muestran estados sin foto ni fecha, y las operaciones de Storage omiten registros sin imagen. Los datos existentes se conservan.

## Últimos cambios antes de publicar

Ejecutar en Supabase SQL Editor el contenido de `supabase/002-buy-again.sql` para agregar únicamente `buy_again` (boolean nullable). No hay archivado ni recuperación de eliminaciones. Los registros anteriores quedan como **Sin indicar**. No volver a ejecutar todo `setup.sql` sobre el proyecto existente para esta actualización.

El formulario permite indicar **¿La volverías a comprar?** con Sí, No o Sin indicar. La respuesta se muestra en la ficha y en el ranking cuando está definida. Al escribir marca y nombre se advierte si la cerveza ya existe, ignorando mayúsculas, acentos y espacios adicionales. Se puede pasar a editar la existente confirmando que se descartan los datos de la carga en curso.

Eliminar exige confirmación y avisa que la acción no puede deshacerse. Solo después de confirmar se elimina el registro y se solicita borrar su foto. Si falla la eliminación del registro, la birra sigue en pantalla.

Bitácora personal de cervezas: foto, marca, variedad, estilo, fecha, notas y puntaje de 0 a 10. Clasificación con posiciones compartidas en empates, búsqueda, ordenamiento, edición y eliminación. Evita duplicados por marca + variedad, ignorando mayúsculas, acentos y espacios adicionales.

## Ejecutar

Desde esta carpeta, con Python instalado:

```powershell
python -m http.server 5173
```

Abrí http://localhost:5173 en el navegador. También se puede servir con cualquier servidor de archivos estáticos, sin compilación ni dependencias de JavaScript.

## Datos

La exportación y la copia de birras locales están ocultas temporalmente en la interfaz. Se conserva su código para volver a habilitarlas más adelante; no se borran datos existentes. No hay importación de JSON.

Las fotos se reducen a un máximo de 1200 píxeles y los registros se guardan en IndexedDB, en el navegador y origen usados. Exportar respaldo descarga un JSON con registros y fotos. Sin configurar Supabase se usa el modo local. La configuración remota y la copia de la colección se describen abajo. Borrar los datos del navegador borra la colección local. No incluye cervezas ficticias.

La interfaz usa Georgia y Arial del sistema, sin descargas de fuentes externas. Su identidad visual toma referencias de un cuaderno: papel cálido, tinta oscura, acentos rojo ladrillo, ilustración lineal propia y fotos con borde de papel. El diseño adapta acceso, ranking y formulario al celular.

## Preparación de Supabase (paso 2)

En un proyecto nuevo, abrir **SQL Editor → New query**, pegar el contenido completo de `supabase/setup.sql` y ejecutar **Run**. La última consulta debe devolver `rls_enabled = true` y `photos_public = false`.

Esto crea `public.beers`, valida puntuaciones de 0 a 10, evita marca + variedad repetidas por usuario y crea el bucket privado `beer-photos`. Las políticas restringen registros y fotos a su usuario autenticado. No ejecutar sobre una tabla `beers` de otra aplicación: el script está preparado para este proyecto.

### Conectar la app (paso 3)

En `config.js`, completar `supabaseUrl` con la Project URL y `supabasePublishableKey` con la clave pública publishable (o la legacy anon). Se encuentran en el diálogo **Connect** del proyecto o en su configuración de API. Nunca usar `service_role`, claves `sb_secret_` ni la contraseña de la base de datos. Los dos valores públicos se distribuyen con el sitio; la privacidad depende de las políticas del SQL.

Con los valores vacíos se conserva el modo local. Con ambos configurados se activa el inicio de sesión y la colección remota: no se usa la copia local como reemplazo si falla la nube. La cuenta de la app es independiente de la cuenta del panel de Supabase. Crear la cuenta desde la app, confirmar el email e iniciar sesión. Configurar en **Authentication → URL Configuration** la Site URL `http://localhost:5173` para probar; reemplazarla por la dirección publicada al desplegar. Los enlaces de confirmación deben estar autorizados en Redirect URLs.

Una vez dentro, **Subir mis birras locales a esta cuenta** copia los registros de IndexedDB del navegador y origen actuales, sin borrar el original. Omite marca + variedad repetidas y permite reintentar después de un error. Hacer esta copia desde el mismo navegador y `http://localhost:5173` donde se cargaron las birras, antes de pasar al sitio publicado. Después iniciar sesión con la misma cuenta desde el celular. El respaldo remoto descarga las fotos reales, no enlaces que vencen. Todavía no hay importación de archivos JSON.

Las fotos se guardan en un bucket privado y se muestran con enlaces temporales. La colección se vuelve a consultar al regresar a la pestaña y periódicamente; no incluye actualizaciones en tiempo real. El uso remoto requiere conexión a internet y el SDK se carga desde jsDelivr.

Pruebas de persistencia con un cliente simulado: `node --test tests/cloud.test.cjs`. No sustituyen las pruebas reales de acceso, registro, carga de fotos y aislamiento entre usuarios en el proyecto Supabase.

## Publicar en Netlify (paso 4)

Ejecutar `node scripts/prepare-deploy.cjs` para copiar los cinco archivos de la aplicación a `dist/`. Iniciar sesión en Netlify y arrastrar **esa carpeta** a https://app.netlify.com/drop. No subir la carpeta completa del proyecto. Si se cambia el código o la configuración, ejecutar nuevamente el comando y subir `dist/` en la sección Deploys del mismo proyecto Netlify.

Una vez obtenida la dirección `https://<nombre>.netlify.app`, configurar en Supabase **Authentication → URL Configuration** esa dirección como **Site URL** y añadirla también a **Redirect URLs**. Conservar `http://localhost:5173` como redirect adicional si se seguirá probando localmente. Si se cambia el nombre del sitio Netlify, actualizar las URLs en Supabase.

Abrir la dirección publicada desde el celular e iniciar sesión con la misma cuenta de la app. La colección de Supabase debe aparecer sin importar el dispositivo. La publicación se hace manualmente: generar `dist/` no sube archivos ni crea un sitio.

## Recuperar contraseña

En el acceso, elegir **Olvidé mi contraseña**, ingresar el email y solicitar el enlace. El enlace vuelve a la raíz del sitio actual, que debe estar autorizada en **Authentication → URL Configuration → Redirect URLs**. Para producción usar `https://magnificent-starship-900076.netlify.app` también como **Site URL**. No se requieren cambios en el SQL.

La app procesa el evento `PASSWORD_RECOVERY` incluso si el usuario ya estaba conectado, muestra un formulario con confirmación de contraseña y exige al menos 8 caracteres (Supabase puede imponer reglas adicionales). El formulario permanece disponible al recargar la misma pestaña durante la recuperación. Al guardar se limpia el estado de recuperación y se muestra la colección. Los errores de envío, enlaces vencidos y fallas al guardar tienen mensajes para reintentar. No se revela si un email tiene cuenta.

Verificación manual tras publicar: cerrar sesión, solicitar el enlace con el email de tu cuenta, abrir el correo, ingresar dos contraseñas coincidentes, guardar, cerrar sesión e iniciar con la nueva. Verificar también contraseñas diferentes y un enlace vencido. Las pruebas automáticas usan un cliente simulado y no envían correos ni modifican cuentas reales.

## Pantalla de acceso

## Estilos y filtros

## Ficha de cerveza

## Estadísticas

## Instalación en el celular

El manifiesto permite abrir la app en modo standalone con la imagen original `assets/icono.png`. `assets/app-icon.svg` es un contenedor escalable de la misma imagen, sin modificar ni recortar el original. El encabezado conserva solo el título. La aplicación ofrece **Instalar en el celu** en el pie; usa el diálogo nativo cuando está disponible y ofrece instrucciones para Android/Chrome e iPhone/Safari en caso contrario.

Se necesita HTTPS (Netlify lo proporciona) o localhost. El aviso de conexión se muestra cuando el navegador detecta que no hay red. El service worker guarda únicamente `offline.html`: no almacena registros, fotos, tokens ni respuestas de Supabase. Las navegaciones se intentan primero por red y, si fallan, muestran la página sin conexión. No hay carga de birras ni consulta de la colección sin internet.

Tras publicar este bloque, probar ficha y edición, estadísticas, recuperación de contraseña e instalación en un celular real. Abrir desde el ícono, iniciar con la misma cuenta y comprobar que aparecen las birras. Si el enlace está dentro de WhatsApp, abrirlo en Chrome o Safari antes de instalar. Para las pruebas automáticas: `node --test tests/access.test.cjs tests/cloud.test.cjs tests/pwa.test.cjs`.

**Mis números**, debajo del ranking, muestra promedios y cantidades por estilo, marcas más probadas, marcas con mejor promedio y una comparación por estado de degustación. Siempre usa la colección completa, agrupa nombres equivalentes y muestra los promedios sobre una escala de 0 a 10. Sin datos se muestra un guion, no un cero. La comparación de estados no atribuye diferencias al alcohol porque se trata de cervezas distintas. Solo las fichas marcadas explícitamente como borracho incluyen un comentario humorístico; no altera la puntuación.

Tocar una fila, la foto o el nombre abre una ficha con imagen sin recortar, marca, variedad, estilo, puntaje, puesto general (incluidos empates), fecha, estado y notas. El nombre es un botón accesible con teclado. Se cierra con X o Escape, manteniendo los filtros y la posición de la lista. Editar birra abre el formulario existente. Las notas siguen visibles en el ranking y los registros no cambian al abrir la ficha. Las recargas automáticas esperan mientras la ficha está abierta.

Al cargar o editar, el selector ofrece Rubia / Lager, Pilsen, Golden, IPA, Session IPA, APA, Roja, Scotch, Honey, Porter y Stout. Es una selección de estilos habituales, no un ranking nacional de ventas. **Otro** habilita un campo obligatorio de hasta 80 caracteres. Los registros previos con estilos personalizados se conservan al editar y no requieren migración SQL.

El ranking permite combinar búsqueda, estilo y estado de degustación, incluido Sin indicar. Los estilos del filtro se obtienen de la colección y se agrupan ignorando mayúsculas, acentos y espacios adicionales. Limpiar filtros restablece búsqueda y filtros, conservando el orden seleccionado. Las posiciones, promedio y puntera siempre corresponden a la colección completa.

El contenido de la app comienza oculto en HTML. En modo Supabase se muestra después de iniciar sesión y cargar la colección correctamente. Al cerrar sesión o entrar a recuperar contraseña se oculta y se limpian los registros de la vista. Se mantiene la misma URL, por lo que no se requieren rutas ni redirects nuevos en Netlify o Supabase. Esta separación de pantallas es visual: la autorización de registros y fotos sigue dependiendo de RLS en Supabase, no de ocultar HTML.

Comprobar el acceso y la persistencia con `node --test tests/access.test.cjs tests/cloud.test.cjs`.

Cada degustación permite indicar si la probaste borracho: Sí, No o Sin indicar. Se muestra en la clasificación y se incluye en el respaldo. Los registros anteriores quedan sin indicar hasta que se editen. El estado no modifica el puntaje ni permite repetir una cerveza.

Los nombres anteriores se traducen al mostrar, filtrar y editar: Lager a Rubia / Lager, Pilsner a Pilsen, Golden Ale a Golden, Amber Lager e Irish Red Ale a Roja, y Scotch Ale a Scotch. Los registros guardados se conservan; al editar y guardar se usa el nombre nuevo.
