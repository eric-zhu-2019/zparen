#!/bin/bash
# Packs a signed ZParen.app as the archive the in-app updater installs, signs
# the archive with the update key, and writes latest.json, which names it.
# All three files go next to the app.
# Usage: TAURI_SIGNING_PRIVATE_KEY=<key> [TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<password>] \
#   scripts/update-archive.sh path/to/ZParen.app <version> <archive download URL>
set -euo pipefail
app=$1 version=$2 url=$3
: "${TAURI_SIGNING_PRIVATE_KEY:?set TAURI_SIGNING_PRIVATE_KEY to the private half of the update key}"
dir=$(cd "$(dirname "$app")" && pwd)
archive="$dir/ZParen.app.tar.gz"

# Without COPYFILE_DISABLE, macOS tar adds ._ files for extended attributes.
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$dir" "$(basename "$app")"
npx tauri signer sign --app-version "$version" "$archive" > /dev/null

# Empty notes let the app say its own words: save your work, it restarts.
SIGNATURE="$(cat "$archive.sig")" VERSION="$version" URL="$url" python3 - > "$dir/latest.json" <<'PY'
import datetime, json, os
print(json.dumps({
    "version": os.environ["VERSION"],
    "notes": "",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"darwin-aarch64": {"signature": os.environ["SIGNATURE"], "url": os.environ["URL"]}},
}, indent=2))
PY
echo "== update archive $archive, manifest $dir/latest.json"
