#!/usr/bin/env bash
#
# Converts the source images queued by fetch-assets.ts into browser-readable
# textures. The source normal maps and the USGS mosaics are TIFF/GeoTIFF, which
# no browser can decode, and the mosaics are far larger than we need.
#
# Queue format (.cache/convert-queue.tsv):
#   <source>\t<dest>\t<max dimension>\t<ops>
#
# where <ops> is a possibly-empty comma-separated list of `roll:<amount>` and
# `flop`. One field rather than one per operation on purpose: `read` collapses
# runs of tabs, so an empty column in the middle shifts everything after it.
#
# Uses macOS `sips` when available, otherwise ImageMagick. Rolling, flopping and
# OpenEXR all need ImageMagick specifically, so those entries fall back to it
# even on a Mac.

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

while IFS=$'\t' read -r src dest maxdim ops; do
  [[ -z "${src:-}" ]] && continue

  roll=""
  flop=""
  ops="${ops:-}"
  # Unquoted on purpose: the commas become spaces and the shell splits on them.
  for op in ${ops//,/ }; do
    case "$op" in
      roll:*) roll="${op#roll:}" ;;
      flop)   flop=1 ;;
    esac
  done
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

  # Three things sips cannot do: roll a map whose left edge is 0 degrees rather
  # than 180 west, mirror one whose longitude runs the other way, and decode
  # OpenEXR. Any of them sends the job to ImageMagick.
  needs_magick=""
  [[ -n "${roll:-}" || -n "${flop:-}" ]] && needs_magick=1
  case "$src" in *.exr|*.EXR) needs_magick=1 ;; esac

  if [[ -n "$needs_magick" ]]; then
    if [[ "$CONVERTER" == "sips" ]]; then
      if command -v magick >/dev/null 2>&1; then IM=magick
      elif command -v convert >/dev/null 2>&1; then IM=convert
      else
        echo "SKIPPED (needs ImageMagick)"
        failed=$((failed + 1))
        continue
      fi
    else
      IM="$CONVERTER"
    fi

    # `[0]` picks the full-resolution page: the USGS basemaps are pyramidal
    # TIFFs, so without it one file per overview level comes out.
    args=("${src}[0]")
    case "$src" in
      *.exr|*.EXR)
        # OpenEXR is linear light. ImageMagick tags it sRGB regardless, so the
        # source has to be declared linear before the encode or the transfer
        # never happens and the whole image collapses toward black.
        args+=(-set colorspace RGB -colorspace sRGB)
        ;;
    esac
    [[ -n "${roll:-}" ]] && args+=(-roll "+${roll}+0")
    [[ -n "${flop:-}" ]] && args+=(-flop)
    args+=(-resize "${maxdim}x${maxdim}>" -quality 92 "$dest")
    "$IM" "${args[@]}" >/dev/null 2>&1
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
