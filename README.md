# En 1 Nota

Juego presencial para juntadas: el juez hace sonar un pedacito de una canción
(a veces una sola nota), el que toca primero tiene que decir el nombre exacto o
cantar la letra. Acertar suma, fallar resta, tararear resta.

Es una PWA en español que corre en cualquier navegador:

- **Juez**: maneja la música desde su Spotify Premium, ve quién tocó primero,
  marca correcto / incorrecto / tarareo y avanza. Notebook, Android o iPhone.
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
| Toca y tararea el instrumento | resta (por defecto −1), se cuenta aparte en las estadísticas |
| Nadie acierta | el juez repite un fragmento más largo (0,4 s → 1,2 s → 3 s → 8 s) o revela |
| Dos tocan casi juntos | se ordenan por reloj sincronizado con el servidor, ventana de 150 ms |

Todo es configurable en la pestaña **Reglas**: duraciones, puntos por pasada
(por ejemplo 3 / 2 / 1), penalizaciones y bloqueo.

## Cómo se juega

1. El juez abre la app, entra a **Panel del juez** y conecta Spotify (una sola vez).
2. Activa el reproductor y prueba que suene.
3. Arma la lista: busca canciones, importa una playlist de Spotify o carga una
   lista guardada. En cada tema puede marcar desde qué segundo arranca el fragmento.
4. Los jugadores entran con el código o el QR. La TV se abre con el link de la
   pestaña Jugadores.
5. **¡Empezar!** El juez toca *Sonar*, espera pulsaciones, juzga, y sigue.
6. Al final: podio, premios (reflejo, impulsivo, tarareador, bajo cero) e historial.

Atajos del juez: `espacio` sonar · `C` correcto · `X` incorrecto · `T` tarareo ·
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
- **Spotify Connect**: la app manda play / pause a la app de Spotify de otro
  dispositivo (el iPhone del juez, un parlante). Es la única opción en iPhone /
  iPad. Cada comando viaja por internet, así que fragmentos de menos de ~1 s
  quedan imprecisos: conviene empezar en 1 s.
- **Sin reproductor**: el juez pone la música por su cuenta y la app solo lleva
  tiempo, pulsadores y puntaje. Respaldo si Spotify falla.

## Desarrollo

```bash
npm install
npm run dev        # PWA en http://127.0.0.1:5173 + servidor de salas en :8787
npm test           # motor de reglas y servidor
npm run build      # typecheck + dist/
npm start          # sirve dist/ y /ws en :8787
```

Estructura:

- `src/game/` motor de reglas puro (`engine.ts`) y tipos. Sin red ni audio.
- `src/spotify/` login PKCE, cliente de la Web API y reproductores de fragmentos.
- `src/net/` sala por WebSocket, reloj sincronizado, protocolo juez ↔ jugadores.
- `src/views/` juez (lobby, lista, panel de juego), jugador, TV, historial.
- `src/audio/sfx.ts` efectos sintetizados con Web Audio (sin archivos).
- `server/index.js` relay de salas. No conoce las reglas.

## Deploy

Un solo servicio Node sirve la PWA y el WebSocket. Con el `Dockerfile` anda en
cualquier hosting; `render.yaml` lo deja listo para Render (plan gratis, con
HTTPS, que Spotify exige):

1. En Render: *New* → *Blueprint* → elegir este repo.
2. Copiar la URL que asigna (`https://<nombre>.onrender.com/`) como Redirect URI
   en la app de Spotify.

El plan gratis de Render duerme el servicio tras 15 min sin uso: la primera
carga de la noche tarda unos 30 s. Conviene abrirlo antes de que llegue la gente.
