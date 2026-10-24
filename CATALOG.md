# Catálogo y Por probar

## Publicar esta versión

1. Ejecutar completo `supabase/006-catalog.sql` en el SQL Editor del mismo proyecto, después de 005. No vuelve a publicar reseñas privadas ni modifica puntuaciones.
2. Ejecutar `npm test` y `npm run prepare:deploy` y subir la carpeta `dist` a Netlify. La carpeta ya queda preparada desde esta implementación; el SQL se aplica manualmente.
3. Probar con dos cuentas y una ventana sin sesión: buscar, abrir una ficha, guardar en Por probar, cargar esa misma birra y cambiar la visibilidad de una reseña.

## Reglas

- Catálogo público en `#/catalogo`, ficha compartible en `#/birra/<clave>`. Solo se alimenta de reseñas públicas existentes; no permite crear ni puntuar desde allí.
- Una misma marca y nombre comparten ficha, ignorando mayúsculas, acentos y espacios repetidos. Lata y botella comparten puntaje. Nombres o marcas escritos de otra manera no se fusionan por suposición.
- Búsqueda por fragmentos en marca, nombre, estilo, opiniones, usuario, fecha, puntuación y respuesta de recompra públicos. Todas las palabras deben encontrarse, incluso en campos distintos. No incluye el estado de ebriedad ni datos privados. No corrige errores de escritura automáticamente.
- Promedio de todas las reseñas públicas de la ficha, una por usuario gracias a la restricción existente. El porcentaje de recompra considera solo respuestas sí/no.
- Por probar es público, accesible desde el perfil. Requiere sesión confirmada para modificarlo. Al cargar una reseña propia se elimina automáticamente de pendientes, aunque la reseña sea privada. No se vuelve a agregar al borrar esa reseña.
- Si la última reseña pública desaparece, la ficha y sus apariciones en Por probar dejan de mostrarse. Los pendientes se conservan internamente por si la birra vuelve a tener reseñas públicas.
- Lista limitada a 1000 pendientes por usuario, con cuotas de 30 modificaciones por minuto y 300 por día. Las lecturas se paginan de a 20.

## Seguridad y alcance

006 mantiene las tablas de reseñas privadas y expone proyecciones mediante RPC con consultas fijas y `search_path` vacío. La tabla de pendientes no acepta acceso directo del cliente; la escritura determina al dueño desde la sesión y no recibe otro usuario. Las claves no otorgan acceso a reseñas o fotos privadas. La visibilidad y duración de URLs firmadas siguen lo documentado en `PROFILES.md`.

Los tests de PostgreSQL embebido verifican agrupación, búsqueda, promedios, anonimato, permisos, aislamiento entre listas y cambios de visibilidad. Los tests del cliente utilizan un DOM simulado: falta verificar el despliegue real en el navegador y Supabase.

La búsqueda agrega las reseñas públicas al consultar; es adecuada para comenzar. Si crece el uso, medir consultas antes de añadir índices de búsqueda o agregados persistentes. El escaneo de etiquetas queda para la siguiente etapa: buscará coincidencias sobre este mismo catálogo, sin crear cervezas automáticamente.
