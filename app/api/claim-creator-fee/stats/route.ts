import { NextResponse } from "next/server";
import { getClaimLogs } from "../logs-store";

/**
 * Returns creator rewards stats: recent claims and next claim countdown.
 * No auth required - public read-only.
 */
export async function GET() {
  try {
    const logs = await getClaimLogs();
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
