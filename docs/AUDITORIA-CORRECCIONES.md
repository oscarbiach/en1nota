# Correcciones de la auditoría

Auditoría del 9 de octubre de 2026 sobre `claude/music-recognition-game-5vz0p8`,
commit `36c699b`. Las correcciones están en los commits siguientes de la misma
rama. Cada defecto tiene una prueba de regresión que falla con el código
auditado y pasa con el corregido (columna "36c699b").

Todas las pruebas usan reloj, red o reproductor simulados, o música manual en
el navegador. **Ninguna usa Spotify real.**

Para verificar que las pruebas detectan los defectos, se corrieron contra
`36c699b` en un worktree aparte: las 7 del servidor fallan; 13 de las 16 E2E
fallan en el síntoma descrito por la auditoría (en A08 la E2E se detiene antes,
en un selector nuevo, y el defecto lo demuestran las pruebas del motor, que
fallaron con el motor original). Las 3 E2E que pasan cubren comportamiento que
ya funcionaba y se agregaron como protección: recargar con alguien con la
palabra o con el tema revelado, reconexión legítima, y nueva partida.

| ID | Estado | Cambio | Prueba | 36c699b |
|---|---|---|---|---|
| A01 | Corregido | Contrato de cancelación común (`src/spotify/run.ts`): todo fragmento termina como `done` o `cancelled`; uno nuevo o "Parar" cancela el anterior con su timer. "Sonar" siempre libera su estado; "Parar" pasa a pulsadores abiertos. | `test/player.test.ts`; E2E "A01" ×3 | Falla |
| A02 | Corregido | `restoreGame()` al leer la partida: `playing` → pulsadores abiertos con aviso "podés repetirlo"; se descartan pulsaciones en espera; puntajes y bloqueos intactos. | `test/engine.test.ts` (5 fases); E2E "A02" ×2 | Falla (sonando) |
| A03 | Corregido | Servidor valida y reconstruye cada mensaje por tipo, rol y tamaño (64 KB); el navegador valida de nuevo (`src/net/validate.ts`); el motor tolera nombres no textuales; `ErrorBoundary`. Además: un frame demasiado grande tumbaba el servidor entero (faltaba `ws.on('error')`). | `test/server-security.test.js`, `test/validate.test.ts`, `test/socket.test.ts`; E2E "A03" | Falla |
| A04 | Corregido | `join` devuelve un secreto privado; retomar un `pid` exige ese secreto. El roster nunca lo incluye. | `test/server-security.test.js`; E2E "A04/A12" | Falla |
| A05 | Corregido | Cada operación de juez o jugador verifica que el socket sigue siendo el registrado; el reemplazado recibe aviso y se cierra con 4001 (el cliente no reconecta); el juez desplazado ve "La sala se abrió en otro lado". | `test/server-security.test.js`, `test/socket.test.ts`; E2E "A05" | Falla |
| A06 | Corregido | `finishGame()` agrega la ronda en curso una sola vez si tuvo actividad (marcada "sin terminar" si no se reveló). | `test/engine.test.ts` (5 casos); E2E "A06" | Falla |
| A07 | Corregido | En modo mesa "Próximos" no dibuja títulos, artistas ni tapas; "Mantener para ver". | E2E "A07" | Falla |
| A08 | Corregido | `rankStandings()`: puntos, luego aciertos; empate restante comparte puesto y todos ganan. Juez, TV e historial usan el mismo cálculo; la TV recibe el resultado. | `test/engine.test.ts` (3 casos); E2E "A08" | Falla (motor) |
| A09 | Corregido | `usePress()`: toque en `pointerdown` y `click` sin toque reciente (Enter, Espacio, lectores). Enter/Espacio sobre un botón ya no disparan atajos globales. | E2E "A09" ×2 | Falla |
| A10 | Corregido | "Empezar de cero" reincorpora celulares conectados y quita los de mesa; expulsar olvida la conexión. | E2E "A10" | Falla |
| A11 | Corregido | El selector separa la selección pendiente del modo activo y se alinea con el reproductor real al llegar. | E2E "A11" | Falla |
| A12 | Corregido | `Socket` guarda y cancela todos sus timers e ignora callbacks de sockets no vigentes. | `test/socket.test.ts` | Falla |
| D01 | Corregido | `npm audit fix` sin `--force`, sólo lockfile (8 paquetes, parche/menor). `npm audit`: 0 completo y 0 producción. | `npm audit`, `npm audit --omit=dev` | — |
| R01 | Pendiente (dueño) | Documentado en README; no se cambiaron remotos, rama predeterminada ni despliegue. | — | — |

## Riesgos de la auditoría

- **Fallo de reproducción (riesgo 2):** mitigado por diseño en A01 ("Sonar"
  sale de "sonando" también si Spotify falla), sin probar con Spotify real.
- **Riesgos 1, 3, 4, 5, 6 y 7:** sin cambios; siguen pendientes de revisión.

## Sin probar

- Spotify real (Premium): login, refresh, SDK, Connect, precisión de fragmentos.
- Dispositivos físicos (iPhone/Safari, Android), red con pérdidas, carga.
- El cartel de actualización de la PWA con un service worker nuevo: sólo se
  probó el camino equivalente (recarga de la página).
