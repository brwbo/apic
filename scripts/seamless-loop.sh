#!/usr/bin/env bash
# Turn a clip into a seamless loop by crossfading its tail back over its head.
#
#   ./scripts/seamless-loop.sh in.webm out.webm [fade_seconds]
#
# The output is (duration - fade) long. The loop point becomes a normal
# frame-to-frame step, so the cut is invisible. Verify with:
#   ffmpeg -i out.webm -vf "select=eq(n\,LAST)" -vframes 1 a.png
#   ffmpeg -i out.webm -vf "select=eq(n\,0)"    -vframes 1 b.png
#   ffmpeg -i a.png -i b.png -lavfi psnr -f null -
# A seam within ~5dB of the file's normal frame-to-frame PSNR reads as seamless.
set -euo pipefail

IN="${1:?usage: seamless-loop.sh in out [fade_seconds]}"
OUT="${2:?usage: seamless-loop.sh in out [fade_seconds]}"
FADE="${3:-0.5}"

FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$IN" | awk -F/ '{print ($2 ? $1/$2 : $1)}')
TOTAL=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$IN")
FADE_FRAMES=$(awk -v f="$FADE" -v r="$FPS" 'BEGIN{printf "%d", f*r}')
MAIN_END=$((TOTAL - FADE_FRAMES))

echo "${TOTAL} frames @ ${FPS}fps -> crossfading last ${FADE_FRAMES} over the first ${FADE_FRAMES}; output ${MAIN_END} frames"

ffmpeg -y -hide_banner -loglevel error -i "$IN" -filter_complex "\
[0:v]split[a][b];\
[a]trim=start_frame=0:end_frame=${MAIN_END},setpts=PTS-STARTPTS,format=yuv420p[main];\
[b]trim=start_frame=${MAIN_END}:end_frame=${TOTAL},setpts=PTS-STARTPTS,format=yuva420p,fade=t=out:st=0:d=${FADE}:alpha=1[tail];\
[main][tail]overlay=eof_action=pass:format=auto,format=yuv420p[v]" \
  -map "[v]" -r "$FPS" -c:v libvpx-vp9 -crf 28 -b:v 0 -row-mt 1 -cpu-used 2 -deadline good -g "$MAIN_END" -an "$OUT"

echo "wrote $OUT"
