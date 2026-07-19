# Fixed Linux environment for Reproducible Build — BTCMobickWatch
#
# Purpose: Eliminate host OS/path differences so anyone building gets identical outputs
#          by providing a Linux environment with all tool versions fixed.
#
# ✅ Status: Verified (2026-07-13). 2 clean container builds using this image confirmed
#          all entry bytes (including engine .so) of APK contents are identical (overall hash differs only by signing block).
#          Actual build succeeded with cmdline-tools 11076708.
#
# Usage (detailed reproduction/verification procedures in BUILD.md Chapter 5):
#   docker build -t btcmobickwatch-build .
#   # Clone and build inside the container to prevent host tree pollution (using :ro for -v is recommended):
#   docker run --rm -v "$PWD":/build:ro -v "$PWD/out":/out \
#     -e BTCMOBICK_KEYSTORE_PROPERTIES=/nonexistent btcmobickwatch-build bash -lc '\
#     git config --global --add safe.directory /build && \
#     git clone -q /build /work && cd /work && \
#     git submodule update --init --recursive && \
#     cd rust-core && bash scripts/build_android.sh && \
#     cd /work/app && npm ci && cd android && chmod +x gradlew && \
#     ./gradlew --no-daemon assembleRelease && \
#     cp app/build/outputs/apk/release/*.apk /out/'

FROM eclipse-temurin:17-jdk-jammy

# --- Fixed Versions (Matching BUILD.md) ---
ARG NDK_VERSION=27.1.12297006
ARG BUILDTOOLS_VERSION=36.0.0
ARG PLATFORM_VERSION=36
ARG CMDLINE_TOOLS_VERSION=11076708   # commandlinetools-linux-<ver>_latest.zip (verify latest when building)
ARG RUST_VERSION=1.96.0
ARG CARGO_NDK_VERSION=4.1.2
ARG NODE_MAJOR=20

ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV ANDROID_NDK_HOME=${ANDROID_SDK_ROOT}/ndk/${NDK_VERSION}
ENV PATH=${PATH}:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:/root/.cargo/bin

# --- Base Packages (python is required for AAR packaging in build_android.sh) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl unzip git python3 ca-certificates build-essential && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# --- Node.js ${NODE_MAJOR}.x ---
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# --- Android SDK: cmdline-tools -> platform-tools / platform / build-tools / NDK ---
RUN mkdir -p "${ANDROID_SDK_ROOT}/cmdline-tools" && \
    curl -fsSL -o /tmp/cmdline.zip \
        "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" && \
    unzip -q /tmp/cmdline.zip -d "${ANDROID_SDK_ROOT}/cmdline-tools" && \
    mv "${ANDROID_SDK_ROOT}/cmdline-tools/cmdline-tools" "${ANDROID_SDK_ROOT}/cmdline-tools/latest" && \
    rm /tmp/cmdline.zip && \
    yes | sdkmanager --licenses >/dev/null && \
    sdkmanager \
        "platform-tools" \
        "platforms;android-${PLATFORM_VERSION}" \
        "build-tools;${BUILDTOOLS_VERSION}" \
        "ndk;${NDK_VERSION}"

# --- Rust: Fix rustc ${RUST_VERSION} + Android targets + cargo-ndk ---
# (Although rust-core/rust-toolchain.toml forces 1.96.0, preinstall here for caching)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
        sh -s -- -y --default-toolchain "${RUST_VERSION}" --profile minimal && \
    rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android && \
    cargo install cargo-ndk --version "${CARGO_NDK_VERSION}" --locked

WORKDIR /build
