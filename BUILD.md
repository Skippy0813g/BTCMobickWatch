**English** · [한국어](BUILD.ko.md)

# BUILD — Building from source

This is a **watch-only** wallet: it does not store private keys.

The source is public so that **anyone can verify the distributed APK was built from it**.
The core logic — balance lookups, PSBT construction — lives in a Rust engine (`rust-core`),
and the steps below build that engine from source too. There are no prebuilt binaries in
this repository.

---

## 1. Requirements

These are the versions used for the official release build. Use the same ones to reproduce it.
The [`Dockerfile`](./Dockerfile) pins all of them, so **if you are verifying rather than
developing, you only need the container procedure in section 5.**

| Tool | Version | Notes |
|------|---------|-------|
| Rust (rustc/cargo) | 1.96.0 | pinned by `rust-core/rust-toolchain.toml` |
| cargo-ndk | 4.1.2 | `cargo install cargo-ndk --version 4.1.2` |
| Android NDK | 27.1.12297006 | set via `ANDROID_NDK_HOME` |
| Android SDK | compileSdk 36, buildTools 36.0.0 | |
| JDK | 17 | Temurin/OpenJDK 17.0.x |
| Node.js | 20.19.x | npm 10.8.x |
| Gradle | 9.3.1 | used automatically via the wrapper |
| Kotlin | 2.1.20 | used automatically by Gradle |

Rust Android targets (declared in `rust-toolchain.toml`, installed automatically by rustup):
`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`

> During the Gradle build, NDK **27.0.12077973** is downloaded as well. One of the
> dependencies requires it. This happens identically on every build and does not affect
> reproducibility.

---

## 2. Getting the source

The Rust engine depends on forks of rust-bitcoin and BDK, included as **git submodules**.

```bash
git clone --recursive https://github.com/Skippy0813g/BTCMobickWatch.git
cd BTCMobickWatch

# if you already cloned without --recursive
git submodule update --init --recursive
```

> Without `--recursive` the submodules are empty and the engine build fails.
> Use `git submodule status` to confirm they sit at the pinned commits.

### Seeing what the forks changed

Both submodules are GitHub forks of their upstream projects, with a single commit on top of
an upstream release commit. The complete diff is one command away:

```bash
cd vendors/rust-bitcoin-btcmobick && git diff bitcoin-0.32.101..HEAD
cd ../bdk-btcmobick              && git diff 03a08bb7..HEAD
```

