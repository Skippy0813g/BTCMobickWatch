/**
 * ⚠️ Currently unused - groundwork for a future version. (as of 2026-07)
 * EVM air-gap sending is excluded from this release (EVM stays view-only). Off-the-shelf
 * signer apps (AirGap Vault, Keystone) don't support importing a raw private key, so
 * air-gapping a raw-key account would need our own signer. Mnemonic-based EVM air-gap
 * support is deferred to a future version. This module (unsigned tx builder) is kept as
 * validated groundwork to reuse then. Not imported anywhere.
 *
 * EVM air-gap send logic (pure JS/TS, no native/BDK).
 *
 * Flow: the watch-only app builds an unsigned tx and exports it as an EIP-4527
 * (eth-sign-request) UR QR; an offline signer (AirGap Vault / Keystone) signs and returns
 * an eth-signature UR, which we scan, combine, and broadcast.
 *
 * This file holds pure logic only (network RPC + serialization). UI lives in App.tsx.
 *
 * Design notes:
 * - The first version uses legacy (type-0, gasPrice) transactions. Valid on all EVM chains
 *   (BSC/Ethereum/Base) with the simplest RLP. EIP-1559 (type-2) is a later option.
 * - The watch-only path must have zero key generation/randomness (Hermes has no
 *   getRandomValues polyfill). requestId (uuid) is generated from Math.random (no crypto
 *   strength needed, just to correlate request/response).
 */
import { ethers } from 'ethers';

// RPC helper - follows the multi-RPC fallback + 8s timeout pattern of fetchEvmBalance (App.tsx).
export async function evmRpc(
  rpcUrls: readonly string[],
  method: string,
  params: any[],
): Promise<any> {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  let lastErr: any = null;
  for (const rpcUrl of rpcUrls) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let response: any;
      try {
        response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        } as any);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json: any = await response.json();
      if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
      return json.result;
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw new Error(lastErr?.message ? `RPC 실패: ${lastErr.message}` : 'RPC 응답 없음');
}

// Unsigned tx builder
export interface BuildEvmTxOpts {
  rpcUrls: readonly string[];
  chainId: number;
  from: string;                 // sender (watch-only) address 0x...
  to: string;                   // recipient address 0x...
  amountRaw: bigint;            // amount (small-unit/raw integer, decimals already applied)
  tokenContract?: string;       // contract address for ERC-20, undefined for native
  gasPriceWeiOverride?: bigint; // user-specified gasPrice (wei); if absent, query eth_gasPrice
}

export interface BuiltEvmTx {
  unsigned: ethers.Transaction;
  serializedUnsigned: string;   // 0x... (signData of eth-sign-request)
  summary: {
    chainId: number;
    from: string;
    to: string;                 // actual recipient (for a token, the final recipient, not the contract)
    amountRaw: string;          // amount, raw
    nonce: number;
    gasLimit: string;
    gasPriceWei: string;
    maxFeeWei: string;          // gasLimit * gasPrice (estimated max fee)
    isToken: boolean;
    txTo: string;               // RLP `to` (native=recipient, token=contract)
  };
}

const ERC20_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount)',
]);

/**
 * Build an unsigned legacy tx. Fills nonce/gasPrice/gasLimit via RPC, then re-decodes the
 * result and self-verifies it matches the inputs (WYSIWYS parity). Throws on mismatch.
 */
export async function buildEvmUnsignedTx(opts: BuildEvmTxOpts): Promise<BuiltEvmTx> {
  const { rpcUrls, chainId, from, to, amountRaw, tokenContract } = opts;
  if (!ethers.isAddress(from)) throw new Error('발신 주소가 올바르지 않습니다.');
  if (!ethers.isAddress(to)) throw new Error('받는 주소가 올바르지 않습니다.');
  if (amountRaw <= 0n) throw new Error('전송 금액이 올바르지 않습니다.');

  const isToken = !!tokenContract;
  const txTo = isToken ? (tokenContract as string) : to;
  const value = isToken ? 0n : amountRaw;
  const data = isToken ? ERC20_IFACE.encodeFunctionData('transfer', [to, amountRaw]) : '0x';

  // nonce (pending-based, so in-flight txs are counted)
  const nonceHex = await evmRpc(rpcUrls, 'eth_getTransactionCount', [from, 'pending']);
  const nonce = Number(BigInt(nonceHex));

  // gasPrice
  const gasPriceWei = opts.gasPriceWeiOverride ?? BigInt(await evmRpc(rpcUrls, 'eth_gasPrice', []));
  if (gasPriceWei <= 0n) throw new Error('gasPrice 조회 실패');

  // gasLimit: native=21000, token=eth_estimateGas (conservative fallback on failure)
  let gasLimit: bigint;
  if (!isToken) {
    gasLimit = 21000n;
  } else {
    try {
      const est = await evmRpc(rpcUrls, 'eth_estimateGas', [{ from, to: txTo, value: '0x0', data }]);
      // 12% headroom over the estimate
      gasLimit = (BigInt(est) * 112n) / 100n;
    } catch {
      gasLimit = 100000n; // conservative cap for a typical ERC-20 transfer
    }
  }

  const txReq = {
    type: 0 as const,
    chainId,
    nonce,
    to: txTo,
    value,
    data,
    gasLimit,
    gasPrice: gasPriceWei,
  };
  const unsigned = ethers.Transaction.from(txReq);
  const serializedUnsigned = unsigned.unsignedSerialized;

  // WYSIWYS parity: re-decode the serialized result and confirm it matches the inputs
  const rt = ethers.Transaction.from(serializedUnsigned);
  const mism: string[] = [];
  if (rt.to?.toLowerCase() !== txTo.toLowerCase()) mism.push('to');
  if (rt.value !== value) mism.push('value');
  if (rt.nonce !== nonce) mism.push('nonce');
  if (rt.chainId !== BigInt(chainId)) mism.push('chainId');
  if (rt.gasPrice !== gasPriceWei) mism.push('gasPrice');
  if (rt.gasLimit !== gasLimit) mism.push('gasLimit');
  if ((rt.data ?? '0x').toLowerCase() !== data.toLowerCase()) mism.push('data');
  if (mism.length) {
    throw new Error(`직렬화 검증 실패(불일치: ${mism.join(', ')})`);
  }

  return {
    unsigned,
    serializedUnsigned,
    summary: {
      chainId,
      from,
      to,
      amountRaw: amountRaw.toString(),
      nonce,
      gasLimit: gasLimit.toString(),
      gasPriceWei: gasPriceWei.toString(),
      maxFeeWei: (gasLimit * gasPriceWei).toString(),
      isToken,
      txTo,
    },
  };
}
