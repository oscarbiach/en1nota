#!/bin/bash
# uso: ./grab.sh <VIDEO_ID> <intervalo_seg>
set -e
SP="$(cd "$(dirname "$0")" && pwd)"
ID="$1"; STEP="${2:-15}"
OUT="$SP/vids/$ID"; mkdir -p "$OUT/frames"
FFMPEG=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")

echo ">> metadata + subtitulos"
python3 -m yt_dlp --skip-download --write-info-json --write-auto-subs --write-subs \
  --sub-langs "es.*,en.*" --sub-format vtt \
  -o "$OUT/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=$ID"

echo ">> video (<=480p)"
python3 -m yt_dlp -f "bv*[height<=480]+ba/b[height<=480]/b" --merge-output-format mp4 \
  --ffmpeg-location "$(dirname "$FFMPEG")" -o "$OUT/$ID.%(ext)s" \
  "https://www.youtube.com/watch?v=$ID"

echo ">> frames cada ${STEP}s"
V=$(ls "$OUT/$ID".mp4 "$OUT/$ID".mkv "$OUT/$ID".webm 2>/dev/null | head -1)
"$FFMPEG" -hide_banner -loglevel error -i "$V" \
  -vf "fps=1/$STEP,scale=854:-2" -q:v 4 "$OUT/frames/f_%04d.jpg"

echo ">> listo:"; ls "$OUT/frames" | wc -l; echo "frames en $OUT/frames"
