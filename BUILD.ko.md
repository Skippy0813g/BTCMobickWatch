[English](BUILD.md) · **한국어**

# BUILD — 소스에서 직접 빌드하기 / Building from source

이 앱은 **워치온리(watch-only)** 지갑입니다 — 개인키를 보관하지 않습니다.

소스를 공개하는 목적은 **배포되는 APK가 이 공개 소스에서 나왔음을 누구나 검증**할 수
있게 하기 위함입니다. 잔액 조회·PSBT 생성 등 핵심 로직은 Rust 엔진(`rust-core`)에
있으며, 아래 절차는 그 엔진까지 소스에서 빌드합니다. 이 저장소에 미리 만들어둔
바이너리는 없습니다.

---

## 1. 요구사항

공식 릴리스 빌드에 사용된 버전입니다. 재현하려면 동일 버전을 쓰세요.
[`Dockerfile`](./Dockerfile)이 이 전부를 고정해 두었으므로, **검증 목적이라면
5번 "무결성 검증"의 컨테이너 절차만 따르면 됩니다.**

| 도구 | 버전 | 비고 |
|------|------|------|
| Rust (rustc/cargo) | 1.96.0 | `rust-core/rust-toolchain.toml`이 고정 |
| cargo-ndk | 4.1.2 | `cargo install cargo-ndk --version 4.1.2` |
| Android NDK | 27.1.12297006 | `ANDROID_NDK_HOME`로 지정 |
| Android SDK | compileSdk 36, buildTools 36.0.0 | |
| JDK | 17 | Temurin/OpenJDK 17.0.x |
| Node.js | 20.19.x | npm 10.8.x |
| Gradle | 9.3.1 | Wrapper가 자동 사용 |
| Kotlin | 2.1.20 | Gradle이 자동 사용 |

Rust 안드로이드 타겟(`rust-toolchain.toml`에 명시, rustup이 자동 설치):
`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`

> Gradle 빌드 중 NDK **27.0.12077973**이 추가로 내려받아집니다. 의존성 중 하나가
> 요구하며, 모든 빌드에서 동일하게 발생하므로 재현성에는 영향이 없습니다.

---

## 2. 소스 가져오기

Rust 엔진은 포크한 rust-bitcoin·BDK에 의존하며 **git 서브모듈**입니다.

```bash
git clone --recursive https://github.com/Skippy0813g/BTCMobickWatch.git
cd BTCMobickWatch

# 이미 클론했다면
git submodule update --init --recursive
```

> `--recursive`를 빠뜨리면 서브모듈이 비어 엔진 빌드가 실패합니다.
> `git submodule status`로 핀 커밋에 있는지 확인할 수 있습니다.

### 포크에서 바뀐 것 확인하기

두 서브모듈은 원본 프로젝트의 GitHub 포크이며, 원본 릴리스 커밋 위에 커밋 하나만
얹혀 있습니다. 전체 변경점을 이렇게 볼 수 있습니다.

```bash
cd vendors/rust-bitcoin-btcmobick && git diff bitcoin-0.32.101..HEAD
cd ../bdk-btcmobick              && git diff 03a08bb7..HEAD
```

