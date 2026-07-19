package com.btcmobickwatchapp.integrity

import android.os.Build
import com.btcmobickwatchapp.BuildConfig
import com.facebook.react.bridge.*
import java.io.File

/**
 * 기기 무결성(루팅) 탐지 모듈.
 *
 * 워치온리 지갑이라 개인키는 없지만, 루팅/후킹 환경에서는 화면 표시값이나
 * PSBT 검증(1번 WYSIWYS) 자체를 런타임에 조작당할 수 있으므로 루팅 기기를 차단한다.
 *
 * 차단 여부(release only)는 JS 레이어가 isDebug 플래그를 보고 결정한다.
 * 디버그 빌드(개발/에뮬레이터)는 탐지만 하고 차단하지 않아 개발에 지장이 없다.
 */
class IntegrityModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "DeviceIntegrity"

    @ReactMethod
    fun checkIntegrity(promise: Promise) {
        val reasons = Arguments.createArray()

        if (hasTestKeys()) reasons.pushString("test-keys build")
        if (hasSuBinary()) reasons.pushString("su binary")
        if (hasRootPackages()) reasons.pushString("root management app")
        if (hasRootCloakPackages()) reasons.pushString("root hiding app")
        if (hasMagiskArtifacts()) reasons.pushString("magisk artifact")
        if (hasWritableSystemPaths()) reasons.pushString("writable system path")

        val rooted = reasons.size() > 0

        val result = Arguments.createMap().apply {
            putBoolean("rooted", rooted)
            putBoolean("isDebug", BuildConfig.DEBUG)
            putArray("reasons", reasons)
        }
        promise.resolve(result)
    }

    /** 커스텀/개발 ROM에서 흔한 test-keys 서명 */
    private fun hasTestKeys(): Boolean {
        val tags = Build.TAGS
        return tags != null && tags.contains("test-keys")
    }

    /** su 실행 파일이 표준 경로에 존재하는지 */
    private fun hasSuBinary(): Boolean {
        val paths = arrayOf(
            "/system/bin/su", "/system/xbin/su", "/sbin/su",
            "/system/su", "/system/bin/.ext/su", "/system/usr/we-need-root/su",
            "/data/local/xbin/su", "/data/local/bin/su", "/data/local/su",
            "/su/bin/su", "/vendor/bin/su",
        )
        return paths.any { safeExists(it) }
    }

    /** 대표적인 루팅 관리 앱 패키지 설치 여부 */
    private fun hasRootPackages(): Boolean {
        val packages = arrayOf(
            "com.topjohnwu.magisk",
            "eu.chainfire.supersu",
            "com.noshufou.android.su",
            "com.noshufou.android.su.elite",
            "com.koushikdutta.superuser",
            "com.thirdparty.superuser",
            "com.yellowes.su",
            "com.kingroot.kinguser",
            "com.kingo.root",
            "com.zachspong.temprootremovejb",
            "com.ramdroid.appquarantine",
        )
        return packages.any { isPackageInstalled(it) }
    }

    /** 루팅 은폐/우회 도구 패키지 */
    private fun hasRootCloakPackages(): Boolean {
        val packages = arrayOf(
            "com.devadvance.rootcloak",
            "com.devadvance.rootcloakplus",
            "de.robv.android.xposed.installer",
            "com.saurik.substrate",
            "com.formyhm.hiddenroot",
            "com.formyhm.hideroot",
        )
        return packages.any { isPackageInstalled(it) }
    }

    /** Magisk 관련 흔적 */
    private fun hasMagiskArtifacts(): Boolean {
        val paths = arrayOf(
            "/sbin/.magisk", "/cache/.disable_magisk",
            "/dev/.magisk.unblock", "/cache/magisk.log",
            "/data/adb/magisk", "/data/adb/modules",
        )
        return paths.any { safeExists(it) }
    }

    /** 정상 기기에서 쓰기 불가한 시스템 경로가 쓰기 가능하면 루팅 의심 */
    private fun hasWritableSystemPaths(): Boolean {
        val paths = arrayOf(
            "/system", "/system/bin", "/system/sbin", "/system/xbin",
            "/vendor/bin", "/sbin", "/etc",
        )
        return paths.any {
            try {
                File(it).canWrite()
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun safeExists(path: String): Boolean =
        try {
            File(path).exists()
        } catch (_: Exception) {
            false
        }

    private fun isPackageInstalled(pkg: String): Boolean =
        try {
            reactApplicationContext.packageManager.getPackageInfo(pkg, 0)
            true
        } catch (_: Exception) {
            false
        }
}
