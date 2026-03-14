import { Connection, PublicKey } from "@solana/web3.js";

const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MIN_CLAIM_LAMPORTS = 10_000;

export type ClaimLog = {
  timestamp: string;
  claimSignature?: string;
  claimAmountLamports?: number;
  claimAmountSol?: number;
  paymentSignature?: string;
  paymentAmountLamports?: number;
  error?: string;
};

export async function getClaimLogsFromChain(
  connection: Connection,
  creatorPubkey: PublicKey,
  limit = 15
): Promise<ClaimLog[]> {
  const logs: ClaimLog[] = [];
  try {
    const sigs = await connection.getSignaturesForAddress(creatorPubkey, {
      limit,
      before: undefined,
    });
    const txs = await Promise.all(
      sigs.map((s) =>
        connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 })
      )
    );
    for (let i = 0; i < sigs.length; i++) {
      const tx = txs[i];
      const sig = sigs[i].signature;
      if (!tx?.meta?.preBalances || !tx?.meta?.postBalances) continue;
      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined,
      });
      let creatorIdx = -1;
      for (let j = 0; j < keys.length; j++) {
        if (keys.get(j)?.equals(creatorPubkey)) {
          creatorIdx = j;
          break;
        }
      }
      if (creatorIdx < 0) continue;
      const pre = tx.meta.preBalances[creatorIdx] ?? 0;
      const post = tx.meta.postBalances[creatorIdx] ?? 0;
      const delta = post - pre;
      if (delta < MIN_CLAIM_LAMPORTS) continue;
      let hasPump = false;
      for (let k = 0; k < keys.length; k++) {
        if (keys.get(k)?.toBase58() === PUMP_PROGRAM_ID) {
          hasPump = true;
          break;
        }
      }
      if (!hasPump) continue;
      const blockTime = tx.blockTime ?? sigs[i].blockTime ?? 0;
      logs.push({
        timestamp: new Date(blockTime * 1000).toISOString(),
        claimSignature: sig,
        claimAmountLamports: delta,
        claimAmountSol: delta / 1e9,
      });
    }
    logs.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (e) {
    console.error("[claim-chain-history]", e);
  }
  return logs;
}
