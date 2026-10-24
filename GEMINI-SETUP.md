# Prueba de reconocimiento con Gemini

## 1. Preparar la cuota

Ejecutar completo `supabase/007-scan-budget.sql` después de las migraciones anteriores. No modifica cervezas ni perfiles. Límite inicial: 2 solicitudes por minuto y 5 por día por cuenta, más 20 por día entre todas las cuentas. El día se cuenta en UTC. Los intentos que llegan al proveedor consumen cuota aunque la identificación falle; no se reintentan automáticamente. Un cambio posterior de SQL puede ajustar esos límites.

## 2. Crear la clave privada

En https://aistudio.google.com/apikey crear una clave para un proyecto con acceso al nivel gratuito de Gemini API. Revisar en Google AI Studio que el proyecto y `gemini-3.5-flash-lite` tengan acceso y cuota disponibles. No es la suscripción de la app Gemini: es acceso a la API. No activar facturación para esta prueba. No compartir la clave por chat ni pegarla en config.js.

En Supabase → Edge Functions → Secrets agregar:

| Nombre | Valor |
| --- | --- |
| `GEMINI_API_KEY` | La clave privada creada en Google |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `SCAN_ALLOWED_ORIGINS` | `https://puntajedebirras.netlify.app` |

La función usa `SUPABASE_URL` y las claves públicas de `SUPABASE_PUBLISHABLE_KEYS`, con compatibilidad para `SUPABASE_ANON_KEY` en proyectos antiguos. Son variables internas que provee Supabase a las funciones. No se usa service_role. Para probar otra URL, agregarla separada por coma en SCAN_ALLOWED_ORIGINS.

## 3. Publicar la función

La función se llama exactamente `recognize-beer`. En el editor de Edge Functions del Dashboard, crear una función con los dos archivos de `supabase/functions/recognize-beer/`: `index.ts` y `handler.mjs`, conservando nombres y contenido. Desplegar y desactivar **Verify JWT with legacy secret** para esa función: el código valida explícitamente cada token contra `/auth/v1/user` antes de procesar la foto, comprueba correo confirmado y obtiene la cuota con ese mismo token. No es un endpoint de acceso anónimo.

Alternativamente, con Supabase CLI instalada y sesión iniciada, desde el proyecto:

```powershell
supabase functions deploy recognize-beer --project-ref dgqgpspogknmonlzlfdt --no-verify-jwt
```

El archivo `supabase/config.toml` documenta la misma configuración. No introducir tokens ni claves privadas como argumentos de shell.

## 4. Publicar y probar la app

Con SQL, secretos y función listos, subir `dist` completa a Netlify. Ya se prepara con `node scripts/prepare-deploy.cjs`. En Catálogo → Buscar por foto elegir **Reconocimiento con Google (prueba)**, iniciar sesión y tomar o elegir una foto. La app reduce y vuelve a codificar la imagen como JPEG sin los metadatos originales, la envía a Supabase y la función la envía a Google. No se guarda en Storage. La pantalla avisa del envío y de las condiciones del nivel gratuito antes de elegir la foto.

Se devuelve marca, nombre/variedad y estilo. La búsqueda usa marca y nombre, permitiendo corregirlos, sin crear fichas. Un estilo incierto no bloquea la búsqueda. Si no reconoce nada, se permite buscar manualmente. El selector conserva **Leer texto en mi dispositivo** como alternativa local; no se envía una foto a Google automáticamente al fallar ese modo.

Para la lata de ejemplo, comprobar si devuelve Brahma y Pomelo. Esa precisión todavía no se verificó con una API real. Probar además una etiqueta inexistente en el catálogo, otra ilegible y el límite de intentos. Una búsqueda sin coincidencias no implica que no reconoció la etiqueta: puede faltar esa cerveza entre las reseñas públicas.

## Seguridad y límites de la prueba

- La foto sale del dispositivo únicamente en el modo Google. El proveedor gratuito puede usar contenido para mejorar sus productos; la app no garantiza borrado ni retención por parte de Google.
- Se valida sesión en Auth, email confirmado, origen web, método, formato, tamaño y cuota persistente antes de llamar al modelo. CORS no sustituye la autenticación.
- Máximo 1 MB de JPEG enviado, cuerpo limitado también durante la lectura, tiempos de espera y salida JSON con campos y longitudes limitados. No se aceptan URLs ni modelos proporcionados por el cliente.
- Clave solo en secretos del servidor, enviada al proveedor por cabecera. No se registran fotos, texto reconocido, tokens o claves en logs propios. Google y Supabase tienen sus propias políticas de tratamiento de datos.
- Los usuarios autenticados pueden consumir su cuota; el límite global puede agotarse. Los cupos locales no aumentan los que Google permita y no garantizan costo cero si el proyecto de Google se cambia a facturación paga.
- No se usaron credenciales ni se hicieron llamadas reales al proveedor durante esta implementación. Los tests del handler usan respuestas simuladas y PostgreSQL embebido. Falta desplegar y verificar con el servicio real.

Documentación oficial consultada: [imágenes](https://ai.google.dev/gemini-api/docs/image-understanding), [salidas estructuradas](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), [precios y condiciones](https://ai.google.dev/gemini-api/docs/pricing), [secretos de Supabase](https://supabase.com/docs/guides/functions/secrets).
