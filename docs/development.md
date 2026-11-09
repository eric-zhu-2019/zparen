# Develop and release

## Build from the source

You need Node.js, Rust and SBCL. ZParen looks for `sbcl` on `PATH`.
Release builds carry their own SBCL, so they run on Macs without one.

To build and open the app:

```sh
npm install
npx tauri build --bundles app
open target/release/bundle/macos/ZParen.app
```

For development, run `npx tauri dev`.

The first start builds an SBCL core with Swank preloaded and caches it in
`~/Library/Caches/ZParen`. That takes about two seconds. Later starts take
milliseconds, and the core rebuilds by itself when SBCL or the bundled Lisp
files change.

## Checks

`scripts/verify.sh` runs every check: the Rust tests against a real SBCL, the
parinfer wasm tests, the TypeScript tests, and the WebKit end-to-end tests.
Add `--network` to include the ocicl test, which downloads from `ghcr.io`.

The app runs on macOS only. The Rust core and `zparen-dev` also build on
Linux. `.github/workflows/linux.yml` runs their tests there, and the TypeScript
tests, for each pull request. On Linux, ZParen keeps its data in
`~/.local/share/zparen` and its cache in `~/.cache/zparen`, or under
`$XDG_DATA_HOME` and `$XDG_CACHE_HOME`.

To run the UI in a browser against a real SBCL, start the bridge and Vite:

```sh
cargo run -p zparen-dev
npx vite --port 1420
```

Set `ZPAREN_TRACE=1` to log every Swank message.

## Release from GitHub

Pushing a tag such as `v0.1.7` starts `.github/workflows/release.yml`. The tag
must match the version in `src-tauri/tauri.conf.json`. To prepare a release,
set the same version in `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` and `Cargo.lock`.

The workflow has two jobs:

1. **build** runs `scripts/verify.sh` and builds `ZParen.app` with no secret
   in reach.
2. **sign** signs the app and its disk image with `scripts/sign.sh`, has
   Apple notarize the disk image, staples the ticket, and publishes the
   release. No npm or cargo code runs in this job.

The sign job reads these repository secrets:

| Secret | Holds |
| --- | --- |
| `MACOS_CERTIFICATE` | The Developer ID Application certificate and key, as a base64 `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` password |
| `APPLE_API_KEY` | An App Store Connect API key (`.p8`) with the Developer role |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys in App Store Connect |

Without the three `APPLE_API_*` secrets, the release is signed but not
notarized, and its notes say how to open it the first time.

## Release from your Mac

`scripts/release.sh` builds `ZParen.app` and its disk image, signs both with
a Developer ID, and checks the signatures. The app carries a copy of the
installed SBCL (`scripts/bundle-sbcl.sh`), so it runs on Macs without SBCL. That
copy is signed with the hardened runtime and the entitlements SBCL needs to
compile code.

```sh
security find-identity -v -p codesigning            # pick a Developer ID Application identity
ZPAREN_SIGN_IDENTITY="Developer ID Application: …" scripts/release.sh
```

To notarize, save notarytool credentials once, then pass the profile:

```sh
xcrun notarytool store-credentials zparen --apple-id you@example.com --team-id TEAMID
ZPAREN_SIGN_IDENTITY="…" NOTARY_PROFILE=zparen scripts/release.sh
```

The script submits the disk image, waits for Apple, and staples the ticket to
the image and the app, so Gatekeeper opens them offline.

To ship updates, make a key pair once with `npx tauri signer generate` and
keep the private half safe. Builds made with the update variables check for a
newer release when they start and from ZParen ▸ Check for Updates…, and install only
archives signed with that key:

```sh
ZPAREN_UPDATE_URL=https://example.com/zparen/latest.json \
ZPAREN_UPDATE_DOWNLOAD=https://example.com/zparen/ZParen.app.tar.gz \
ZPAREN_UPDATE_PUBKEY="$(cat zparen.key.pub)" TAURI_SIGNING_PRIVATE_KEY="$(cat zparen.key)" \
ZPAREN_SIGN_IDENTITY="…" scripts/release.sh
```

The script writes `latest.json` beside the archive. Publish both at those
URLs. A build without these variables has updates turned off and says so.

### Updates from GitHub releases

The release workflow ships updates when they are set up. Do this once:

1. Make the key pair: `npx tauri signer generate -w ~/.tauri/zparen.key`.
   Keep the private half and its password safe. A lost key means that apps
   already installed can never update again.
2. In the repository settings, add the variable `ZPAREN_UPDATE_PUBKEY`. Its
   value is the content of `~/.tauri/zparen.key.pub`.
3. In the `release` environment, add the secrets `TAURI_SIGNING_PRIVATE_KEY`
   (the content of `~/.tauri/zparen.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Then each release is built to read
`releases/latest/download/latest.json` from this repository. After the sign job
deletes the certificate's keychain, `scripts/update-archive.sh` packs the signed
app as `ZParen.app.tar.gz`, signs it with the update key and writes
`latest.json`. Both files go into the release with the disk image. A build from
before the variable was set has no updates. Its users download the next disk
image once, and update from the app after that.

## The website

The website at https://eric-zhu-2019.github.io/zparen/ is the landing page in
`site/` plus a page for each file in `docs/`. `scripts/build-site.mjs` builds
it into one folder, and the Pages workflow publishes it when a push to `main`
changes `site/`, `docs/`, the icon or the script. To look at it before you
push, build it, serve the folder, and open http://localhost:8000:

```sh
node scripts/build-site.mjs _site
python3 -m http.server --directory _site 8000
```

A link from one doc to another, such as `editing.md#keys`, becomes a link
between their pages. A link to any other file in the repository goes to that
file on GitHub.
