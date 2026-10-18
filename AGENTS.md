# Reglas del proyecto

## Contexto indispensable
- En 1 Nota: juego presencial para reconocer canciones con un juez, pulsadores en los celulares y TV opcional. PWA React + Vite + TypeScript; servidor Node (`server/index.js`) que solo reenvía mensajes de la sala. Detalle en `README.md`.
- Producción = el servicio de Render, que despliega solo cada push a `claude/music-recognition-game-5vz0p8` (la rama predeterminada en GitHub). Hacer push es publicar.
- Datos reales: no hay base de datos. La partida vive en el navegador del juez; lo real es la cuenta Spotify Premium del dueño y `ROOM_SECRET` en Render.
- Leé `status.md` al iniciar y confirmá el estado en una línea. Actualizalo al cerrar tareas sustanciales.
- Respondé en español rioplatense, directo y conciso.

## Autonomía y trato con el usuario
- El usuario no es programador: aceptá lenguaje cotidiano y pedidos abstractos, y traducilos a trabajo concreto sin exigir rutas ni comandos. Para lo que tenga que hacer él (Render, GitHub, Spotify), guías paso a paso.
- Distinguí conversar de pedir una implementación; no cambies archivos por una consulta.
- Ante un pedido de acción, completá los cambios locales reversibles sin pedir aprobación de cada paso.
- Preguntá solo si la duda cambia el resultado, las reglas del juego, los costos o el riesgo; agrupá las preguntas en lenguaje simple.
- Después de cambiar código, validá y probá el flujo afectado con las pruebas locales, nunca con producción.
- Cerrá en pocas líneas: qué cambió, qué comprobaste y qué queda pendiente.
- No marques como comprobado lo que no se ejecutó (celulares reales, audio real, Spotify real, actualización de la PWA entre versiones) y no afirmes que la app está libre de errores.

## Comandos
- Validar: `node .claude/scripts/validate.mjs`. Probar: `npm test` (unitarias) y `npm run test:e2e` (navegador, compila antes). Vista previa: `npm run dev`.
- Prueba de fuego: `node .claude/scripts/mutantes.mjs`. Al cambiar un flujo crítico, actualizá su mutante y verificá que las pruebas lo detecten. Mapa de flujos y pruebas: `docs/CALIDAD.md`.

## Restricciones
- Push (publicar), cambios de remotos, rama predeterminada o configuración de Render requieren confirmación del usuario para cada cambio.
- Contra producción solo `GET /healthz`: nada de pruebas de carga ni maliciosas.
- Antes de borrar o reemplazar archivos, dejá copia o commit de respaldo.
- No leas ni muestres credenciales (`ROOM_SECRET`, tokens de Spotify) salvo autorización específica.
- No contrates APIs, servicios ni automatizaciones pagas.

## Decisiones del dueño (no reabrirlas)
- Tararear la canción correcta cuenta como Correcto: no hay opción de tarareo.
- Spotify se usa en privado entre amigos con la cuenta del juez; no se pide a cada usuario crear un Client ID.
- No quitar funciones ni cambiar de proveedor de música sin decisión del dueño.
- Spotify Connect manda la música solo a celulares (`phoneDevices`): nunca a parlantes, compus ni TVs de la cuenta (2026-10-18).

## Reglas del juego en el código
- Las acciones del juez y los toques de los jugadores se aplican una sola vez: el motor (`src/game/engine.ts`) ignora una acción si la fase de la ronda ya cambió, y el servidor ordena los toques por hora de llegada. Al tocar esos flujos, verificá que se mantenga con un doble toque en la prueba.
- Las pruebas nunca usan Spotify real ni producción: Spotify simulado, servidor en 127.0.0.1 y el navegador de pruebas sin salida a internet.

## Rarezas locales
- Las pruebas de Node usan type stripping: imports con extensión `.ts` y sin parameter properties en clases.
- `pkill -f` y `pgrep -f` matan al propio shell: guardá el PID al lanzar un proceso.
- Las pruebas E2E eligen el modo manual con `getByLabel(/Sin reproductor/)`: ese texto de la opción se mantiene.
- Las playlists de otras personas y las vistas previas de 30 s («Vista previa», el modo para iPhone) se leen de la página pública de Spotify (`server/spotify-embed.js`), que no es una vía oficial y puede cambiar.
- En iPhone, Spotify Connect hacia el mismo celular no arranca (la app de Spotify en segundo plano); por eso el modo por defecto en iPhone es «Vista previa».

## Relevo entre sesiones
- Una rama por tarea y un solo agente escribiendo en ella a la vez.
- Guardá en `coordinacion/tareas/<tarea>.md`: objetivo, rama, último commit, cambios, pruebas, bloqueos y siguiente paso.
- Commits chicos tras cada avance validado. Un commit local no publica; subir requiere confirmación salvo autorización para esa tarea.
