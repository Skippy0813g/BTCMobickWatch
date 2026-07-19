#!/usr/bin/env bash
# 재현빌드 검증 스크립트
#
# 목적: "배포된 APK가 이 공개 소스에서 나왔는가"를 확인한다.
#
#   digest  <APK>          — APK의 '내용물 다이제스트'를 출력한다.
#                            릴리스 노트에 공개된 값과 이 값이 같으면 검증 성공.
#   compare <APK> <APK>    — 두 APK의 내용물이 같은지 비교한다.
#   self                   — Rust 엔진(.aar)을 2회 빌드해 결정성을 자체 점검한다.
#
# ── 내용물 다이제스트란 ──────────────────────────────────────────────────
# APK = [내용물(코드·리소스·엔진)] + [서명 블록]. 서명 블록은 릴리스 키로만
# 만들 수 있고 서명할 때마다 바이트가 달라지므로, 재현 대조는 내용물만 본다.
#
# 계산법(직접 구현해 교차확인할 수 있도록 명시):
#   1. APK(zip)의 엔트리를 저장된 순서대로 훑는다.
#   2. 디렉터리 엔트리와 v1(JAR) 서명 파일
#      (META-INF/MANIFEST.MF, META-INF/*.SF, *.RSA, *.DSA, *.EC)은 건너뛴다.
#   3. 각 엔트리마다 "<내용의 sha256 16진수>  <엔트리 이름>\n" 한 줄을 만든다.
#   4. 그 줄들을 이어붙인 전체 텍스트의 sha256이 다이제스트다.
# v2 서명 블록은 zip 엔트리 바깥에 있어 애초에 포함되지 않는다.
#
# ⚠ 반드시 Dockerfile로 만든 컨테이너 안에서 빌드·검증할 것. 호스트에서 직접
#   빌드하면 빌드 머신의 절대 경로가 바이너리에 박혀 결과가 달라진다.
#   자세한 절차는 BUILD.md 5장 참고.
#
# 이 스크립트를 신뢰할 필요는 없다. 위 계산법대로 직접 구현하거나 diffoscope
# 같은 제3자 도구로 대조해도 같은 결론이 나와야 한다.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

sha() { sha256sum "$1" | awk '{print $1}'; }

# Reads entries straight out of the archive. Extracting to disk would collide
# entries whose names differ only in case (res/9n.9.png vs res/9N.9.png) on
# Windows and macOS, silently dropping them from the comparison.
entry_lines() {
    python3 - "$1" <<'PY'
import hashlib, sys, zipfile

def is_v1_sig(name):
    if name == "META-INF/MANIFEST.MF":
        return True
    return name.startswith("META-INF/") and name.upper().endswith(
        (".SF", ".RSA", ".DSA", ".EC"))

with zipfile.ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        if info.is_dir() or is_v1_sig(info.filename):
            continue
        digest = hashlib.sha256(z.read(info)).hexdigest()
        sys.stdout.write(f"{digest}  {info.filename}\n")
PY
}

content_digest() { entry_lines "$1" | sha256sum | awk '{print $1}'; }

require_apk() {
    [ -f "$1" ] || { echo "파일 없음: $1" >&2; exit 2; }
}

digest_mode() {
    local APK="${1:?APK 경로 필요}"
    require_apk "$APK"
    local N D
    N="$(entry_lines "$APK" | wc -l)"
    D="$(content_digest "$APK")"
    echo "▶ APK: $APK"
    echo "  엔트리 수: $N"
    echo "  파일 전체 SHA-256 : $(sha "$APK")   ← 다운로드 무결성 확인용"
    echo "                                        (직접 빌드한 APK와는 반드시 다릅니다)"
    echo "  내용물 다이제스트 : $D   ← 재현빌드 대조용"
    echo
    echo "  릴리스 노트에 공개된 '내용물 다이제스트'와 위 값이 같으면 검증 성공입니다."
}

compare_mode() {
    local A="${1:?APK 경로 2개 필요}" B="${2:?APK 경로 2개 필요}"
    require_apk "$A"; require_apk "$B"
    echo "▶ MODE compare — 내용물 비교(서명 블록 제외)"
    local DA DB
    DA="$(content_digest "$A")"
    DB="$(content_digest "$B")"
    echo "  A: $A"
    echo "     $DA"
    echo "  B: $B"
    echo "     $DB"
    echo
    if [ "$DA" = "$DB" ]; then
        echo "✅ 내용물 일치 — 두 APK는 같은 소스에서 나왔습니다"
        echo "   (파일 전체 해시는 서명 블록 때문에 다릅니다. 정상입니다.)"
    else
        echo "❌ 내용물 불일치 — 다른 엔트리:"
        diff <(entry_lines "$A") <(entry_lines "$B") | head -40 | sed 's/^/     /'
        echo
        echo "   컨테이너(Dockerfile) 안에서 빌드했는지, 서브모듈이 핀 커밋인지"
        echo "   (git submodule status) 먼저 확인하세요. BUILD.md 5장 참고."
        return 1
    fi
}

self_mode() {
    echo "▶ MODE self — Rust 엔진(.aar) 2회 빌드 후 바이트 비교"
    local AAR="$REPO_ROOT/app/android/app/libs/lib_wallet_core.aar"
    cd "$REPO_ROOT/rust-core"

    echo "  [1/2] 첫 번째 빌드..."
    bash scripts/build_android.sh >/dev/null
    local H1; H1="$(sha "$AAR")"
    cp "$AAR" /tmp/aar_build1.aar

    echo "  [2/2] 두 번째 빌드(클린)..."
    cargo clean -p ffi >/dev/null 2>&1 || true
    bash scripts/build_android.sh >/dev/null
    local H2; H2="$(sha "$AAR")"

    echo "  build1: $H1"
    echo "  build2: $H2"
    if [ "$H1" = "$H2" ]; then
        echo "✅ .aar 바이트 동일 — Rust 엔진 빌드가 결정적"
    else
        echo "❌ .aar 불일치 — 남은 비결정 요소 있음(diffoscope /tmp/aar_build1.aar $AAR 로 조사)"
        return 1
    fi
}

case "$MODE" in
    digest)  shift; digest_mode "$@" ;;
    compare) shift; compare_mode "$@" ;;
    self)    self_mode ;;
    *) echo "usage: $0 digest <APK>"
       echo "       $0 compare <APK> <APK>"
       echo "       $0 self"
       exit 2 ;;
esac
