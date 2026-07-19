package com.btcmobickwatchapp

import android.app.Application
import com.btcmobickwatchapp.auth.DeviceAuthPackage
import com.btcmobickwatchapp.integrity.IntegrityPackage
import com.btcmobickwatchapp.wallet.WalletCorePackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(WalletCorePackage())
          add(DeviceAuthPackage())
          add(IntegrityPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
