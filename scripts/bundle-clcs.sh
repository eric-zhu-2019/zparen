#!/bin/bash
# Puts the Common Lisp Community Spec in src-tauri/clcs, for the app to carry,
# so the standard's pages show in the Docs panel without Quicklisp. The site
# is MIT licensed and made from the draft standard's sources, which are in the
# public domain. scripts/clcs-pages.mjs keeps only each page's entry, as the
# whole site is 224 MB.
#
# To move to a newer version, change both lines: the commit of
# github.com/cl-community-spec/cl-community-spec.github.io, and the SHA-256 of
# GitHub's tar.gz of that commit.
set -euo pipefail
cd "$(dirname "$0")/.."

out=src-tauri/clcs
commit=5253b8b5ebac21de4c3173ec2e24cab86dd598af
sha256=5b0d5c87d8f8c34b7219e6db4b1246839fad2409859eb22cad33d40ad6f11b6e

sum() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

# The stamp names the transform too, so a change to it makes the pages again.
stamp="$commit $(sum scripts/clcs-pages.mjs 2>/dev/null || true)"
if [ -f "$out/VERSION" ] && [ "$(cat "$out/VERSION")" = "$stamp" ]; then
  exit 0
fi

cache=${XDG_CACHE_HOME:-$HOME/.cache}/zparen-build
archive="$cache/clcs-$commit.tar.gz"
mkdir -p "$cache"
if [ ! -f "$archive" ] || [ "$(sum "$archive")" != "$sha256" ]; then
  curl -fsSL -o "$archive.part" "https://codeload.github.com/cl-community-spec/cl-community-spec.github.io/tar.gz/$commit"
  mv "$archive.part" "$archive"
fi
if [ "$(sum "$archive")" != "$sha256" ]; then
  echo "bundle-clcs: $archive does not match the expected SHA-256" >&2
  exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar xzf "$archive" -C "$work"
rm -rf "$out"
node scripts/clcs-pages.mjs "$work/cl-community-spec.github.io-$commit" "$out"
echo "$stamp" > "$out/VERSION"
