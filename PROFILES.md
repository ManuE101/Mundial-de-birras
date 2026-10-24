# Perfiles públicos y visibilidad de reseñas

## Decisiones implementadas

- Un nombre de usuario único por cuenta, sin apodo. Admite de 3 a 40 letras ASCII minúsculas, números y guiones bajos. Se comprueba unicidad en PostgreSQL, no solo en el navegador.
- Todos los perfiles son públicos y tienen foto opcional. El nombre puede cambiarse desde **Mi perfil → Editar mi perfil**. El enlace de perfil usa el nombre actual; al cambiarlo, el enlace anterior deja de encontrar el perfil.
- Se asigna `birrero_<UUID sin guiones>` a cuentas existentes y nuevas hasta que el dueño elija su nombre. No se generan nombres usando el email.
- Las reseñas existentes pasan a públicas una única vez al agregar la columna `is_public`. Las nuevas tienen valor público por defecto. Una segunda ejecución de la migración no vuelve a publicar reseñas que el dueño haya privatizado.
- El selector **Pública / Privada** está en el formulario de carga y edición. El ranking personal muestra la visibilidad. La colección y estadísticas personales siguen incluyendo ambas.
- La comunidad y los perfiles pueden abrirse sin sesión. El perfil muestra foto, nombre, fecha de alta, reseñas públicas, cantidad y promedio público. Cada reseña comparte marca, nombre, estilo, nota, foto, fecha, opinión y recompra. El dato de si se probó borracho queda en la colección personal; no se devuelve por la API pública. El email nunca se publica.
- Todavía no se implementan catálogo común, puntaje global por cerveza ni escáner: se discutirán por separado.

## Aplicar antes de publicar

1. Confirmar que ya se ejecutaron las migraciones 002, 003 y 004.
2. Respaldar la base y los archivos según `SECURITY.md`.
3. Ejecutar `supabase/005-public-profiles.sql` completo en SQL Editor. **Este paso hace consultables públicamente las reseñas existentes**, por la decisión explícita del producto, aun antes de actualizar el frontend.
4. Ejecutar `supabase/public-profiles-check.sql`. Debe terminar con el mensaje de pruebas completadas y datos ficticios revertidos. Ante error, ejecutar `ROLLBACK;` antes de reintentar.
5. Ejecutar `npm run prepare:deploy` y subir `dist` al proyecto Netlify existente. No requiere modificar URLs, Turnstile ni sus claves.
6. Entrar con tu cuenta, abrir **Mi perfil** y elegir el nombre. Podés agregar una foto o dejarlo sin imagen.

Para una instalación totalmente nueva aplicar `setup.sql`, luego 004 y 005. El esquema inicial ya contiene los campos de 002/003.

## Consultas y permisos

La tabla `beers` permanece accesible solo al dueño mediante RLS. No se habilita `SELECT *` anónimo ni lectura de columnas privadas por otros usuarios. La tabla `profiles` solo permite consultar el propio registro y modificar el propio nombre/foto desde el cliente autenticado; no permite crear o borrar perfiles directamente.

Las funciones públicas `birras_public_profile` y `birras_public_profiles` son `SECURITY DEFINER` intencionalmente y tienen `search_path` vacío, consultas fijas, proyección de campos y páginas de hasta 20 registros. No aceptan SQL ni seleccionan emails. Los promedios se calculan con todas las reseñas públicas del perfil; la lista se pagina de a 20.

El bucket sigue privado. Una política específica permite firmar/leer únicamente las imágenes referenciadas por reseñas públicas o avatares públicos, además de las propias. Las demás políticas siguen impidiendo subir, mover, sobrescribir o borrar fotos de otro dueño. Se conservan límites de tamaño y cuotas de 004; las fotos de perfil consumen el mismo presupuesto de imágenes.

## Qué implica pasar a privada

Al guardar el cambio, las nuevas consultas públicas ya no incluyen la reseña ni su nota en los promedios. Las fotos que ya no estén referenciadas por otra reseña pública o avatar tampoco admiten nuevas lecturas públicas. Las páginas abiertas se actualizan al regresar a la pestaña y cada 30 segundos.

No se puede retirar una captura, un archivo ya descargado ni los datos que otra persona ya leyó. Los enlaces firmados emitidos anteriormente duran hasta cinco minutos, y un navegador puede conservar una imagen descargada. No se promete revocación instantánea de copias o URLs ya emitidas.

## Verificación

`npm test` ejecuta tests de frontend, guardado y PostgreSQL embebido. Incluye migración de reseñas existentes, idempotencia, visibilidad pública/privada, exclusión de datos privados, revocación de acceso a fotos privadas y cambios de perfil exclusivos del dueño. `tests/community.test.cjs` prueba rutas públicas sin sesión y escape de contenido de usuario con un DOM simulado.

Después de publicar, probar en un navegador real y una ventana privada:

- Ver un perfil sin iniciar sesión y abrir Comunidad.
- Crear/editar nombre y foto, comprobar un nombre repetido y quitar la foto.
- Cargar una reseña pública y otra privada; solo la pública aparece fuera de la cuenta.
- Volver privada una reseña pública: desaparece del perfil y cambia su promedio al recargar.
- Volver a compartirla, verificar que reaparece.
- Confirmar que la ficha personal conserva el dato borracho/no, y que no aparece en el perfil público.
