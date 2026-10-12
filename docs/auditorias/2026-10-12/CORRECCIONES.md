# Correcciones de la segunda auditoría

Sobre `claude/music-recognition-game-5vz0p8`, partiendo del commit auditado
`08bd726`. No hubo cambios entre ese commit y el paquete de auditoría
(`eacba3e` sólo agrega documentación). Un commit por bloque.

Todas las pruebas son locales y simuladas: servidores efímeros, sockets y
relojes simulados, storage simulado, y en el navegador **música manual**.
**Ninguna usa Spotify real**, dispositivos físicos ni carga.

## Por bloque

| ID | Estado | Cambio | Prueba | Resultado |
|---|---|---|---|---|
| B09 | Corregido | Claves de juez y secretos de celular firmados (HMAC con `ROOM_SECRET`): tras un reinicio, el juez recupera el mismo código y cada celular su puesto; credenciales falsas siguen rechazadas. Sin `ROOM_SECRET`: código nuevo avisado en rojo, el celular entra con él y el juez confirma quién es ("Es Ana", "Jugador nuevo", "Rechazar") conservando puntaje, bloqueos e historial. | `test/server-restart.test.js` (5), B09 en `test/engine.test.ts` (3) y `test/server-security.test.js`, `test/e2e/restart.test.mjs` (2, reinicio real del proceso) | Fallaban 4/5 de servidor antes; todas pasan |
| B02 | Corregido | El orden de pulsación lo decide la hora de llegada al servidor; la hora que declara el celular se ignora. | `test/host-connection.test.ts` (2), E2E "B02" | Antes ganaba "Segundo"; ahora "Primero" |
| B03 | Corregido | Inicio del fragmento y pulsaciones de mesa usan el reloj del servidor sincronizado por el juez, la misma base que los celulares. | E2E "B03" con reloj del juez ±5 s | Antes 0 ms y 5341 ms; ahora la reacción real (300–2500 ms) |
| B04 | Corregido | Guardar devuelve si funcionó y avisa; cartel con "Descargar respaldo" (incluye la partida en memoria, nunca credenciales) y "Liberar espacio". La lista que no se guardó no aparece como guardada. | `test/store.test.ts` (5), E2E "B04" con cuota simulada y descarga real | Pasa |
| B06 | Corregido | Validación y versión del esquema guardado; migración de la versión 0; lo irrecuperable se aparta a `en1nota.quarantine.*` y se informa, sin tocar listas ni historial válidos. La pantalla de error permite apartar sólo la partida. | `test/store.test.ts` (6), E2E "B06" con `{}` | Antes bucle de error; ahora recupera y avisa |
| B07 | Corregido | Zoom permitido; `touch-action: manipulation` en botones. axe-core (WCAG 2.1 A/AA) en todas las pantallas: contraste de botones (3,57→4,95:1), etiquetas de campos y selectores, nombre del pulsador, píldoras de la TV, `prefers-reduced-motion`. Reflujo a 320 px. | `test/e2e/a11y.test.mjs` (5) | 0 violaciones automáticas |
| Recursos | Corregido | Máximos de salas, conexiones e identidades por sala; límite de frecuencia por conexión; limpieza de identidades inactivas; métricas en `/healthz`. | `test/server-limits.test.js` (7) | Pasa; sin prueba de carga |
| B01 | Corregido | La espera del SDK sólo acepta un evento nuevo, no pausado, del tema pedido (o su reemplazo regional `linked_from`) cerca de la posición pedida; cancelar o vencer retira el listener. | `test/sdk-player.test.ts` (5; incluye el caso exacto de la auditoría) | Pasa; SDK simulado |
| B05 | Corregido | La importación conserva sólo canciones; episodios, locales, retirados y repetidos se omiten y se cuentan, y el editor lo informa. | `test/spotify-api.test.ts` (2) | Antes `reading 'map'`; ahora importa 3 y omite 4 |
| B08 | Corregido | Sólo un rechazo de credenciales (400/401) cierra la sesión; sin red, 5xx o 429 conservan el refresh token. | `test/spotify-auth.test.ts` (4) | Antes borraba la sesión; ahora la conserva |

Defectos adicionales encontrados al escribir las pruebas, ya corregidos:

- Al cambiar de sala, el pulsador conservaba la identidad de la sala anterior
  y mostraba el puntaje de otro jugador sin que el juez lo confirmara.
- Dos copias de diagnóstico creadas en el mismo milisegundo se pisaban.

## Verificación final

- Tipos y compilación de producción: aprobados.
- Pruebas sin navegador: 87 aprobadas (las 47 anteriores incluidas).
- E2E: partida completa original + 28 aprobadas (las 16 anteriores incluidas).
- `npm audit` completo: 0.

## Pendiente

- **Spotify:** el dueño decidió conservar la integración para uso privado
  entre amigos, y se corrigieron B01, B05 y B08. La política de Spotify
  prohíbe juegos y trivias sin distinguir uso privado: el riesgo es que
  Spotify revoque el acceso de la app. No es base para publicar el juego.
- **`ROOM_SECRET`:** declarado en `render.yaml` con `generateValue`. Se aplica
  si el servicio de Render sincroniza el Blueprint; si no, hay que agregarlo
  a mano. No se verificó en Render.
- **R01:** la rama predeterminada sigue siendo la de investigación; la
  propuesta está en el README. No se cambiaron remotos ni despliegue.
- **Sin probar:** Spotify real, iPhone/Android físicos, lectores de pantalla,
  migración de la PWA entre versiones publicadas, carga y redes con pérdidas.
  La reacción se mide desde la orden "Sonar", no desde el audio audible.
