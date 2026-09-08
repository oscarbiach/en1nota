#!/usr/bin/env python3
"""Transcribe un audio/video a VTT con faster-whisper (corre en CPU).

uso: transcribe.py <archivo> <salida.vtt> [modelo]
"""
import sys


def ts(seconds):
    h, rest = divmod(float(seconds), 3600)
    m, s = divmod(rest, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else "small"

    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(src, vad_filter=True)
    print(f"   idioma detectado: {info.language} ({info.language_probability:.2f})")

    with open(dst, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for seg in segments:
            text = seg.text.strip()
            if not text:
                continue
            f.write(f"{ts(seg.start)} --> {ts(seg.end)}\n{text}\n\n")
    print(f"   escrito {dst}")


if __name__ == "__main__":
    main()
