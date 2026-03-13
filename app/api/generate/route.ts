import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { PumpAgent } from "@pump-fun/agent-payments-sdk";
import Replicate from "replicate";

const AGENT_MINT = process.env.AGENT_TOKEN_MINT_ADDRESS!;
const RPC_URL = process.env.SOLANA_RPC_URL!;
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN!;

const DEFAULT_PROMPT =
  "Hot girl in seductive clothing, either realistic or anime style, showing her feet, close up angle on the feet possibly showing part of the body behind";

export async function POST(req: Request) {
  if (!AGENT_MINT || !RPC_URL) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!REPLICATE_TOKEN) {
    return NextResponse.json({ error: "REPLICATE_API_TOKEN not set" }, { status: 500 });
  }

  let body: {
    userWallet: string;
    memo: string;
    startTime: string;
    endTime: string;
    amount: number;
    currencyMint: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userWallet, memo, startTime, endTime, amount, currencyMint } = body;
  if (!userWallet || memo == null || startTime == null || endTime == null || amount == null || !currencyMint) {
    return NextResponse.json({ error: "Missing payment params" }, { status: 400 });
  }

  try {
    const connection = new Connection(RPC_URL);
    const agent = new PumpAgent(new PublicKey(AGENT_MINT), "mainnet", connection);

    const paid = await agent.validateInvoicePayment({
      user: new PublicKey(userWallet),
      currencyMint: new PublicKey(currencyMint),
      amount: Number(amount),
      memo: Number(memo),
      startTime: Number(startTime),
      endTime: Number(endTime),
    });

    if (!paid) {
      return NextResponse.json({ error: "Payment not verified" }, { status: 402 });
    }

    const replicate = new Replicate({
      auth: REPLICATE_TOKEN,
      useFileOutput: false, // get plain URL string instead of FileOutput
    });
    const imagePrompt = DEFAULT_PROMPT;

    const output = await replicate.run(
      "xai/grok-imagine-image" as `${string}/${string}`,
      { input: { prompt: imagePrompt } }
    );

    const imageUrl =
      typeof output === "string"
        ? output
        : output && typeof output === "object" && "url" in output && typeof (output as { url: () => string }).url === "function"
          ? (output as { url: () => string }).url()
          : Array.isArray(output)
            ? output[0]
            : null;

    if (!imageUrl || typeof imageUrl !== "string") {
      console.error("[generate] unexpected output format:", JSON.stringify(output, null, 2));
      return NextResponse.json({ error: "Generation failed" }, { status: 500 });
    }

    return NextResponse.json({ imageUrl, prompt: imagePrompt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[generate] error:", msg, e);
    return NextResponse.json(
      { error: msg || "Generation failed" },
      { status: 500 }
    );
  }
}
