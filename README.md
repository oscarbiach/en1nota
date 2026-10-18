# En 1 Nota

Juego presencial para juntadas: el juez hace sonar un pedacito de una canción
(a veces una sola nota), el que toca primero tiene que decir el nombre exacto o
cantar la canción (tarareando también vale). Acertar suma, fallar resta.

Ahora también incluye **Solitario** (respuesta escrita con 30 segundos o
autoevaluación) y **1 contra 1** sin juez adicional. En las juntadas, los toques
forman una cola: si alguien falla, la palabra pasa automáticamente al siguiente.
Ver [guía de los nuevos modos, cambios y rollback](docs/CAMBIOS-2026-10-13.md).

Es una PWA en español que corre en cualquier navegador:

- **Juez**: maneja la música desde su Spotify Premium, ve quién tocó primero,
  marca correcto / incorrecto y avanza. Notebook, Android o iPhone.
- **Jugadores**: entran con un código desde su celu y la pantalla entera es el
  pulsador. Sin instalar nada.
- **Pantalla de TV** (opcional): puntajes, quién tiene la palabra, revelación
  con tapa del disco. Nunca muestra el título antes de tiempo.
- **Modo mesa**: si no hay celulares, los pulsadores están en la pantalla del
  juez con las teclas 1 a 8.

## Reglas implementadas

| Situación | Qué pasa |
|---|---|
| Toca primero y acierta | suma los puntos de esa pasada (por defecto +1) |
| Toca y falla / se queda en blanco | resta (por defecto −1) y queda bloqueado en ese tema |
| Nadie acierta | el juez repite un fragmento más largo (0,4 s → 1,2 s → 3 s → 8 s) o revela |
| Varios tocan | se ordenan por llegada al servidor; el primero habla y el resto espera en cola. Si falla, sigue el próximo |

Todo es configurable en la pestaña **Reglas**: duraciones, puntos por pasada
(por ejemplo 3 / 2 / 1), penalizaciones y bloqueo. De entrada la lista se
mezcla al empezar cada partida; apagando esa opción se respeta el orden.

## Cómo se juega

1. El juez abre la app, entra a **Panel del juez** y conecta Spotify (una sola vez).
2. Activa el reproductor y prueba que suene.
3. Arma la lista: busca canciones, importa una playlist de Spotify o carga una
   lista guardada. En cada tema puede marcar desde qué segundo arranca el fragmento.
4. Los jugadores entran con el código o el QR. La TV se abre con el link de la
   pestaña Jugadores.
5. **¡Empezar!** El juez toca *Sonar*, espera pulsaciones, juzga, y sigue.
6. Al final: podio, premios (reflejo, impulsivo, bajo cero) e historial.

Atajos del juez: `espacio` sonar · `C` correcto · `X` incorrecto ·
`N` siguiente · `1`-`8` pulsadores en modo mesa. En la TV, `F` pantalla completa.

## Spotify

Se necesita **una** cuenta Premium (la del juez). Una sola vez:

1. Entrar a <https://developer.spotify.com/dashboard> y crear una app.
2. En *Redirect URIs* agregar exactamente la URL donde está publicada la app,
   con barra final, por ejemplo `https://en1nota.onrender.com/`. Para desarrollo
   local, `http://127.0.0.1:5173/` (Spotify no acepta `localhost`).
3. Marcar *Web Playback SDK* y *Web API* entre las APIs usadas.
4. Copiar el **Client ID** y pegarlo en la pestaña Spotify del panel del juez.

Dónde suena la música:

- **En este navegador** (Web Playback SDK): notebook con Chrome / Edge / Firefox
  o Android con Chrome. Es el modo preciso: la pausa es local, así que un
  fragmento de 400 ms dura 400 ms.
- En iPhone, **Suena en este celular** intenta la canción completa con el
  reproductor web de Spotify; si Spotify no lo permite en ese iPhone, la app
  pasa sola a **Vista previa**.
- **Vista previa**: suenan los 30 s de muestra que
  Spotify publica de cada tema, dentro de la misma página y con corte exacto.
  El servidor saca el enlace de la página pública de cada canción
  (`/api/spotify/preview/:id`), que no es una vía oficial. El fragmento arranca
  donde arranca la muestra y algunos temas no tienen. No necesita sesión.
- **Spotify Connect**: la app manda play / pause a la app de Spotify de un
  celular (el iPhone del juez). Por decisión del dueño solo se usan celulares:
  parlantes, compus y TVs de la cuenta no se listan. Es la única opción en iPhone. Cada comando viaja por internet, así que fragmentos de menos de ~1 s
  quedan imprecisos: conviene empezar en 1 s.
- **Sin reproductor**: el juez pone la música por su cuenta y la app solo lleva
  tiempo, pulsadores y puntaje. Respaldo si Spotify falla.

## Desarrollo

```bash
npm install
npm run dev        # PWA en http://127.0.0.1:5173 + servidor de salas en :8787
npm test           # motor, servidor, red y reproductores (sin navegador)
npm run test:e2e   # compila y juega partidas reales en Chromium (ver abajo)
npm run build      # typecheck + dist/
npm start          # sirve dist/ y /ws en :8787
```

`npm run test:e2e` funciona igual en Windows, macOS y Linux: `test/e2e/run.mjs`
levanta el servidor en el puerto 8791, corre la partida completa
(`flow.mjs`) y las regresiones de la auditoría (`regressions.test.mjs`) con
juez, celulares y TV en contextos separados, y apaga el servidor. Usa el
Chromium de Playwright (`npx playwright install chromium` la primera vez);
para usar el navegador instalado: `PW_CHANNEL=msedge` o `PW_CHANNEL=chrome`,
o `PW_EXECUTABLE=/ruta/al/binario`. Todas las pruebas usan **música manual**:
ninguna toca Spotify real.

