#!/bin/bash
# uso: ./grab-reference.sh <VIDEO_ID> [umbral_escena]
#
# Baja video + subtitulos + metadata y saca UN frame por corte de plano
# (deteccion de escena), no uno cada N segundos. Deja transcripcion e
# indice con timestamps alineados a los frames.
set -e
SP="$(cd "$(dirname "$0")" && pwd)"
ID="$1"; THRESH="${2:-0.3}"
[ -z "$ID" ] && { echo "uso: $0 <VIDEO_ID> [umbral_escena]"; exit 1; }
OUT="$SP/vids/$ID"; mkdir -p "$OUT/frames"
FFMPEG=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")

echo ">> metadata + subtitulos"
python3 -m yt_dlp --skip-download --write-info-json --write-auto-subs --write-subs \
  --sub-langs "es.*,en.*" --sub-format vtt \
  -o "$OUT/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=$ID"

echo ">> video (<=720p)"
python3 -m yt_dlp -f "bv*[height<=720]+ba/b[height<=720]/b" --merge-output-format mp4 \
  --ffmpeg-location "$(dirname "$FFMPEG")" -o "$OUT/$ID.%(ext)s" \
  "https://www.youtube.com/watch?v=$ID"

V=$(ls "$OUT/$ID".mp4 "$OUT/$ID".mkv "$OUT/$ID".webm 2>/dev/null | head -1)
[ -z "$V" ] && { echo "!! no se descargo el video"; exit 1; }

# Sin subtitulos utiles -> transcribir el audio con whisper (CPU).
if ! ls "$OUT/$ID".*.vtt >/dev/null 2>&1; then
  echo ">> sin subtitulos, transcribiendo con whisper (tarda)"
  python3 "$SP/transcribe.py" "$V" "$OUT/$ID.whisper.vtt"
fi

echo ">> frames por corte de plano (umbral $THRESH)"
rm -f "$OUT/frames"/*.jpg "$OUT/frames.txt"
"$FFMPEG" -hide_banner -loglevel error -i "$V" \
  -vf "select='eq(n,0)+gt(scene,$THRESH)',scale=800:-2,metadata=print:file=$OUT/frames.txt" \
  -vsync vfr -q:v 4 "$OUT/frames/f_%04d.jpg"

echo ">> transcripcion + indice"
python3 "$SP/build_index.py" "$OUT" "$ID"