| Submodule | Upstream | Branch point |
|---|---|---|
| `vendors/rust-bitcoin-btcmobick` | [rust-bitcoin](https://github.com/rust-bitcoin/rust-bitcoin) | tag `bitcoin-0.32.101` |
| `vendors/bdk-btcmobick` | [bdk](https://github.com/bitcoindevkit/bdk) | `03a08bb7` (`bdk_wallet` 1.0.0) |

---

## 3. Building the Rust engine

This compiles three ABIs (arm64, armv7, x86_64), packages them into an `.aar`, and copies the
UniFFI Kotlin bindings into the app source tree.

```bash
cd rust-core
export ANDROID_NDK_HOME="/path/to/Android/Sdk/ndk/27.1.12297006"
bash scripts/build_android.sh
```

Outputs:
- `app/android/app/libs/lib_wallet_core.aar` — the native engine
- `app/android/app/src/main/java/uniffi/wallet_core/` — Kotlin bindings

> For reproducibility the script uses `--locked` (forcing the committed `Cargo.lock`),
> `--remap-path-prefix` (stripping build machine paths), and fixed archive timestamps.

---

## 4. Building the app

```bash
cd app
npm ci

cd android
./gradlew assembleRelease     # APK
./gradlew bundleRelease       # AAB
```

Output: `app/android/app/build/outputs/apk/release/app-release.apk`

> Without `keystore.properties`, Gradle falls back to signing with the debug key. The official
> APK is signed with the developer's release key, which is not published. So when comparing
> your build against the official APK, compare **contents excluding the signature** (section 5).

---

## 5. Integrity verification

How to confirm the distributed APK came from this source.

### What is supposed to differ

An APK is **[contents] + [signature block]**.

- **Contents** come from this source. Build it yourself and they reproduce byte for byte.
- **The signature block** is produced with a private release key. Even signing with the same
  key produces different signature bytes each time.

So **the whole-file hash can never match.** Comparison is done on contents.

> ### The most common misunderstanding
>
> The **APK SHA-256** in the release notes tells you whether the file you downloaded is intact.
> **It is not the value to compare your own build against** — that will always differ.
>
> The value used for reproducible-build comparison is the **content digest** in the release notes.

### How the content digest is computed

1. Walk the APK (zip) entries in stored order
2. Skip directory entries and v1 (JAR) signature files
   (`META-INF/MANIFEST.MF`, `META-INF/*.SF`, `*.RSA`, `*.DSA`, `*.EC`)
3. For each entry emit one line: `"<sha256 hex of contents>  <entry name>\n"`
4. The sha256 of all those lines concatenated is the digest

The v2 signature block lives outside the zip entries, so it is never included.

The algorithm is spelled out so that **you do not have to trust this repository's script.**
Implement it yourself, or cross-check with a third-party tool such as `diffoscope`; the
conclusion should be the same. If it is not, that itself is worth reporting.

### Build in the container

Reproducible builds are sensitive to the host environment. **Building directly on your host
bakes absolute build-machine paths into the binaries** and produces different bytes (this is
especially true on Windows). Both the official release and any verification build are done in
the environment defined by this repository's [`Dockerfile`](./Dockerfile).

```sh
# 1) build the verification image (all tool versions pinned)
docker build -t btcmobickwatch-build .

# 2) build engine → APK inside a clean clone in the container
#    on a Windows host, write the -v paths as "D:\path:/build:ro"
docker run --rm -v "$PWD:/build:ro" -v "$PWD/out:/out" \
  -e BTCMOBICK_KEYSTORE_PROPERTIES=/nonexistent \
  btcmobickwatch-build bash -lc '
    git config --global --add safe.directory /build
    git clone -q /build /work && cd /work
    git submodule update --init --recursive
    cd rust-core && bash scripts/build_android.sh
    cd /work/app && npm ci
    cd android && chmod +x gradlew && ./gradlew --no-daemon assembleRelease
    cp app/build/outputs/apk/release/*.apk /out/'
```

> `BTCMOBICK_KEYSTORE_PROPERTIES=/nonexistent` forces the debug-signing fallback, so that
> third parties without the release key can still reproduce and compare the contents.

### Comparing

```sh
# print the content digest and compare it with the release notes
scripts/verify-reproducible.sh digest out/app-release.apk

# or download the official APK and compare the two directly
scripts/verify-reproducible.sh compare <official.apk> out/app-release.apk
```

With a third-party tool: `diffoscope <official.apk> <yours.apk>`. It passes if it reports
**identical archive contents** and the differences fall **only inside the signature block**.

### If the result differs

Please check these before reporting. Most mismatches are explained here.

| Symptom | Cause |
|---------|-------|
| The whole-file hash differs | **Expected.** That is the signature block. Compare the content digest instead. |
| The contents differ entirely | Likely built outside the container. Build machine paths get baked into the binaries. |
| Some entries differ | The submodules may not be at their pinned commits. Check `git submodule status`. |
| Fewer entries than the official APK | Likely you extracted the archive on Windows or macOS. Entries differing only in case (`res/9n.9.png` vs `res/9N.9.png`) collide and are silently dropped. Read entries from the zip instead of extracting. |

Even if the bytes do not match exactly, the source is public: anyone can audit the logic and
run an APK they built themselves.

---

## License

MIT License — see [`LICENSE`](./LICENSE). Provided AS IS, without warranty.