| 서브모듈 | 원본 | 분기 지점 |
|---|---|---|
| `vendors/rust-bitcoin-btcmobick` | [rust-bitcoin](https://github.com/rust-bitcoin/rust-bitcoin) | 태그 `bitcoin-0.32.101` |
| `vendors/bdk-btcmobick` | [bdk](https://github.com/bitcoindevkit/bdk) | `03a08bb7` (`bdk_wallet` 1.0.0) |

---

## 3. Rust 엔진 빌드

3개 ABI(arm64/armv7/x86_64)를 컴파일해 `.aar`로 패키징하고, UniFFI Kotlin 바인딩을
앱 소스트리에 복사합니다.

```bash
cd rust-core
export ANDROID_NDK_HOME="/path/to/Android/Sdk/ndk/27.1.12297006"
bash scripts/build_android.sh
```

산출물:
- `app/android/app/libs/lib_wallet_core.aar` — 네이티브 엔진
- `app/android/app/src/main/java/uniffi/wallet_core/` — Kotlin 바인딩

> 스크립트는 재현성을 위해 `--locked`(커밋된 `Cargo.lock` 강제),
> `--remap-path-prefix`(빌드머신 경로 제거), 아카이브 타임스탬프 고정을 적용합니다.

---

## 4. 앱 빌드

```bash
cd app
npm ci

cd android
./gradlew assembleRelease     # APK
./gradlew bundleRelease       # AAB
```

산출물: `app/android/app/build/outputs/apk/release/app-release.apk`

> `keystore.properties`가 없으면 gradle이 디버그 키로 폴백 서명합니다. 공식 배포 APK는
> 개발자의 프로덕션 키로 서명되며 그 키는 공개되지 않습니다. 따라서 본인 빌드 결과물과
> 공식 APK를 대조할 때는 **서명을 제외한 내용물**을 비교합니다(아래 5번).

---

## 5. 무결성 검증

배포된 APK가 이 소스에서 나왔는지 확인하는 방법입니다.

### 무엇이 달라야 정상인가

APK는 **[내용물] + [서명 블록]**으로 나뉩니다.

- **내용물**은 이 소스에서 나옵니다. 직접 빌드하면 바이트 단위로 재현됩니다.
- **서명 블록**은 비공개 릴리스 키로 만들어집니다. 같은 키로 서명해도 서명 바이트는
  매번 달라집니다.

따라서 **파일 전체 해시는 일치할 수 없습니다.** 대조는 내용물 기준으로 합니다.

> ### 가장 흔한 오해
>
> 릴리스 노트의 **APK SHA-256**은 "내가 받은 파일이 온전한가"를 확인하는 값입니다.
> **본인이 빌드한 APK와 비교하는 값이 아닙니다** — 반드시 다르게 나옵니다.
>
> 재현빌드 대조에 쓰는 값은 릴리스 노트의 **내용물 다이제스트**입니다.

### 내용물 다이제스트 계산법

1. APK(zip)의 엔트리를 저장된 순서대로 훑는다
2. 디렉터리 엔트리와 v1(JAR) 서명 파일
   (`META-INF/MANIFEST.MF`, `META-INF/*.SF`, `*.RSA`, `*.DSA`, `*.EC`)은 건너뛴다
3. 각 엔트리마다 `"<내용의 sha256 16진수>  <엔트리 이름>\n"` 한 줄을 만든다
4. 그 줄들을 이어붙인 전체 텍스트의 sha256이 다이제스트다

v2 서명 블록은 zip 엔트리 바깥이라 애초에 포함되지 않습니다.

계산법을 밝히는 이유는 **이 저장소의 스크립트를 신뢰할 필요가 없게** 하기 위함입니다.
직접 구현하거나 `diffoscope` 같은 제3자 도구로 대조해도 같은 결론이 나와야 하며,
나오지 않는다면 그것 자체가 보고할 가치가 있습니다.

### 반드시 컨테이너에서

재현 빌드는 호스트 환경에 민감합니다. **호스트에서 직접 빌드하면 빌드 머신의 절대
경로가 바이너리에 박혀** 결과가 달라집니다(Windows가 특히 그렇습니다). 공식 릴리스도
검증도 모두 이 저장소의 [`Dockerfile`](./Dockerfile)로 만든 환경에서 수행합니다.

```sh
# 1) 검증용 이미지 빌드 (도구 버전 전부 고정)
docker build -t btcmobickwatch-build .

# 2) 컨테이너 안 깨끗한 clone에서 엔진 → APK까지 빌드
#    Windows 호스트는 -v 경로를 "D:\path:/build:ro" 형식으로
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

> `BTCMOBICK_KEYSTORE_PROPERTIES=/nonexistent`는 릴리스 키 없이 디버그 서명으로
> 폴백시켜, 키가 없는 제3자도 내용물을 재현·대조할 수 있게 합니다.

### 대조

```sh
# 내용물 다이제스트를 뽑아 릴리스 노트의 값과 비교
scripts/verify-reproducible.sh digest out/app-release.apk

# 공식 APK를 받아 두 개를 직접 맞대볼 수도 있다
scripts/verify-reproducible.sh compare <공식APK> out/app-release.apk
```

제3자 도구로는 `diffoscope <공식APK> <내APK>`를 씁니다. **아카이브 내용물이 동일**하다고
나오고 차이가 **서명 블록 구간에만** 있으면 통과입니다.

### 결과가 다르다면

신고 전에 아래를 확인해 주세요. 대부분 여기서 갈립니다.

| 증상 | 원인 |
|------|------|
| 파일 전체 해시가 다르다 | **정상입니다.** 서명 블록 차이. 내용물 다이제스트로 비교하세요. |
| 내용물이 통째로 다르다 | 컨테이너 밖에서 빌드했을 가능성. 빌드 머신 경로가 바이너리에 박힙니다. |
| 일부 엔트리가 다르다 | 서브모듈이 핀 커밋이 아닐 수 있습니다. `git submodule status`로 확인하세요. |
| 엔트리 수가 공식 APK보다 적다 | 압축을 풀어서 비교했고 Windows·macOS를 쓰고 있을 가능성. 대소문자만 다른 엔트리(`res/9n.9.png` vs `res/9N.9.png` 등)가 충돌해 조용히 누락됩니다. 압축을 풀지 말고 zip에서 직접 읽으세요. |

바이트 단위로 일치하지 않더라도 소스가 공개되어 있으므로, 누구나 로직을 직접 감사하고
스스로 빌드한 APK를 사용할 수 있습니다.

---

## 라이선스

MIT License — [`LICENSE`](./LICENSE) 참고. 있는 그대로(AS IS) 제공되며 보증이 없습니다.
