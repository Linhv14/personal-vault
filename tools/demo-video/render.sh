#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
assets="$here/../../share/assets"
out="$here/out"
for locale in "${@:-en vi}"; do
  for l in $locale; do
    node "$here/record.mjs" "$l" "$out/rec-$l"
    node "$here/cleanup.mjs"
    ffmpeg -y -loglevel error -f concat -safe 0 -i "$out/rec-$l/list.txt" \
      -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p" \
      -c:v libx264 -crf 23 -preset slow -movflags +faststart -an "$assets/demo-$l.mp4"
    ffmpeg -y -loglevel error -i "$assets/demo-$l.mp4" \
      -c:v libvpx-vp9 -b:v 0 -crf 35 -row-mt 1 -an "$assets/demo-$l.webm"
    ffmpeg -y -loglevel error -ss 12 -i "$assets/demo-$l.mp4" -frames:v 1 "$out/poster-$l.png"
    cwebp -quiet -q 80 "$out/poster-$l.png" -o "$assets/demo-poster-$l.webp"
  done
done
