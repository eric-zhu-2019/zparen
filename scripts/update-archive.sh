#!/bin/bash
# Packs a signed ZParen.app as the archive the in-app updater installs, signs
# the archive with the update key, and writes latest.json, which names it.
# All three files go next to the app. With a Linux AppImage and its URL, it
# also signs the AppImage (.sig next to it) and names it in latest.json.
# Usage: TAURI_SIGNING_PRIVATE_KEY=<key> [TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>] \
#   scripts/update-archive.sh path/to/ZParen.app <version> <archive download URL> \
#   [path/to/ZParen.AppImage <AppImage download URL>]
set -euo pipefail
app=$1 version=$2 url=$3 appimage=${4:-} appimage_url=${5:-}
: "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY to the private half of the update key}"
dir=$(cd "$(dirname "$app")" && pwd)
archive="$dir/ZParen.app.tar.gz"

# Without COPYFILE_DISABLE, macOS tar adds ._ files for extended attributes.
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$dir" "$(basename "$app")"
npx tauri signer sign --app-version "$version" "$archive" > /dev/null
appimage_sig=""
if [ -n "$appimage" ]; then
  npx tauri signer sign --app-version "$version" "$appimage" > /dev/null
  appimage_sig=$(cat "$appimage.sig")
fi

# Empty notes let the app say its own words: save your work, it restarts.
# Only the AppImage updates itself on Linux, so no .deb or .rpm target is named.
SIGNATURE="$(cat "$archive.sig")" VERSION="$version" URL="$url" \
  APPIMAGE_SIGNATURE="$appimage_sig" APPIMAGE_URL="$appimage_url" python3 - > "$dir/latest.json" <<'PY'
import datetime, json, os
platforms = {"darwin-aarch64": {"signature": os.environ["SIGNATURE"], "url": os.environ["URL"]}}
if os.environ["APPIMAGE_SIGNATURE"]:
    platforms["linux-x86_64-appimage"] = {"signature": os.environ["APPIMAGE_SIGNATURE"], "url": os.environ["APPIMAGE_URL"]}
print(json.dumps({
    "version": os.environ["VERSION"],
    "notes": "",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": platforms,
}, indent=2))
PY
echo "== update archive $archive, manifest $dir/latest.json"
