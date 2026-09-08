#!/usr/bin/env python3
"""Alinea los frames con la transcripcion.

Renombra frames/f_0001.jpg -> frames/t_00-04-32.jpg usando los pts_time que
ffmpeg dejo en frames.txt, y escribe transcript.md + INDEX.md.

uso: build_index.py <dir_del_video> <VIDEO_ID>
"""
import json
import os
import re
import sys

# Orden de preferencia de subtitulos: es manual, es auto, en, whisper.
LANG_RANK = ["es", "en"]
TAG_RE = re.compile(r"<[^>]*>")
CUE_RE = re.compile(r"(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)")
PTS_RE = re.compile(r"pts_time:([0-9.]+)")


def hms(seconds):
    h, rest = divmod(int(seconds), 3600)
    m, s = divmod(rest, 60)
    return h, m, s


def stamp(seconds):
    return "%02d:%02d:%02d" % hms(seconds)


def to_seconds(text):
    h, m, s = text.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def pick_vtt(outdir, vid):
    found = [f for f in os.listdir(outdir) if f.startswith(vid + ".") and f.endswith(".vtt")]
    if not found:
        return None

    def rank(name):
        lang = name[len(vid) + 1:-4]
        if lang == "whisper":
            return (len(LANG_RANK), name)
        for i, pref in enumerate(LANG_RANK):
            if lang == pref or lang.startswith(pref + "-"):
                return (i, name)
        return (len(LANG_RANK) + 1, name)

    return sorted(found, key=rank)[0]


def parse_vtt(path):
    """Devuelve [(inicio_seg, texto)] sin las lineas repetidas de los autosubs."""
    with open(path, encoding="utf-8") as f:
        blocks = re.split(r"\n\s*\n", f.read())

    entries, recent = [], []
    for block in blocks:
        match = CUE_RE.search(block)
        if not match:
            continue
        start = to_seconds(match.group(1))
        lines = []
        for raw in block.split("\n"):
            if CUE_RE.search(raw) or raw.strip() == "WEBVTT":
                continue
            line = TAG_RE.sub("", raw).strip()
            # Los autosubs de YouTube repiten la linea anterior en cada cue.
            if line and line not in recent:
                lines.append(line)
                recent.append(line)
                recent[:] = recent[-4:]
        if lines:
            entries.append((start, " ".join(lines)))
    return entries


def rename_frames(outdir):
    """f_0001.jpg -> t_00-04-32.jpg. Devuelve [(segundos, nombre)]."""
    fdir = os.path.join(outdir, "frames")
    meta = os.path.join(outdir, "frames.txt")
    numbered = sorted(f for f in os.listdir(fdir) if re.fullmatch(r"f_\d+\.jpg", f))
    times = []
    if os.path.exists(meta):
        with open(meta, encoding="utf-8") as f:
            times = [float(m.group(1)) for m in PTS_RE.finditer(f.read())]

    if len(times) != len(numbered):
        print(f"   aviso: {len(numbered)} frames pero {len(times)} timestamps, no renombro")
        return [(None, name) for name in numbered]

    out = []
    for name, seconds in zip(numbered, times):
        new = "t_%02d-%02d-%02d.jpg" % hms(seconds)
        os.replace(os.path.join(fdir, name), os.path.join(fdir, new))
        out.append((seconds, new))
    return out


def line_at(entries, seconds):
    """Texto que se esta diciendo en ese segundo."""
    hit = ""
    for start, text in entries:
        if start > seconds:
            break
        hit = text
    # Un frame anterior al primer subtitulo (p.ej. el de 00:00:00) pertenece
    # igualmente a esa primera linea.
    if not hit and entries:
        hit = entries[0][1]
    return hit


def main():
    outdir, vid = sys.argv[1], sys.argv[2]

    vtt = pick_vtt(outdir, vid)
    entries = parse_vtt(os.path.join(outdir, vtt)) if vtt else []
    if entries:
        with open(os.path.join(outdir, "transcript.md"), "w", encoding="utf-8") as f:
            f.write(f"# Transcripcion {vid}\n\nFuente: `{vtt}`\n\n")
            for start, text in entries:
                f.write(f"[{stamp(start)}] {text}\n")
    else:
        print("   aviso: sin subtitulos, no hay transcripcion")

    frames = rename_frames(outdir)

    title = ""
    info = os.path.join(outdir, f"{vid}.info.json")
    if os.path.exists(info):
        with open(info, encoding="utf-8") as f:
            title = json.load(f).get("title", "")

    with open(os.path.join(outdir, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write(f"# {title or vid}\n\n")
        f.write(f"https://www.youtube.com/watch?v={vid}\n\n")
        f.write(f"{len(frames)} frames (uno por corte de plano), ")
        f.write(f"{len(entries)} lineas de transcripcion.\n\n")
        f.write("| Frame | Momento | Se esta diciendo |\n|---|---|---|\n")
        for seconds, name in frames:
            if seconds is None:
                when, said = "?", ""
            else:
                link = f"https://www.youtube.com/watch?v={vid}&t={int(seconds)}s"
                when = f"[{stamp(seconds)}]({link})"
                said = line_at(entries, seconds).replace("|", "\\|")[:120]
            f.write(f"| `frames/{name}` | {when} | {said} |\n")

    print(f"   {len(frames)} frames, {len(entries)} lineas -> {outdir}/INDEX.md")


if __name__ == "__main__":
    main()
