#!/usr/bin/env bash
# Renders a ~12s vertical Meta ad (1080x1920), Kannada + English, conversion-focused.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/meta-agri-ad-$$"
FONT_EN="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_KN="/usr/share/fonts/truetype/noto/NotoSansKannada-Bold.ttf"
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

VF_BASE="scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1"

# Kannada primary (larger), English support line, optional accent (offer/CTA).
make_segment() {
  local input="$1"
  local ss="$2"
  local out="$3"
  local kn1="$4"
  local kn2="${5:-}"
  local en="${6:-}"
  local accent="${7:-}"

  write_text "$WORK/kn1.txt" "$kn1"
  local filter="${VF_BASE},trim=0:${DUR},setpts=PTS-STARTPTS"
  filter+=",drawbox=x=0:y=0:w=iw:h=ih:color=black@0.28:t=fill"
  filter+=",drawtext=fontfile=${FONT_KN}:textfile=${WORK}/kn1.txt:fontsize=46:fontcolor=white:borderw=3:bordercolor=black@0.65:x=(w-text_w)/2:y=h*0.58"

  local y_kn2="0.67"
  if [[ -n "$kn2" ]]; then
    write_text "$WORK/kn2.txt" "$kn2"
    filter+=",drawtext=fontfile=${FONT_KN}:textfile=${WORK}/kn2.txt:fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.65:x=(w-text_w)/2:y=h*${y_kn2}"
  fi

  if [[ -n "$en" ]]; then
    write_text "$WORK/en.txt" "$en"
    local y_en="0.78"
    [[ -n "$kn2" ]] && y_en="0.76"
    filter+=",drawtext=fontfile=${FONT_EN}:textfile=${WORK}/en.txt:fontsize=34:fontcolor=#E8E8E8:borderw=2:bordercolor=black@0.5:x=(w-text_w)/2:y=h*${y_en}"
  fi

  if [[ -n "$accent" ]]; then
    write_text "$WORK/acc.txt" "$accent"
    filter+=",drawtext=fontfile=${FONT_KN}:textfile=${WORK}/acc.txt:fontsize=40:fontcolor=#FFE566:borderw=2:bordercolor=black@0.55:x=(w-text_w)/2:y=h*0.86"
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

# 1 — Pattern interrupt + qualify
make_segment "$AGRI1" 0 "$WORK/s01.mp4" \
  "ಕಲಬುರಗಿ ಏರ್‌ಪೋರ್ಟ್ ಹತ್ತಿರ" \
  "ನಿಮ್ಮ ಕೃಷಿ ಜಮೀನು ಇದೆಯಾ?" \
  "Sell agri land near Kalaburagi Airport?"

# 2 — Geography + demand
make_segment "$AIRPORT" 1 "$WORK/s02.mp4" \
  "25 ಕಿ.ಮೀ ಒಳಗೆ" \
  "ಬೇಡಿಕೆ & ಬೆಲೆ ಹೆಚ್ಚುತ್ತಿದೆ" \
  "High-demand zone — prices rising"

# 3 — Social proof
make_segment "$RIVERSIDE" 2 "$WORK/s03.mp4" \
  "ನಿಜವಾದ ಖರೀದಿದಾರರು" \
  "ನಿಮ್ಮ ಸಮಯಕ್ಕೆ ಸಿದ್ಧ" \
  "Serious buyers waiting now"

# 4 — Risk reversal (free valuation)
make_segment "$RIVERSIDE" 6 "$WORK/s04.mp4" \
  "ಉಚಿತ ಜಮೀನು ಮೌಲ್ಯಮಾಪನ" \
  "ಯಾವ ಬಂಧನವಿಲ್ಲ" \
  "Free valuation · No obligation" \
  "ಇಂದೇ ಕೇಳಿ"

# 5 — Benefit / urgency
make_segment "$RIVERSIDE" 11 "$WORK/s05.mp4" \
  "ಸ್ಥಳ ಮೌಲ್ಯ ಹೆಚ್ಚಾಗುತ್ತಿದೆ" \
  "ಮಾರಲು ಈಗ ಸರಿಯಾದ ಸಮಯ" \
  "Get the best price for your land"

# 6 — Hard CTA
write_text "$WORK/cta_kn1.txt" "ಇಂದೇ ಸಂದೇಶ ಕಳುಹಿಸಿ"
write_text "$WORK/cta_kn2.txt" "ಕಾಮೆಂಟ್ ಮಾಡಿ"
write_text "$WORK/cta_sell.txt" "SELL"
write_text "$WORK/cta_en.txt" "DM GulbargaHomes now"

CTA_FILTER="${VF_BASE},trim=0:${DUR},setpts=PTS-STARTPTS,"
CTA_FILTER+="drawbox=x=0:y=0:w=iw:h=ih:color=black@0.55:t=fill,"
CTA_FILTER+="drawbox=x=(iw-920)/2:y=h*0.52:w=920:h=420:color=#1B5E20@0.92:t=fill,"
CTA_FILTER+="drawtext=fontfile=${FONT_KN}:textfile=${WORK}/cta_kn1.txt:fontsize=50:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.54,"
CTA_FILTER+="drawtext=fontfile=${FONT_KN}:textfile=${WORK}/cta_kn2.txt:fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.62,"
CTA_FILTER+="drawtext=fontfile=${FONT_EN}:textfile=${WORK}/cta_sell.txt:fontsize=72:fontcolor=#7CFF7C:borderw=4:bordercolor=black@0.65:x=(w-text_w)/2:y=h*0.71,"
CTA_FILTER+="drawtext=fontfile=${FONT_EN}:textfile=${WORK}/cta_en.txt:fontsize=32:fontcolor=#E0E0E0:borderw=2:bordercolor=black@0.5:x=(w-text_w)/2:y=h*0.80"

ffmpeg -y -hide_banner -loglevel error \
  -ss 15 -i "$RIVERSIDE" \
  -vf "$CTA_FILTER" \
  -t "$DUR" -an \
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
  "$WORK/s06.mp4"

printf "file '%s'\n" "$WORK/s01.mp4" "$WORK/s02.mp4" "$WORK/s03.mp4" "$WORK/s04.mp4" "$WORK/s05.mp4" "$WORK/s06.mp4" >"$WORK/concat.txt"

ffmpeg -y -hide_banner -loglevel error \
  -f concat -safe 0 -i "$WORK/concat.txt" \
  -c copy \
  "$WORK/nosound.mp4"

TOTAL_DUR="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WORK/nosound.mp4")"

