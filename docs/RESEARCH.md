# Investigación de referencia

El juego a replicar se basa en tres videos de streamers en vivo:

- https://www.youtube.com/watch?v=w_7ZfXradUI
- https://www.youtube.com/watch?v=YgqcLfbLZQ4
- https://www.youtube.com/watch?v=vToWhreU1vg

## Cómo extraer las mecánicas

`tools/grab-reference.sh` baja un video, sus subtítulos y su metadata, y saca
**un frame por corte de plano** (detección de escena), no uno cada N segundos.

```bash
pip3 install yt-dlp imageio-ffmpeg
./tools/grab-reference.sh w_7ZfXradUI        # umbral de escena 0.3 por defecto
./tools/grab-reference.sh w_7ZfXradUI 0.4    # menos frames, solo cortes muy marcados
```

Deja todo en `tools/vids/<VIDEO_ID>/`:

- `INDEX.md` — tabla frame → momento → lo que se está diciendo ahí (**empieza por aquí**)
- `transcript.md` — transcripción con timestamps, sin las líneas repetidas de los autosubs
- `frames/t_HH-MM-SS.jpg` — un frame por corte, a 800px de ancho
- `<ID>.info.json` — título, canal, descripción, capítulos
- `<ID>.*.vtt` — subtítulos crudos (automáticos o manuales, es/en)
- `<ID>.mp4` — video a <=720p

### Por qué detección de escena y no intervalo fijo

El muestreo a intervalo fijo falla por los dos lados a la vez: se pierde los
cortes rápidos y a la vez gasta contexto en sesenta copias de la misma
diapositiva estática. Un frame por corte da la misma cobertura con 5-10x menos
imágenes. El umbral (0 a 1) es cuánto tiene que cambiar la imagen para contar
como corte: **0.3** funciona bien; súbelo si salen demasiados frames, bájalo si
se pierde pantallas.

Los frames van a 800px de ancho a propósito: la resolución importa más que la
cantidad, y a ese tamaño el texto en pantalla se lee perfectamente sin quemar
contexto.

### Si no hay subtítulos

El script transcribe el audio con whisper en CPU y sigue igual:

```bash
pip3 install faster-whisper
```

### Cómo se usa el resultado

Apuntar Claude Code a la carpeta del video. Para contenido hablado la
transcripción hace casi todo el trabajo; los frames valen su coste cuando hay
UI, marcadores o números en pantalla — que es justo el caso de estos videos.

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

## Estado

- [ ] Extraer mecánicas de los videos
- [ ] Documentar reglas del juego
- [ ] Diseñar la PWA
