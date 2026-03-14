import { NextResponse } from "next/server";

const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";

/**
 * Builds a collectCreatorFee transaction for the client to sign.
 * Creator rewards = SOL from trading fees when people buy/sell the agent token on pump.fun.
 * Different from agent revenue (USDC from payments) which uses PumpAgent.withdraw().
 *
 * The connected wallet must be the bonding curve creator for the agent token.
 */
export async function POST(req: Request) {
  let body: { publicKey: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { publicKey } = body;
  if (!publicKey || typeof publicKey !== "string") {
    return NextResponse.json({ error: "publicKey required" }, { status: 400 });
  }

  try {
    const res = await fetch(PUMPPORTAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey,
        action: "collectCreatorFee",
        priorityFee: 0.000001,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      let errMsg = `PumpPortal error (${res.status})`;
      try {
        const json = JSON.parse(text);
        if (json.error || json.message) errMsg = json.error || json.message;
      } catch {
        if (text.length < 200) errMsg = text || errMsg;
      }
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const txBuf = await res.arrayBuffer();
    const base64 = Buffer.from(txBuf).toString("base64");
    return NextResponse.json({ transaction: base64 });
  } catch (e) {
    console.error("[claim-creator-fee]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to build claim tx" },
      { status: 500 }
    );
  }
}
