import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getClaimLogsFromChain } from "../chain-history";

/**
 * Returns recent creator reward claim logs from chain.
 */
export async function GET() {
  try {
    const creatorPubkey = process.env.CREATOR_PUBLIC_KEY;
    const rpc = process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (!creatorPubkey || !rpc) {
      return NextResponse.json({ logs: [], message: "CREATOR_PUBLIC_KEY or RPC not set" });
    }
    const connection = new Connection(rpc);
    const logs = await getClaimLogsFromChain(
      connection,
      new PublicKey(creatorPubkey),
      20
    );
    return NextResponse.json({ logs });
  } catch {
    return NextResponse.json({ logs: [], message: "No logs available" });
  }
}
