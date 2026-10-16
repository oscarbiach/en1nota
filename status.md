# Estado

## Ahora
- El juego está completo y publicado en Render desde `claude/music-recognition-game-5vz0p8` (último cambio de la app: `da3aeef`).
- Hay controles y reglas para agentes en `.claude/` (hooks, subagentes Explore y sonnet-coder, skills `pruebas-app` y `publicar`), `AGENTS.md` y `CLAUDE.md`.

## Pendiente del dueño
- Probar con Spotify real y celulares reales: panel "Verificar" del juez, importar una playlist pública de otra persona y el botón "Puntajes" y el podio en los celulares.
- Responder si quiere la opción "Mezclar al empezar la partida" (hoy la lista se mezcla a mano con el botón Mezclar).
- Pasar la URL de su servicio en Render para que `/publicar` pueda consultar `/healthz`.

## Sin verificar (no marcarlo como comprobado)
- La lectura de playlists públicas contra la página real de Spotify (solo se probó con páginas de ejemplo).
- Audio real, celulares reales y actualización de la PWA entre versiones.

## Publicado
| Fecha | Commit | Qué | Cómo volver atrás |
| --- | --- | --- | --- |
| 2026-10-12 | `da3aeef` | Verificar canción, playlists públicas, puntajes en celulares, textos del reproductor | Render → Events → Rollback, o `git revert` y push |
