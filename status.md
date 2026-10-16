# Estado

## Ahora
- El juego está completo y publicado en Render desde `claude/music-recognition-game-5vz0p8` (último cambio de la app: `09a9694`).
- Codex sumó el 2026-10-13 cola de turnos, modos Solitario y 1 contra 1, y el diseño nuevo (`8e76dc6`, detalle y respaldo en `docs/CAMBIOS-2026-10-13.md`).
- La lista se mezcla al empezar cada partida (opción en Reglas, activada de entrada).
- Hay controles y reglas para agentes en `.claude/` (hooks, subagentes Explore y sonnet-coder, skills `pruebas-app` y `publicar`), `AGENTS.md` y `CLAUDE.md`.

## Pendiente del dueño
- Probar con Spotify real y celulares reales: los modos nuevos, la mezcla al empezar, el panel "Verificar" del juez, importar una playlist pública de otra persona y el botón "Puntajes" y el podio en los celulares.
- Pasar la URL de su servicio en Render para que `/publicar` pueda consultar `/healthz`.

## Sin verificar (no marcarlo como comprobado)
- La lectura de playlists públicas contra la página real de Spotify (solo se probó con páginas de ejemplo).
- Audio real, celulares reales y actualización de la PWA entre versiones.

## Publicado
| Fecha | Commit | Qué | Cómo volver atrás |
| --- | --- | --- | --- |
| 2026-10-16 | `09a9694` | Mezclar la lista al empezar; reglas y controles para agentes | Render → Events → Rollback al despliegue de `8e76dc6`, o `git revert` de los commits nuevos y push |
| 2026-10-13 | `8e76dc6` | Cola de turnos, Solitario, 1 contra 1 y diseño nuevo (Codex) | Ver `docs/CAMBIOS-2026-10-13.md` |
| 2026-10-12 | `da3aeef` | Verificar canción, playlists públicas, puntajes en celulares, textos del reproductor | Render → Events → Rollback, o `git revert` y push |
