package com.btcmobickwatchapp.wallet

import com.facebook.react.bridge.*
import kotlinx.coroutines.*
import uniffi.wallet_core.*
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File
import java.security.MessageDigest

class WalletCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WalletCore"

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // ── 거래내역 캐시(지갑 changeset) 암호화 저장소 ──────────
    // 공개 데이터지만 "이 주소·거래들이 한 지갑의 것"이라는 링크는 프라이버시 정보이므로,
    // Android Keystore 마스터키로 앱 private 파일을 암호화(EncryptedFile)해 저장한다.

    private val masterKey: MasterKey by lazy {
        MasterKey.Builder(reactApplicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
    }

    private fun chainStateFile(walletId: String): File {
        val dir = File(reactApplicationContext.filesDir, "chainstate").apply { mkdirs() }
        // walletId(= "network:descriptor")는 길고 특수문자를 포함하므로 sha256 해시를 파일명으로 사용
        val hash = MessageDigest.getInstance("SHA-256")
            .digest(walletId.toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(dir, "$hash.json")
    }

    private fun encryptedFile(f: File): EncryptedFile =
        EncryptedFile.Builder(
            reactApplicationContext,
            f,
            masterKey,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB
        ).build()

    private val chainStateLock = Any()

    private fun writeChainState(walletId: String, json: String) = synchronized(chainStateLock) {
        val f = chainStateFile(walletId)
        // EncryptedFile은 대상 파일이 이미 존재하면 쓰기에서 예외를 던지므로 먼저 삭제.
        // 동시 스캔이 같은 파일을 delete/write로 경쟁해 손상되지 않도록 락으로 직렬화한다.
        if (f.exists()) f.delete()
        encryptedFile(f).openFileOutput().use { it.write(json.toByteArray()) }
    }

    private fun readChainState(walletId: String): String? {
        val f = chainStateFile(walletId)
        if (!f.exists()) return null
        return try {
            encryptedFile(f).openFileInput().use { it.readBytes().toString(Charsets.UTF_8) }
        } catch (e: Exception) {
            // 복호화 실패(키 변경·포맷 변경·손상) → 캐시 무시하고 새로 스캔하도록 null 반환
            null
        }
    }

    // ── 초기화 ──────────────────────────────────────────

    @ReactMethod
    fun initRuntime(promise: Promise) {
        scope.launch {
            try {
                initRuntime()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", e.message, e)
            }
        }
    }

    // ── zpub 변환 ───────────────────────────────────────

    @ReactMethod
    fun zpubToDescriptor(zpub: String, promise: Promise) {
        scope.launch {
            try {
                promise.resolve(zpubToDescriptor(zpub))
            } catch (e: WalletException) {
                promise.reject("ZPUB_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun zpubToChangeDescriptor(zpub: String, promise: Promise) {
        scope.launch {
            try {
                promise.resolve(zpubToChangeDescriptor(zpub))
            } catch (e: WalletException) {
                promise.reject("ZPUB_ERROR", e.message, e)
            }
        }
    }

    // ── 단일 주소 잔액 조회 (조회 전용) ─────────────────

    @ReactMethod
    fun scanAddressBalance(
        network: String,
        address: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val net = when (network) {
            "Mobick"       -> WalletNetwork.MOBICK
            "LaptopMining" -> WalletNetwork.LAPTOP_MINING
            else           -> WalletNetwork.BITCOIN
        }
        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val balance = scanAddressBalance(net, address, urls)
                val result = Arguments.createMap().apply {
                    putDouble("confirmedSat", balance.confirmedSat.toDouble())
                    putDouble("unconfirmedSat", balance.unconfirmedSat.toDouble())
                    putDouble("trustedPendingSat", balance.trustedPendingSat.toDouble())
                    putDouble("pendingOutgoingSat", balance.pendingOutgoingSat.toDouble())
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    // ── 단일 주소 거래 내역 (조회 전용) ─────────────────

    @ReactMethod
    fun scanAddressHistory(
        network: String,
        address: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val net = when (network) {
            "Mobick"       -> WalletNetwork.MOBICK
            "LaptopMining" -> WalletNetwork.LAPTOP_MINING
            else           -> WalletNetwork.BITCOIN
        }
        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val txs = scanAddressHistory(net, address, urls)
                val result = Arguments.createArray()
                txs.forEach { tx ->
                    val item = Arguments.createMap().apply {
                        putString("txid", tx.txid)
                        if (tx.confirmedAt != null) putDouble("confirmedAt", tx.confirmedAt!!.toDouble())
                        else putNull("confirmedAt")
                        if (tx.blockHeight != null) putInt("blockHeight", tx.blockHeight!!.toInt())
                        else putNull("blockHeight")
                        putDouble("sentSat", tx.sentSat.toDouble())
                        putDouble("receivedSat", tx.receivedSat.toDouble())
                    }
                    result.pushMap(item)
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("TX_ERROR", e.message, e)
            }
        }
    }

    // ── 수수료 추정 ─────────────────────────────────────

    @ReactMethod
    fun scanFeeEstimates(
        network: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val net = when (network) {
            "Mobick"       -> WalletNetwork.MOBICK
            "LaptopMining" -> WalletNetwork.LAPTOP_MINING
            else           -> WalletNetwork.BITCOIN
        }
        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val fees = scanFeeEstimates(net, urls)
                val result = Arguments.createMap().apply {
                    putDouble("fastSatVb", fees.fastSatVb)
                    putDouble("normalSatVb", fees.normalSatVb)
                    putDouble("slowSatVb", fees.slowSatVb)
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("FEE_ERROR", e.message, e)
            }
        }
    }

    // ── BTC Watch Wallet ────────────────────────────────

    @ReactMethod
    fun createBtcWallet(
        network: String,
        descriptor: String,
        changeDescriptor: String?,
        promise: Promise
    ) {
        try {
            val net = when (network) {
                "Mobick"       -> WalletNetwork.MOBICK
                "LaptopMining" -> WalletNetwork.LAPTOP_MINING
                else           -> WalletNetwork.BITCOIN
            }
            // 인스턴스를 JS 핸들 대신 싱글턴 맵으로 관리
            val wallet = BtcWatchWallet(net, descriptor, changeDescriptor)
            val walletId = "$network:$descriptor"  // 네트워크 포함 — 같은 xpub이어도 코인별로 구분
            WalletRegistry.putBtc(walletId, wallet)
            promise.resolve(walletId)
        } catch (e: WalletException) {
            promise.reject("WALLET_ERROR", e.message, e)
        }
    }

    /// 저장된 changeset 캐시가 있으면 그것으로 지갑을 복원하고, 없거나 손상됐으면 새로 생성한다.
    /// createBtcWallet을 대체하는 진입점 — 앱 재시작 후에도 이전 거래 그래프를 즉시 복원한다.
    @ReactMethod
    fun restoreBtcWallet(
        network: String,
        descriptor: String,
        changeDescriptor: String?,
        promise: Promise
    ) {
        scope.launch {
            try {
                val net = when (network) {
                    "Mobick"       -> WalletNetwork.MOBICK
                    "LaptopMining" -> WalletNetwork.LAPTOP_MINING
                    else           -> WalletNetwork.BITCOIN
                }
                val walletId = "$network:$descriptor"

                // 이미 세션에 로드돼 있으면 재사용 (인메모리 그래프 유지)
                if (WalletRegistry.getBtc(walletId) != null) {
                    promise.resolve(walletId)
                    return@launch
                }

                val cached = readChainState(walletId)
                val wallet = if (cached != null) {
                    try {
                        BtcWatchWallet.fromChangeset(net, cached)
                    } catch (e: Exception) {
                        // 캐시 복원 실패 → 새로 생성 (다음 스캔에서 캐시 갱신됨)
                        BtcWatchWallet(net, descriptor, changeDescriptor)
                    }
                } else {
                    BtcWatchWallet(net, descriptor, changeDescriptor)
                }
                WalletRegistry.putBtc(walletId, wallet)
                promise.resolve(walletId)
            } catch (e: WalletException) {
                promise.reject("WALLET_ERROR", e.message, e)
            }
        }
    }

    /// 지갑의 현재 changeset을 암호화 파일로 저장 (스캔/동기화 성공 후 호출).
    @ReactMethod
    fun persistChainState(
        walletId: String,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        scope.launch {
            try {
                val json = wallet.exportChangeset()
                writeChainState(walletId, json)
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("PERSIST_ERROR", e.message, e)
            }
        }
    }

    /// 증분 동기화 (빠른 새로고침) — 이미 알려진 주소만 재확인.
    @ReactMethod
    fun syncWallet(
        walletId: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val balance = wallet.sync(urls)
                val result = Arguments.createMap().apply {
                    putDouble("confirmedSat", balance.confirmedSat.toDouble())
                    putDouble("unconfirmedSat", balance.unconfirmedSat.toDouble())
                    putDouble("trustedPendingSat", balance.trustedPendingSat.toDouble())
                    putDouble("pendingOutgoingSat", balance.pendingOutgoingSat.toDouble())
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun fullScan(
        walletId: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val balance = wallet.fullScan(urls)
                val result = Arguments.createMap().apply {
                    putDouble("confirmedSat", balance.confirmedSat.toDouble())
                    putDouble("unconfirmedSat", balance.unconfirmedSat.toDouble())
                    putDouble("trustedPendingSat", balance.trustedPendingSat.toDouble())
                    putDouble("pendingOutgoingSat", balance.pendingOutgoingSat.toDouble())
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("SCAN_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getAddresses(
        walletId: String,
        start: Int,
        count: Int,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        try {
            val addrs = wallet.getAddresses(start.toUInt(), count.toUInt())
            val result = Arguments.createArray()
            addrs.forEach { result.pushString(it) }
            promise.resolve(result)
        } catch (e: WalletException) {
            promise.reject("ADDRESS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun nextReceiveAddress(
        walletId: String,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        scope.launch {
            try {
                promise.resolve(wallet.nextReceiveAddress())
            } catch (e: WalletException) {
                promise.reject("ADDRESS_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getAddressesWithBalance(
        walletId: String,
        start: Int,
        count: Int,
        isChange: Boolean,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        try {
            val items = wallet.getAddressesWithBalance(start.toUInt(), count.toUInt(), isChange)
            val result = Arguments.createArray()
            items.forEach { item ->
                val map = Arguments.createMap().apply {
                    putString("address", item.address)
                    putDouble("balanceSat", item.balanceSat.toDouble())
                    putBoolean("used", item.used)
                }
                result.pushMap(map)
            }
            promise.resolve(result)
        } catch (e: WalletException) {
            promise.reject("ADDRESS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createPsbt(
        walletId: String,
        recipient: String,
        amountSat: Double,
        feeRateSatVb: Double,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        try {
            val res = wallet.createPsbt(recipient, amountSat.toLong().toULong(), feeRateSatVb.toFloat())
            val result = Arguments.createMap().apply {
                putString("psbtBase64", res.psbtBase64)
                putDouble("feeSat", res.feeSat.toDouble())
            }
            promise.resolve(result)
        } catch (e: WalletException) {
            promise.reject("PSBT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun decodePsbt(
        walletId: String,
        psbtBase64: String,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        try {
            val d = wallet.decodePsbt(psbtBase64)
            val result = Arguments.createMap().apply {
                putString("recipient", d.recipient)
                putDouble("amountSat", d.amountSat.toDouble())
                putDouble("feeSat", d.feeSat.toDouble())
                putDouble("changeSat", d.changeSat.toDouble())
                putDouble("externalOutputCount", d.externalOutputCount.toDouble())
            }
            promise.resolve(result)
        } catch (e: WalletException) {
            promise.reject("PSBT_DECODE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun listTransactions(
        walletId: String,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        scope.launch {
            try {
                val txs = wallet.listTransactions()
                val result = Arguments.createArray()
                txs.forEach { tx ->
                    val item = Arguments.createMap().apply {
                        putString("txid", tx.txid)
                        if (tx.confirmedAt != null) putDouble("confirmedAt", tx.confirmedAt!!.toDouble())
                        else putNull("confirmedAt")
                        if (tx.blockHeight != null) putInt("blockHeight", tx.blockHeight!!.toInt())
                        else putNull("blockHeight")
                        putDouble("sentSat", tx.sentSat.toDouble())
                        putDouble("receivedSat", tx.receivedSat.toDouble())
                    }
                    result.pushMap(item)
                }
                promise.resolve(result)
            } catch (e: WalletException) {
                promise.reject("TX_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun broadcastSignedPsbt(
        walletId: String,
        psbtBase64: String,
        electrumUrls: ReadableArray,
        promise: Promise
    ) {
        val wallet = WalletRegistry.getBtc(walletId)
            ?: return promise.reject("NOT_FOUND", "wallet not found: $walletId")

        val urls = (0 until electrumUrls.size()).map { electrumUrls.getString(it)!! }

        scope.launch {
            try {
                val txid = wallet.broadcastSignedPsbt(psbtBase64, urls)
                promise.resolve(txid)
            } catch (e: WalletException) {
                promise.reject("BROADCAST_ERROR", e.message, e)
            }
        }
    }

    // ── EVM Balance ─────────────────────────────────────

    @ReactMethod
    fun getTokenBalance(
        rpcUrl: String,
        contractAddr: String,
        walletAddr: String,
        promise: Promise
    ) {
        scope.launch {
            try {
                val checker = EvmBalanceChecker(rpcUrl)
                val balance = checker.getTokenBalance(contractAddr, walletAddr)
                promise.resolve(balance)
            } catch (e: WalletException) {
                promise.reject("EVM_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getNativeBalance(
        rpcUrl: String,
        walletAddr: String,
        promise: Promise
    ) {
        scope.launch {
            try {
                val checker = EvmBalanceChecker(rpcUrl)
                val balance = checker.getNativeBalance(walletAddr)
                promise.resolve(balance)
            } catch (e: WalletException) {
                promise.reject("EVM_ERROR", e.message, e)
            }
        }
    }

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }
}
