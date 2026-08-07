#!/usr/bin/env bash
#
# Converts the source images queued by fetch-assets.ts into browser-readable
# textures. The source normal maps and the USGS mosaics are TIFF/GeoTIFF, which
# no browser can decode, and the mosaics are far larger than we need.
#
# Queue format (.cache/convert-queue.tsv):  <source>\t<dest>\t<max dimension>
#
# Uses macOS `sips` when available, otherwise ImageMagick.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUEUE="$ROOT/.cache/convert-queue.tsv"

if [[ ! -s "$QUEUE" ]]; then
  echo "Nothing queued for conversion."
  exit 0
fi

if command -v sips >/dev/null 2>&1; then
  CONVERTER=sips
elif command -v magick >/dev/null 2>&1; then
  CONVERTER=magick
elif command -v convert >/dev/null 2>&1; then
  CONVERTER=convert
else
  echo "error: need sips (macOS) or ImageMagick to convert TIFF sources." >&2
  echo "       Install ImageMagick, or re-run with --skip-usgs to do without" >&2
  echo "       the moon mosaics (they fall back to procedural textures)." >&2
  exit 1
fi

echo "Converting queued textures with $CONVERTER"

failed=0
converted=0

while IFS=$'\t' read -r src dest maxdim roll; do
  [[ -z "${src:-}" ]] && continue
  if [[ ! -f "$src" ]]; then
    echo "  skip    $(basename "$dest") (source missing)"
    continue
  fi
  if [[ -f "$dest" ]]; then
    echo "  have    $(basename "$dest")"
    continue
  fi

  mkdir -p "$(dirname "$dest")"
  printf '  convert %-24s <- %s ... ' "$(basename "$dest")" "$(basename "$src")"

  case "$dest" in
    *.png) fmt=png ;;
    *)     fmt=jpeg ;;
  esac

  if [[ -n "${roll:-}" ]]; then
    # A source whose left edge is 0 degrees rather than 180 west has to be
    # turned half way round to match every other map here. Only ImageMagick can
    # do it, and `[0]` picks the full-resolution page: these basemaps are
    # pyramidal TIFFs, so without it one file per overview level comes out.
    if [[ "$CONVERTER" == "sips" ]]; then
      if command -v magick >/dev/null 2>&1; then ROLLER=magick
      elif command -v convert >/dev/null 2>&1; then ROLLER=convert
      else
        echo "SKIPPED (needs ImageMagick to roll)"
        failed=$((failed + 1))
        continue
      fi
    else
      ROLLER="$CONVERTER"
    fi
    "$ROLLER" "${src}[0]" -roll "+${roll}+0" -resize "${maxdim}x${maxdim}>" -quality 90 "$dest" >/dev/null 2>&1
  elif [[ "$CONVERTER" == "sips" ]]; then
    if [[ "$fmt" == "jpeg" ]]; then
      sips -s format jpeg -s formatOptions 90 -Z "$maxdim" "$src" --out "$dest" >/dev/null 2>&1
    else
      sips -s format png -Z "$maxdim" "$src" --out "$dest" >/dev/null 2>&1
    fi
  else
    "$CONVERTER" "$src" -resize "${maxdim}x${maxdim}>" -quality 90 "$dest" >/dev/null 2>&1
  fi

  if [[ -s "$dest" ]]; then
    size=$(du -h "$dest" | cut -f1 | tr -d ' ')
    echo "ok ($size)"
    converted=$((converted + 1))
  else
    echo "FAILED"
    rm -f "$dest"
    failed=$((failed + 1))
  fi
done < "$QUEUE"

echo "Converted $converted texture(s)${failed:+, $failed failed}"
[[ $failed -gt 0 ]] && echo "Failed conversions fall back to procedural textures at runtime."
exit 0
