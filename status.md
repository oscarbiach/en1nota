# Estado

## Ahora
- El juego está completo y publicado en Render desde `claude/music-recognition-game-5vz0p8` (último cambio de la app: `e2d3a81`).
- La lista se mezcla al empezar cada partida (opción en Reglas, activada de entrada).
- Hay controles y reglas para agentes en `.claude/` (hooks, subagentes Explore y sonnet-coder, skills `pruebas-app` y `publicar`), `AGENTS.md` y `CLAUDE.md`.

## Pendiente del dueño
- Probar con Spotify real y celulares reales: panel "Verificar" del juez, importar una playlist pública de otra persona y el botón "Puntajes" y el podio en los celulares.
- Pasar la URL de su servicio en Render para que `/publicar` pueda consultar `/healthz`.

## Sin verificar (no marcarlo como comprobado)
- La lectura de playlists públicas contra la página real de Spotify (solo se probó con páginas de ejemplo).
- Audio real, celulares reales y actualización de la PWA entre versiones.

## Publicado
| Fecha | Commit | Qué | Cómo volver atrás |
| --- | --- | --- | --- |
| 2026-10-16 | `e2d3a81` | Mezclar la lista al empezar; reglas y controles para agentes | Render → Events → Rollback a `da3aeef`, o `git revert` y push |
| 2026-10-12 | `da3aeef` | Verificar canción, playlists públicas, puntajes en celulares, textos del reproductor | Render → Events → Rollback, o `git revert` y push |
