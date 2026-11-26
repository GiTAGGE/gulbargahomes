#!/usr/bin/env bash
# Renders a ~10s vertical Meta ad (1080x1920) for agricultural land sellers near Kalaburagi Airport.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/meta-agri-ad-$$"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W=1080
H=1920
DUR=2.0

ARTIFACT="/opt/cursor/artifacts/kalaburagi-airport-agri-land-meta-ad.mp4"
REPO_COPY="${ROOT}/content/ads/kalaburagi-airport-agri-land-meta-ad.mp4"

mkdir -p "$WORK" /opt/cursor/artifacts "${ROOT}/content/ads"

write_text() {
  local file="$1"
  shift
  printf '%s' "$*" >"$file"
}

# Shared scale/crop to vertical 9:16
VF_BASE="scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1"

make_segment() {
  local input="$1"
  local ss="$2"
  local out="$3"
  local t1="$4"
  local t2="${5:-}"
  local t3="${6:-}"

  write_text "$WORK/l1.txt" "$t1"
  local filter="${VF_BASE},trim=0:${DUR},setpts=PTS-STARTPTS"
  filter+=",drawtext=fontfile=${FONT}:textfile=${WORK}/l1.txt:fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.72"

  if [[ -n "$t2" ]]; then
    write_text "$WORK/l2.txt" "$t2"
    filter+=",drawtext=fontfile=${FONT}:textfile=${WORK}/l2.txt:fontsize=52:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.80"
  fi
  if [[ -n "$t3" ]]; then
    write_text "$WORK/l3.txt" "$t3"
    filter+=",drawtext=fontfile=${FONT}:textfile=${WORK}/l3.txt:fontsize=44:fontcolor=#F5E6B8:borderw=2:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.88"
  fi

  ffmpeg -y -hide_banner -loglevel error \
    -ss "$ss" -i "$input" \
    -vf "$filter" \
    -t "$DUR" -an \
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    "$out"
}

AGRI1="${ROOT}/public/videos/properties/agri-land-tour.mp4"
AIRPORT="${ROOT}/public/videos/properties/whatsapp-video-2026-10-28-at-11.15.50-pm.mp4"
RIVERSIDE="${ROOT}/public/videos/properties/riverside-agri-land-video-tour.mp4"

make_segment "$AGRI1" 0 "$WORK/s01.mp4" \
  "Agricultural land near" "Kalaburagi Airport?"

make_segment "$AIRPORT" 1 "$WORK/s02.mp4" \
  "Within 25 km" "of the Airport"

make_segment "$RIVERSIDE" 3 "$WORK/s03.mp4" \
  "Demand is rising."

make_segment "$RIVERSIDE" 8 "$WORK/s04.mp4" \
  "Prices are climbing."

# CTA segment: dark overlay on agri footage
write_text "$WORK/cta1.txt" "Want the best offer"
write_text "$WORK/cta2.txt" "for your land?"
write_text "$WORK/cta3.txt" "Contact us today"

CTA_FILTER="${VF_BASE},trim=0:${DUR},setpts=PTS-STARTPTS,"
CTA_FILTER+="drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill,"
CTA_FILTER+="drawtext=fontfile=${FONT}:textfile=${WORK}/cta1.txt:fontsize=54:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.62,"
CTA_FILTER+="drawtext=fontfile=${FONT}:textfile=${WORK}/cta2.txt:fontsize=54:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.70,"
CTA_FILTER+="drawtext=fontfile=${FONT}:textfile=${WORK}/cta3.txt:fontsize=48:fontcolor=#7CFF7C:borderw=2:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.82"

ffmpeg -y -hide_banner -loglevel error \
  -ss 12 -i "$RIVERSIDE" \
  -vf "$CTA_FILTER" \
  -t "$DUR" -an \
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
  "$WORK/s05.mp4"

# Concat
printf "file '%s'\n" "$WORK/s01.mp4" "$WORK/s02.mp4" "$WORK/s03.mp4" "$WORK/s04.mp4" "$WORK/s05.mp4" >"$WORK/concat.txt"

ffmpeg -y -hide_banner -loglevel error \
  -f concat -safe 0 -i "$WORK/concat.txt" \
  -c copy \
  "$WORK/nosound.mp4"

# Optional quiet background music
MUSIC="$WORK/music.mp3"
if curl -fsSL --max-time 25 \
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb753ed36.mp3?filename=ambient-lounge-14085.mp3" \
  -o "$MUSIC" 2>/dev/null; then
  ffmpeg -y -hide_banner -loglevel error \
    -i "$WORK/nosound.mp4" -stream_loop -1 -i "$MUSIC" \
    -filter_complex "[1:a]volume=0.18,afade=t=out:st=9.5:d=0.5[a]" \
    -map 0:v -map "[a]" -shortest \
    -c:v copy -c:a aac -b:a 128k \
    "$ARTIFACT"
else
  ffmpeg -y -hide_banner -loglevel error \
    -i "$WORK/nosound.mp4" \
    -f lavfi -i "sine=frequency=130:duration=10,volume=0.04" \
    -f lavfi -i "sine=frequency=196:duration=10,volume=0.02" \
    -f lavfi -i "sine=frequency=262:duration=10,volume=0.015" \
    -filter_complex "[1:a][2:a][3:a]amix=inputs=3:duration=shortest,lowpass=f=600,afade=t=in:st=0:d=0.8,afade=t=out:st=9:d=0.9[a]" \
    -map 0:v -map "[a]" -shortest \
    -c:v copy -c:a aac -b:a 96k \
    "$ARTIFACT"
fi

cp "$ARTIFACT" "$REPO_COPY"

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$ARTIFACT"

rm -rf "$WORK"
echo "Wrote: $ARTIFACT"
echo "Wrote: $REPO_COPY"