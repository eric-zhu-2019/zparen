#!/bin/bash
# Copies the installed SBCL into src-tauri/sbcl, for the app to carry when the
# Mac it runs on has none: the runtime, its zstd library (made relative so it
# needs no Homebrew), the core and the contribs, and their licenses.
set -euo pipefail
cd "$(dirname "$0")/.."

out=src-tauri/sbcl

# Linux has no Homebrew SBCL to copy, so the app carries SBCL's own x86-64 Linux
# build. It needs only libc. To change the version, change both lines: the hash is
# the .tar's SHA-256 from the release's signed sbcl-<version>-crhodes.asc.
if [ "$(uname -s)" = Linux ]; then
  version=2.6.9
  tar_sha256=c6265653fc4e34f72b20d36e3851d696f2aee624059575711b6069095de22cd4
  if [ "$(uname -m)" != x86_64 ]; then
    echo "bundle-sbcl: SBCL has no $(uname -m) Linux build; the app will use the SBCL it finds when it runs" >&2
    rm -rf "$out" && mkdir -p "$out"
    exit 0
  fi
  stamp="sbcl-$version-x86-64-linux"
  if [ -f "$out/VERSION" ] && [ "$(cat "$out/VERSION")" = "$stamp" ]; then
    exit 0
  fi
  cache=${XDG_CACHE_HOME:-$HOME/.cache}/zparen-build
  archive="$cache/$stamp-binary.tar.bz2"
  mkdir -p "$cache"
  if [ ! -f "$archive" ] || [ "$(bunzip2 -c "$archive" | sha256sum | cut -d' ' -f1)" != "$tar_sha256" ]; then
    curl -fsSL -o "$archive.part" "https://downloads.sourceforge.net/project/sbcl/sbcl/$version/$stamp-binary.tar.bz2"
    mv "$archive.part" "$archive"
  fi
  if [ "$(bunzip2 -c "$archive" | sha256sum | cut -d' ' -f1)" != "$tar_sha256" ]; then
    echo "bundle-sbcl: $archive does not match the SHA-256 that SBCL published" >&2
    exit 1
  fi
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  tar xjf "$archive" -C "$work"
  rm -rf "$out"
  (dest=$PWD/$out && cd "$work/$stamp" && INSTALL_ROOT="$dest" sh install.sh >/dev/null)
  rm -rf "$out/share"
  cp "$work/$stamp/COPYING" "$out/SBCL-COPYING"
  echo "$stamp" > "$out/VERSION"
  SBCL_HOME="$out/lib/sbcl" "$out/bin/sbcl" --noinform --non-interactive --no-userinit \
    --eval '(require :sb-introspect)' --eval '(format t "bundle-sbcl: SBCL ~a bundled~%" (lisp-implementation-version))'
  exit 0
fi

prefix=$(brew --prefix sbcl 2>/dev/null || true)
if [ -z "$prefix" ] || [ ! -d "$prefix" ]; then
  echo "bundle-sbcl: no Homebrew SBCL; the app will use the SBCL it finds when it runs" >&2
  rm -rf "$out" && mkdir -p "$out"
  exit 0
fi
cellar=$(cd "$prefix" && pwd -P)
# ZPAREN_SIGN_IDENTITY signs the bundle for distribution; without it, an ad hoc signature runs locally.
identity=${ZPAREN_SIGN_IDENTITY:--}
stamp="$(basename "$cellar") signed:$identity"
if [ -f "$out/VERSION" ] && [ "$(cat "$out/VERSION")" = "$stamp" ]; then
  exit 0
fi

rm -rf "$out"
mkdir -p "$out/bin" "$out/lib"
cp "$cellar/libexec/bin/sbcl" "$out/bin/sbcl"
cp -R "$cellar/lib/sbcl" "$out/lib/sbcl"
rm -f "$out/lib/sbcl/sbclrc"
# Homebrew's files are read-only, and signing the app needs to clear their attributes.
chmod -R u+w "$out"

zstd=$(otool -L "$out/bin/sbcl" | awk '/libzstd/ {print $1}')
if [ -n "$zstd" ]; then
  cp "$(cd "$(dirname "$zstd")" && pwd -P)/$(basename "$zstd")" "$out/lib/"
  chmod u+w "$out/lib/$(basename "$zstd")"
  install_name_tool -id "@loader_path/../lib/$(basename "$zstd")" "$out/lib/$(basename "$zstd")"
  install_name_tool -change "$zstd" "@executable_path/../lib/$(basename "$zstd")" "$out/bin/sbcl"
fi
# Changing load paths breaks the signatures, and arm64 Macs refuse unsigned code.
# Notarization needs the hardened runtime and a timestamp, and SBCL its entitlements.
if [ "$identity" = "-" ]; then
  codesign --force --sign - "$out/lib/"*.dylib "$out/bin/sbcl" 2>/dev/null
else
  codesign --force --options runtime --timestamp --sign "$identity" "$out/lib/"*.dylib
  codesign --force --options runtime --timestamp --entitlements src-tauri/sbcl.entitlements --sign "$identity" "$out/bin/sbcl"
fi

zstd_prefix=$(brew --prefix zstd 2>/dev/null || true)
cp "$cellar/COPYING" "$out/SBCL-COPYING" 2>/dev/null || cp "$cellar/share/doc/sbcl/COPYING" "$out/SBCL-COPYING" 2>/dev/null || true
[ -n "$zstd_prefix" ] && cp "$zstd_prefix/LICENSE" "$out/ZSTD-LICENSE" 2>/dev/null || true
echo "$stamp" > "$out/VERSION"

SBCL_HOME="$out/lib/sbcl" "$out/bin/sbcl" --noinform --non-interactive --no-userinit \
  --eval '(require :sb-introspect)' --eval '(format t "bundle-sbcl: SBCL ~a bundled~%" (lisp-implementation-version))'
