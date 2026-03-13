import { NextResponse } from "next/server";
import { Connection, PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { PumpAgent } from "@pump-fun/agent-payments-sdk";

const AGENT_MINT = process.env.AGENT_TOKEN_MINT_ADDRESS!;
const CURRENCY_MINT = process.env.CURRENCY_MINT!; // USDC
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const PRICE_USDC = process.env.PRICE_AMOUNT || "1000000";
const PRICE_SOL = process.env.PRICE_SOL_LAMPORTS || "11111111"; // ~0.011 SOL ≈ $1 at $90/SOL
const RPC_URL = process.env.SOLANA_RPC_URL!;

export async function POST(req: Request) {
  if (!AGENT_MINT || !CURRENCY_MINT || !RPC_URL) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  let body: { userWallet: string; currency?: "usdc" | "sol" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userWallet, currency = "usdc" } = body;
  if (!userWallet) return NextResponse.json({ error: "userWallet required" }, { status: 400 });

  const isSol = currency === "sol";
  const currencyMint = isSol ? WSOL_MINT : CURRENCY_MINT;
  const amount = isSol ? PRICE_SOL : PRICE_USDC;

  const memo = String(Math.floor(Math.random() * 900000000000) + 100000);
  const now = Math.floor(Date.now() / 1000);
  const startTime = String(now);
  const endTime = String(now + 86400);

  try {
    const connection = new Connection(RPC_URL);
    const agent = new PumpAgent(new PublicKey(AGENT_MINT), "mainnet", connection);
    const instructions = await agent.buildAcceptPaymentInstructions({
      user: new PublicKey(userWallet),
      currencyMint: new PublicKey(currencyMint),
      amount,
      memo,
      startTime,
      endTime,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = new PublicKey(userWallet);
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      ...instructions
    );

    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");
    return NextResponse.json({
      transaction: serialized,
      memo,
      startTime,
      endTime,
      amount: Number(amount),
      currencyMint,
    });
  } catch (e) {
    console.error("[request]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
