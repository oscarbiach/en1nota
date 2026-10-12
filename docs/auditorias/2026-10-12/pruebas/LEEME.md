# Reproducción de la segunda auditoría

Usar una copia de `oscarbiach/en1nota`, rama `claude/music-recognition-game-5vz0p8`, commit `08bd7263f2d25eddb231d109c1670615ae212e91`. Entorno usado: Node 24.16.0, npm 11.13.0, Edge y Playwright del repo.

## Preparación

1. Copiar `audit2-*.mjs` de esta carpeta a `test/e2e/` del repo. Los helpers que importan ya están en ese commit.
2. Desde la raíz del repo: `npm ci`, `npm test`, `npm run build`.
3. Para las pruebas de accesibilidad instalar el verificador fuera del repo: `npm install --prefix ../audit-tools --no-save --ignore-scripts axe-core@4.14.0`.
4. En una terminal, iniciar el servidor local en puerto 8791. En PowerShell ejecutar `$env:PORT='8791'` y luego `node server/index.js`.
5. En otra terminal, desde la raíz del repo, ejecutar los comandos siguientes, uno por vez. No definir `BASE` con la URL publicada para estos scripts.

```text
node test/e2e/audit2-runtime.mjs
node test/e2e/audit2-browser.mjs
node test/e2e/audit2-auth.mjs
node test/e2e/audit2-pwa.mjs
node test/e2e/audit2-restart.mjs
```

`audit2-restart` levanta y reinicia su propio servidor en 8793; ese puerto debe estar libre. `audit2-pwa` modifica temporalmente sólo `dist/sw.js` y lo restaura en finally; no ejecutar mientras se esté reconstruyendo dist ni sobre un despliegue publicado. Parar el servidor de 8791 con Ctrl+C al terminar.

Los resultados se escriben en `audit-output/segunda-auditoria/`, o en `AUDIT_OUT` si se define. Las rutas de salida se adaptaron respecto de la ejecución original para transportar el paquete.

## Qué hace cada script

- runtime: método SDK con evento simulado, playlist con episodio simulado, cuota de storage y desfase de reloj. Usa el código real de componentes con importación TypeScript mediante Node; no ejecuta Spotify real.
- browser: timestamp manipulado únicamente local; almacenamiento inválido en un contexto nuevo; error HTTP 500 de Spotify interceptado sin salir a su API; accesibilidad automática. `ONLY=B07` permite limitar a accesibilidad.
- auth: fetch simulado offline con credenciales ficticias; comprueba si se conserva la sesión.
- pwa: actualización de bytes del service worker, cartel, recarga durante fragmento y preservación de puntaje.
- restart: partida con celular, reinicio de proceso local, nuevo código y rechazo al intentar reincorporarse.

Son scripts de investigación que registran observaciones. Un código de salida cero no significa que el defecto desapareció. Transformar los resultados en aserciones del comportamiento esperado para incorporarlos a regresiones.

## Checks originales verificados

Se ejecutaron `npm test` (47 aprobadas) y `npm run test:e2e` con `PW_CHANNEL=msedge` (build, partida original y 16 regresiones aprobadas). En PowerShell se define esa variable con `$env:PW_CHANNEL='msedge'` antes del comando.

El recorrido publicado se ejecutó aparte usando únicamente la prueba normal `flow.mjs` y una sala de prueba. No ejecutar contra producción los scripts de mensajes manipulados, reinicio, storage o actualización.
