# Calidad: flujos críticos y cómo se prueban

Aplicación de la guía «Mapa de flujos críticos y estrategia de testing» a En 1 Nota (2026-10-17). El juego no tiene carrito, precios, base de datos ni migraciones: esas partes de la guía se adaptaron a lo que sí existe, o se explica por qué no aplican.

## Flujos que no pueden fallar

| Flujo | Riesgo | Pruebas |
| --- | --- | --- |
| Sesión de Spotify | token vencido, sesión perdida por un corte, sesión rota por una respuesta rara | `test/spotify-auth.test.ts`: renovación, sin red, 5xx/429, `invalid_grant` cierra, respuesta sin token no guarda nada |
| Puntaje y turnos (equivale a «precios») | el más rápido no gana, doble Correcto suma dos veces, bloqueados que tocan, puntos por pasada | `test/engine.test.ts`, `test/queue-modes.test.ts`: casos límite de cola, empates, bloqueos, doble toque, pasadas sin puntos propios |
| Orden de los toques | un celular adelanta su hora para ganar | `test/server.test.js`: el servidor sella la hora de llegada e ignora la del celular |
| Sala y credenciales | colarse en una sala ajena, inundar de mensajes | `test/server-security.test.js`, `test/server-limits.test.js` |
| Título oculto | la TV o los celulares ven la canción antes de revelar | `test/engine.test.ts` (`toPublic`), `test/e2e/flow.mjs` |
| Persistencia (equivale a «sincronización») | perder la partida al recargar, datos rotos que bloquean la app, versión futura | `test/store.test.ts`: cuarentena, migración de partidas viejas, versiones futuras; `test/e2e/restart.test.mjs` |
| Reproductor | el panel queda trabado si Spotify no contesta; la música va a otro aparato (un parlante de la casa); el aparato acepta la orden pero no suena (iPhone con Spotify dormido, o cortado por el audio de la página) | `test/sdk-player.test.ts`, `test/spotify-api.test.ts`, `test/connect-player.test.ts`, `test/sfx.test.ts`, `test/preview-player.test.ts`, E2E «Reactivar destraba el panel» y «suena en el aparato que elige el juez» |
| Partida de punta a punta (equivale a «checkout») | juez, celulares y TV no coinciden | `test/e2e/*.test.mjs` y `flow.mjs`, con Spotify simulado y navegador sin internet |

## Datos que entran desde afuera

Ningún dato externo se usa sin revisarlo. En vez de Zod, que sumaría una dependencia, se usan validadores propios:

- Mensajes entre aparatos: `src/net/validate.ts` (`parsePeerMsg`, `parseHostMsg`) y la validación del servidor.
- Lo guardado en el navegador: `src/storage/schema.ts` (versión, cuarentena).
- Respuestas de Spotify: `isSong` y revisión de playlists nulas en `src/spotify/api.ts`; token en `src/spotify/auth.ts`.
- Playlist pública: `server/spotify-embed.js` en el servidor y otra revisión en `publicPlaylist` del lado del juego.

## Deuda técnica

- Importaciones circulares: `npx madge --circular --extensions ts,tsx src/` → ninguna. Se corrigieron 11, una de ellas real en tiempo de ejecución: las pantallas importaban `navigate` de `App`. Ahora `navigate` vive en `src/router.ts`, los tipos del juez en `src/views/hostCtx.ts` y los del reproductor en `src/spotify/snippet.ts`.
- Código duplicado: `npx jscpd src/ server/` → 0 bloques de 6 líneas o más. Con un umbral de 3 líneas aparecen 3 bloques chicos (0,2 %): no vale la pena unirlos.
- No hay linter configurado: el control de tipos (`tsc` estricto) cubre la mayor parte. Sumar ESLint queda como decisión del dueño.

## Migraciones

No hay base de datos. Lo más parecido es el formato guardado en el navegador: tiene número de versión (`SCHEMA_VERSION`), los campos nuevos tienen un valor por defecto para partidas viejas (por ejemplo, `shuffleOnStart`) y lo que no se entiende se aparta en cuarentena en vez de borrarse.

## Control automático (GitHub Actions)

`.github/workflows/ci.yml` corre en cada push y pull request: validación rápida, pruebas unitarias con cobertura (`npm run test:coverage`), compilación y pruebas en navegador. Hoy marca el commit en rojo si algo falla, pero **no frena la publicación**: Render publica cada push. Frenarla requiere cambiar la configuración de Render, y eso lo decide el dueño.

La compilación de Render (`Dockerfile` → `npm run build`) ya incluye `tsc --noEmit`: un error de tipos hace fallar el despliegue y Render sigue sirviendo la versión anterior.

## Prueba de fuego (mutaciones)

`node .claude/scripts/mutantes.mjs` rompe a propósito 21 puntos de los flujos críticos, uno por vez, corre las pruebas unitarias y restaura cada archivo. Resultado del 2026-10-18: las 21 roturas se detectan.

La primera pasada encontró 4 sin detectar y se agregaron sus pruebas:

- doble Correcto;
- puntos con menos valores que pasadas;
- hora del celular ignorada por el servidor;
- partida de la versión siguiente.

Al cambiar uno de esos flujos, actualizá su línea en el script.

Cobertura de las pruebas unitarias: 92,8 % de líneas de los archivos que ejercitan. Las pantallas (`src/views`) las cubren las pruebas en navegador, no la cobertura.

## Lo que estas pruebas no comprueban

- Spotify real con una cuenta Premium.
- Celulares reales y audio real.
- La página pública real de Spotify.
- La actualización de la PWA entre versiones.
