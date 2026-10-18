# Estado

## Ahora
- El juego está completo y publicado en Render desde `claude/music-recognition-game-5vz0p8` (último cambio de la app: `09a9694`).
- Codex sumó el 2026-10-13 cola de turnos, modos Solitario y 1 contra 1, y el diseño nuevo (`8e76dc6`, detalle y respaldo en `docs/CAMBIOS-2026-10-13.md`).
- El panel del juez muestra abiertos otra vez Ajustes rápidos, Reproductor, Próximos y Comprobar la canción. Si Spotify deja de contestar, el panel ya no queda trabado (todo pedido tiene tope de 10 s) y Reactivar crea un reproductor nuevo (`6f6fb5c`).
- Calidad (2026-10-17): mapa de flujos y pruebas en `docs/CALIDAD.md`; GitHub Actions corre validación, unitarias con cobertura, compilación y E2E en cada push (marca en rojo, todavía no frena a Render); las 16 mutaciones de `.claude/scripts/mutantes.mjs` se detectan.
- Spotify Connect recuerda el aparato elegido (id y nombre) y el panel de juego muestra «Suena en: …» con selector; antes, al recargar o reactivar, la música iba al aparato activo de la cuenta (un Echo Pop).
- Spotify Connect confirma que el aparato suena antes de contar el fragmento; si no arranca (iPhone con Spotify dormido en segundo plano) avisa qué hacer. Sin verificar en un iPhone real.
- iPhone + Spotify Connect: la página no abre audio propio (efectos apagados); si sonara, iOS le corta la música a la app de Spotify y en segundo plano no vuelve. Hipótesis del caso «el tema se corta al tocar Sonar y no suena nada»; sin verificar en un iPhone real.
- Spotify Connect solo usa celulares (decisión del dueño): parlantes como el Echo Pop ya no se listan ni se eligen.
- La lista se mezcla al empezar cada partida (opción en Reglas, activada de entrada).
- Hay controles y reglas para agentes en `.claude/` (hooks, subagentes Explore y sonnet-coder, skills `pruebas-app` y `publicar`), `AGENTS.md` y `CLAUDE.md`.

## Producción
- App: https://en1nota.onrender.com/ · estado: https://en1nota.onrender.com/healthz
- Desde las sesiones en la nube de Claude esa dirección puede estar bloqueada por la red de la sesión (2026-10-16: conexión rechazada); en ese caso el dueño abre `/healthz` en su navegador y pega el resultado.

## Pendiente del dueño
- Volver a probar en la PC del amigo: si la música se corta, anotar el mensaje que aparece en rojo o en el panel Reproductor (ahora avisa si el reproductor se desconecta o si Spotify pide esperar).
- Probar con Spotify real y celulares reales: los modos nuevos, la mezcla al empezar, el panel "Verificar" del juez, importar una playlist pública de otra persona y el botón "Puntajes" y el podio en los celulares.

## Sin verificar (no marcarlo como comprobado)
- La lectura de playlists públicas contra la página real de Spotify (solo se probó con páginas de ejemplo).
- Audio real, celulares reales y actualización de la PWA entre versiones.

## Publicado
| Fecha | Commit | Qué | Cómo volver atrás |
| --- | --- | --- | --- |
| 2026-10-16 | `6f6fb5c` | Panel del juez sin trabas si Spotify no contesta; secciones abiertas de entrada | Render → Events → Rollback, o `git revert 6f6fb5c` y push |
| 2026-10-16 | `c8c0c4d` | `/healthz` y `/api` llegan al servidor aunque la app esté instalada | Render → Events → Rollback, o `git revert c8c0c4d` y push |
| 2026-10-16 | `09a9694` | Mezclar la lista al empezar; reglas y controles para agentes | Render → Events → Rollback al despliegue de `8e76dc6`, o `git revert` de los commits nuevos y push |
| 2026-10-13 | `8e76dc6` | Cola de turnos, Solitario, 1 contra 1 y diseño nuevo (Codex) | Ver `docs/CAMBIOS-2026-10-13.md` |
| 2026-10-12 | `da3aeef` | Verificar canción, playlists públicas, puntajes en celulares, textos del reproductor | Render → Events → Rollback, o `git revert` y push |
