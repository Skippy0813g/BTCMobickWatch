package com.btcmobickwatchapp.wallet

import uniffi.wallet_core.BtcWatchWallet
import java.util.concurrent.ConcurrentHashMap

object WalletRegistry {
    private val btcWallets = ConcurrentHashMap<String, BtcWatchWallet>()

    fun putBtc(id: String, wallet: BtcWatchWallet) {
        btcWallets[id] = wallet
    }

    fun getBtc(id: String): BtcWatchWallet? = btcWallets[id]

    fun removeBtc(id: String) {
        btcWallets.remove(id)
    }
}