MUSIC="$WORK/music.mp3"
if curl -fsSL --max-time 25 \
  "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8cb753ed36.mp3?filename=ambient-lounge-14085.mp3" \
  -o "$MUSIC" 2>/dev/null; then
  ffmpeg -y -hide_banner -loglevel error \
    -i "$WORK/nosound.mp4" -stream_loop -1 -i "$MUSIC" \
    -filter_complex "[1:a]volume=0.18,afade=t=out:st=$(awk -v d="$TOTAL_DUR" 'BEGIN{print d-0.5}'):d=0.5[a]" \
    -map 0:v -map "[a]" -shortest \
    -c:v copy -c:a aac -b:a 128k \
    "$ARTIFACT"
else
  ffmpeg -y -hide_banner -loglevel error \
    -i "$WORK/nosound.mp4" \
    -f lavfi -i "sine=frequency=130:duration=${TOTAL_DUR},volume=0.04" \
    -f lavfi -i "sine=frequency=196:duration=${TOTAL_DUR},volume=0.02" \
    -filter_complex "[1:a][2:a]amix=inputs=2:duration=shortest,lowpass=f=600,afade=t=in:st=0:d=0.8,afade=t=out:st=$(awk -v d="$TOTAL_DUR" 'BEGIN{print d-0.9}'):d=0.9[a]" \
    -map 0:v -map "[a]" -shortest \
    -c:v copy -c:a aac -b:a 96k \
    "$ARTIFACT"
fi

cp "$ARTIFACT" "$REPO_COPY"

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$ARTIFACT"

rm -rf "$WORK"
echo "Wrote: $ARTIFACT"
echo "Wrote: $REPO_COPY"