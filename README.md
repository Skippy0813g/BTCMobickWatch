**English** · [한국어](README.ko.md)

<!-- 이 경고 블록은 항상 README 최상단에 유지하세요. Keep this warning block at the top. -->

> # Install only from the official source
>
> **The only official distribution is this repository's [Releases page](../../releases).**
>
> **An installer received through any other channel — app stores, Telegram, forums, messaging apps — may be a counterfeit built to steal your assets.**
>
> A counterfeit app can watch your addresses and balances, or show forged QR codes and transactions to divert your funds. Install only from the official source.<br>
> To confirm a file is genuine, compare it against the **signing certificate fingerprint** and **APK SHA-256 hash** published in the release notes.
>
> ### Reproducible builds
>
> You can verify for yourself that the distributed APK was built from the source in this repository.<br>
> Build the source in a container and check that the resulting fingerprint matches the value published in the release notes.
>
> How to verify: **[`BUILD.md` section 5 — Integrity verification](BUILD.md#5-integrity-verification)**
>
> - Two independent clean builds produced all 680 APK entries byte-for-byte identical
> - This repository contains no prebuilt binaries
> - The Rust engine that handles balance lookups and transaction construction is built from source too
> - External libraries are version-pinned by lock files and fetched from public registries (Maven, npm)

---

# BTCMobickWatch

A watch-only Android wallet for viewing BTC-family assets (Bitcoin, BTCMobick, LaptopMining) and EVM assets **without ever entering a private key**.<br>
Advanced users can pair it with a cold wallet over QR to manage BTC-family assets air-gapped.

## Security principles

- **Watch-only** — the app neither accepts nor stores private keys or mnemonics.
- **Device lock required** — a fingerprint or PIN must be set, and owner authentication is required on every entry.
- **Hardware-backed storage** — wallet data is encrypted in the device's secure storage (Keychain) and never leaves the device.

## Supported assets

- **BTC family**: Bitcoin (BTC), BTCMobick (BMB), LaptopMining (LTM) — viewing and air-gapped sending
- **EVM**: BNB, Ethereum, Base and related tokens (WBMB, MOVN, USDT, and others) — viewing only for now

## Official channels

- Download: **[Releases](../../releases)** — currently the only official distribution (Android 8.0 or later)
- Questions and bug reports: this repository's **[Issues](../../issues)** — please mask addresses, balances, and other personal data
- Security vulnerabilities: **[SECURITY.md](SECURITY.md)** — report privately, not in a public issue

---

## Building and verifying from source

- **[`BUILD.md`](BUILD.md)** — how to build from source, and how to verify that the distributed APK
  came from this source (section 5). A [`Dockerfile`](Dockerfile) with every tool version pinned is
  included.

## Support

If this app has been useful, feel free to buy me a coffee. Caffeine keeps this going.

`bc1q3aa08pnpj7qqzpw4pye2a7jyryxdzqc2lk32pl`

`0xea66EA4787d0D8Ec7264651808e82F871aB30279`

## License

MIT License — see [`LICENSE`](LICENSE).