Estructura:

- `src/game/` motor de reglas puro (`engine.ts`) y tipos. Sin red ni audio.
- `src/spotify/` login PKCE, cliente de la Web API y reproductores de fragmentos
  (`run.ts`: contrato de cancelación común a todos).
- `src/net/` sala por WebSocket, reloj sincronizado, protocolo juez ↔ jugadores
  y validación de mensajes (`validate.ts`).
- `src/views/` juez (lobby, lista, panel de juego), jugador, TV, historial.
- `src/audio/sfx.ts` efectos sintetizados con Web Audio (sin archivos).
- `server/index.js` relay de salas. No conoce las reglas; valida cada mensaje
  (`server/validate.js`) y revoca conexiones reemplazadas.

## Decisiones de producto provisorias

Quedaron implementadas así para que juez, TV e historial sean coherentes, pero
son reglas de juego a confirmar:

- **Desempate.** Gana quien tiene más puntos; a igual puntaje, más aciertos. Si
  siguen iguales, **comparten el puesto** (1, 1, 3) y todos son ganadores
  ("🤝 Empate: …"); en el historial cada uno suma una partida ganada. No se
  desempata por nombre ni por orden. Alternativas posibles: ronda de
  desempate, o desempatar por menos fallos o por reflejo más rápido.
- **Ganador con puntaje cero o negativo.** Igual se corona al primero (o a
  los empatados en el primer puesto), también en el historial.
- **"Empezar de cero".** Misma sala: se borran lista y puntajes, se quitan los
  jugadores de modo mesa, y los celulares conectados se reincorporan solos.
  Alternativa: cerrar la sala y abrir otra con código nuevo.
- **Terminar antes.** El tema en curso cuenta si llegó a sonar: entra al
  historial como "sin terminar" y sus fallos cuentan; un tema que no sonó
  no se registra.

## Rama del proyecto

La aplicación vive en la rama `claude/music-recognition-game-5vz0p8`, que es
la que despliega Render. La rama predeterminada del repositorio,
`claude/mobile-streamer-game-ui03ko`, sólo tiene la investigación inicial: una
clonación normal no trae la app. Para ordenarlo (lo decide el dueño del repo):

1. Crear `main` desde `claude/music-recognition-game-5vz0p8`.
2. En GitHub, *Settings → General → Default branch*: elegir `main`.
3. En Render, *Settings → Build & Deploy → Branch*: elegir `main`.

Hasta entonces, indicar siempre esta rama al trabajar sobre el código.

## Deploy

Un solo servicio Node sirve la PWA y el WebSocket. Con el `Dockerfile` anda en
cualquier hosting; `render.yaml` lo deja listo para Render (plan gratis, con
HTTPS, que Spotify exige):

1. En Render: *New* → *Blueprint* → elegir este repo.
2. Copiar la URL que asigna (`https://<nombre>.onrender.com/`) como Redirect URI
   en la app de Spotify.

El plan gratis de Render duerme el servicio tras 15 min sin uso: la primera
carga de la noche tarda unos 30 s. Conviene abrirlo antes de que llegue la gente.

### Reinicios del servidor (`ROOM_SECRET`)

Las salas viven en la memoria del servidor; un reinicio (deploy, o Render
despertando el servicio) las borra. Las claves del juez y de cada celular son
firmas con `ROOM_SECRET`, así que con esa variable **fija** el servidor las
reconoce al volver: el juez recupera el mismo código y cada celular su puesto,
sin hacer nada. `render.yaml` la declara con `generateValue: true`: Render
genera un valor aleatorio la primera vez que sincroniza el Blueprint y lo
conserva entre deploys. Si el servicio no se sincroniza desde el Blueprint,
agregarla a mano en *Environment → Add Environment Variable* con un valor
largo y aleatorio (por ejemplo `openssl rand -hex 32`). No compartirla: quien
la tenga puede firmar claves.

Sin `ROOM_SECRET`, el servidor genera uno por proceso: todo funciona, pero tras
un reinicio el juez recibe un código nuevo (lo muestra en rojo) y cada celular
entra con ese código; el juez confirma quién es cada uno y conservan su
puntaje. Nadie recupera un puesto sin esa confirmación.

### Límites y estado del servidor

El servidor limita recursos para que un cliente roto o malicioso no lo
sature. Valores por defecto, ajustables por variable de entorno:

| Variable | Por defecto | Qué limita |
|---|---|---|
| `MAX_ROOMS` | 500 | salas abiertas a la vez (el juez ve "servidor lleno" y reintenta solo) |
| `MAX_CONNECTIONS` | 2000 | conexiones simultáneas |
| `MAX_PEERS_PER_ROOM` | 32 | identidades por sala; quien retoma la suya siempre entra |
| `PEER_TTL_MS` | 1800000 | tras 30 min desconectada, una identidad deja de ocupar lugar |

Además cada conexión tiene un límite de frecuencia (celular 10 mensajes/s con
ráfagas de 20; juez 100/s): lo que excede se descarta y un abuso sostenido
cierra esa conexión. Mensajes de hasta 64 KB.

`GET /healthz` devuelve salas, identidades, conexiones, tiempo en marcha y
contadores de rechazos (`server_full`, `room_full`, `connections`, `rate`,
`invalid`). No se hicieron pruebas de carga: los valores son prudentes, no
medidos.
