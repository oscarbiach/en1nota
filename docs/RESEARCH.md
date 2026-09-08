# Investigación de referencia

El juego a replicar se basa en tres videos de streamers en vivo:

- https://www.youtube.com/watch?v=w_7ZfXradUI
- https://www.youtube.com/watch?v=YgqcLfbLZQ4
- https://www.youtube.com/watch?v=vToWhreU1vg

## Cómo extraer las mecánicas

`tools/grab-reference.sh` baja un video, sus subtítulos y su metadata, y saca
frames a intervalo fijo para poder revisar la UI y la dinámica cuadro por cuadro.

```bash
pip3 install yt-dlp imageio-ffmpeg
./tools/grab-reference.sh w_7ZfXradUI 15   # <VIDEO_ID> <intervalo en segundos>
```

Deja todo en `tools/vids/<VIDEO_ID>/`:

- `<ID>.info.json` — título, canal, descripción, capítulos
- `<ID>.*.vtt` — subtítulos (automáticos o manuales, es/en)
- `<ID>.mp4` — video a <=480p
- `frames/f_%04d.jpg` — un frame cada N segundos

## Requisito de red

El entorno remoto usa una política de egress restrictiva. Para que esto funcione
hay que permitir estos dominios:

| Dominio | Para qué |
|---|---|
| `youtube.com`, `www.youtube.com`, `m.youtube.com` | página y metadata |
| `youtubei.googleapis.com` | API interna (InnerTube) |
| `*.googlevideo.com` | streams de video/audio |
| `i.ytimg.com`, `yt3.ggpht.com` | miniaturas (opcional) |

Ver https://code.claude.com/docs/en/claude-code-on-the-web

## Reglas documentadas

Ver el README: pulsador, aciertos, penalizaciones, tarareo, rebote con fragmento
más largo y bloqueo del que falló. Las decisiones de producto que quedaron fijas:

- Juego presencial. Un juez con Spotify Premium, jugadores con celu o modo mesa.
- El juez puede ser iPhone, Android o notebook: SDK donde se puede, Connect donde no.
- Extras de la primera versión: pantalla de TV, historial con estadísticas, sonidos.
- No se pidió cuenta regresiva para responder; el juez marca "en blanco" a mano.

## Estado

- [x] Documentar reglas del juego
- [x] Diseñar y construir la PWA (`src/`)
- [ ] Extraer detalles finos de la UI de los videos (pendiente de acceso a YouTube)
