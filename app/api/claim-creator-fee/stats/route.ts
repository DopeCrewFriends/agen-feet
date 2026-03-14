import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getClaimLogsFromChain } from "../chain-history";

/**
 * Returns creator rewards stats from chain (creator tx history).
 * No storage needed - reads directly from Solana.
 */
export async function GET() {
  try {
    const creatorPubkey = process.env.CREATOR_PUBLIC_KEY;
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

    let logs: Awaited<ReturnType<typeof getClaimLogsFromChain>> = [];
    if (creatorPubkey && rpc) {
      const connection = new Connection(rpc);
      logs = await getClaimLogsFromChain(
        connection,
        new PublicKey(creatorPubkey),
        15
      );
    }
    const totalCollectedLamports = logs.reduce((s, l) => {
      const amt = l.paymentAmountLamports ?? l.claimAmountLamports ?? 0;
      return s + (amt > 0 ? amt : 0);
    }, 0);

    // Next cron runs every 5 minutes (top of next 5-min mark)
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setSeconds(0, 0);
    nextRun.setMilliseconds(0);
    const mins = nextRun.getMinutes();
    nextRun.setMinutes(mins + (5 - (mins % 5)));
    const nextClaimInMs = Math.max(0, nextRun.getTime() - now.getTime());

    return NextResponse.json({
      claims: logs,
      totalCollectedLamports,
      totalCollectedSol: totalCollectedLamports / 1e9,
      nextClaimInMs,
      nextClaimAt: nextRun.toISOString(),
    });
  } catch {
    return NextResponse.json({
      claims: [],
      totalCollectedLamports: 0,
      totalCollectedSol: 0,
      nextClaimInMs: 0,
      nextClaimAt: null,
    });
  }
}
