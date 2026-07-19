#!/usr/bin/env bash
# Android AAR Build Script
# Prerequisites: install cargo-ndk (cargo install cargo-ndk)
#                configure NDK path (ANDROID_NDK_HOME)

# Default NDK path (fallback if unset)
export ANDROID_NDK_HOME="${ANDROID_NDK_HOME:-$LOCALAPPDATA/Android/Sdk/ndk/27.1.12297006}"

set -e

TARGETS=(
    "aarch64-linux-android"    # ARM64 (main physical devices)
    "armv7-linux-androideabi"  # ARM32 (legacy devices)
    "x86_64-linux-android"     # Emulator
)

OUTPUT_DIR="../app/android/app/libs"
LIB_NAME="libwallet_core"

# Reproducible Build (R2-b): Deterministic compilation
#  - SOURCE_DATE_EPOCH: Fix archive/timestamp lower bound (1980-01-01)
#  - RUSTFLAGS remap-path-prefix: Remove build machine absolute paths from the binary (machine-independent)
#  - --locked: Use dependencies exactly matching the committed Cargo.lock (prevent version drift)
# * This script assumes execution from rust-core/ (based on relative paths ../app, target/).
export SOURCE_DATE_EPOCH=315532800
REPO_ROOT="$(cd .. && pwd)"                       # Repo root (includes rust-core + vendors)
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=${REPO_ROOT}=/build --remap-path-prefix=${CARGO_HOME_DIR}=/cargo"

echo "▶ Starting Rust target compilation..."
for TARGET in "${TARGETS[@]}"; do
    echo "  → $TARGET"
    cargo ndk -t "$TARGET" -o ./jniLibs build --release -p ffi --locked
done

echo "▶ Packaging AAR..."
mkdir -p aar_build/jni

# AndroidManifest.xml (Required for AAR)
printf '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.walletcore.lib" />' \
    > aar_build/AndroidManifest.xml

# classes.jar (Required for AAR - empty jar) - Reproducible Build (R2-b): Fixed timestamp/permissions
python -c "
import zipfile
zi = zipfile.ZipInfo('META-INF/MANIFEST.MF', date_time=(1980,1,1,0,0,0))
zi.compress_type = zipfile.ZIP_DEFLATED
zi.external_attr = (0o644 & 0xFFFF) << 16
with zipfile.ZipFile('aar_build/classes.jar', 'w') as z:
    z.writestr(zi, 'Manifest-Version: 1.0\n')
"

for TARGET in "${TARGETS[@]}"; do
    ABI=$(echo "$TARGET" | sed 's/aarch64-linux-android/arm64-v8a/' \
                               | sed 's/armv7-linux-androideabi/armeabi-v7a/' \
                               | sed 's/x86_64-linux-android/x86_64/')
    mkdir -p "aar_build/jni/$ABI"
    cp "target/$TARGET/release/${LIB_NAME}.so" "aar_build/jni/$ABI/libuniffi_wallet_core.so"
done

# Generate UniFFI Kotlin bindings (For copying outside AAR - kotlin/ is not included in AAR)
cargo run --features=uniffi/cli --bin uniffi-bindgen generate \
    crates/ffi/src/wallet_core.udl \
    --language kotlin \
    --out-dir aar_build/kotlin

# AAR packaging - excluding kotlin/ (source files are copied directly to app source tree)
python -c "
import zipfile, os
src = 'aar_build'
dst = '${OUTPUT_DIR}/lib_wallet_core.aar'
os.makedirs(os.path.dirname(dst), exist_ok=True)
# Reproducible Build (R2-b): Sort file order + fixed timestamp/permissions -> zip byte determinism
entries = []
for root, dirs, files in os.walk(src):
    dirs[:] = [d for d in dirs if d != 'kotlin']  # Exclude kotlin/
    for f in files:
        full = os.path.join(root, f)
        arc = os.path.relpath(full, src).replace(os.sep, '/')
        entries.append((arc, full))
entries.sort()
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
    for arc, full in entries:
        zi = zipfile.ZipInfo(arc, date_time=(1980,1,1,0,0,0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = (0o644 & 0xFFFF) << 16
        with open(full, 'rb') as fh:
            z.writestr(zi, fh.read())
print('AAR written to', dst)
"

# Copy Kotlin bindings to the app source tree
KOTLIN_DST="../app/android/app/src/main/java/uniffi/wallet_core"
mkdir -p "$KOTLIN_DST"
cp -r aar_build/kotlin/uniffi/wallet_core/. "$KOTLIN_DST/"
echo "Kotlin bindings copied to $KOTLIN_DST"

rm -rf aar_build

echo "✅ Completed: ${OUTPUT_DIR}/lib_wallet_core.aar"
