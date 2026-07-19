package com.btcmobickwatchapp.auth

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import com.facebook.react.bridge.*

class DeviceAuthModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext),
    ActivityEventListener {

    companion object {
        const val REQUEST_CODE = 0xD0A
    }

    private var pendingPromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "DeviceAuth"

    @ReactMethod
    fun isDeviceSecure(promise: Promise) {
        val km = reactApplicationContext.getSystemService(android.content.Context.KEYGUARD_SERVICE) as? KeyguardManager
        promise.resolve(km?.isDeviceSecure ?: false)
    }

    @ReactMethod
    fun authenticate(reason: String, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
            ?: run {
                promise.reject("NO_ACTIVITY", "No activity available")
                return
            }

        val km = activity.getSystemService(android.content.Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (km == null || !km.isDeviceSecure) {
            promise.reject("NO_LOCK", "기기 잠금이 설정되어 있지 않습니다")
            return
        }

        @Suppress("DEPRECATION")
        val intent: Intent? = km.createConfirmDeviceCredentialIntent("BTCMobickWatch", reason)
        if (intent == null) {
            promise.reject("NO_INTENT", "기기 인증 화면을 열 수 없습니다")
            return
        }

        pendingPromise = promise
        activity.startActivityForResult(intent, REQUEST_CODE)
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        val p = pendingPromise ?: return
        pendingPromise = null
        if (resultCode == Activity.RESULT_OK) {
            p.resolve(true)
        } else {
            p.reject("AUTH_CANCELLED", "인증을 취소했습니다")
        }
    }

    override fun onNewIntent(intent: Intent) {}
}
