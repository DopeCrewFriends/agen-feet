import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { PumpAgent } from "@pump-fun/agent-payments-sdk";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  bondingCurvePda,
  feeSharingConfigPda,
} from "@pump-fun/pump-sdk";
import bs58 from "bs58";

const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";

async function buildClaimTx(
  conn: Connection,
  keypair: Keypair,
  agentMint: string
): Promise<{ ixs: import("@solana/web3.js").TransactionInstruction[]; mode: string } | null> {
  const sdk = new OnlinePumpSdk(conn);
  const mint = new PublicKey(agentMint);
  const bcPda = bondingCurvePda(mint);
  const bcInfo = await conn.getAccountInfo(bcPda);
  if (bcInfo) {
    const bc = PUMP_SDK.decodeBondingCurveNullable(bcInfo);
    if (bc && bc.creator.equals(feeSharingConfigPda(mint))) {
      const res = await sdk.buildDistributeCreatorFeesInstructions(mint);
      return { ixs: res.instructions, mode: "distribute" };
    }
  }
  const ixs = await sdk.collectCoinCreatorFeeInstructions(
    keypair.publicKey,
    keypair.publicKey
  );
  return ixs.length > 0 ? { ixs, mode: "collect" } : null;
}
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const MIN_CLAIM_LAMPORTS = 100_000; // 0.0001 SOL - skip payment if less
const FEE_BUFFER_LAMPORTS = 50_000; // leave for tx fees

/** HTTP polling instead of WebSocket (avoids bufferUtil.mask error on WSL) */
async function waitForConfirmation(
  connection: Connection,
  signature: string,
  maxWaitMs = 60_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await connection.getSignatureStatuses([signature]);
    const s = status.value[0];
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
    if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Confirmation timeout");
}

/**
 * Auto-claim creator rewards, pay full amount into agent, and log.
 * Runs every minute via Vercel Cron. Requires CREATOR_WALLET_PRIVATE_KEY and CRON_SECRET.
 */
export async function POST(req: Request) {
  console.log("[claim-auto] POST /api/claim-creator-fee/auto");

  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    console.log("[claim-auto] 401 Unauthorized (missing or invalid CRON_SECRET)");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const privateKey = process.env.CREATOR_WALLET_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const agentMint = process.env.AGENT_TOKEN_MINT_ADDRESS;

  if (!privateKey)
    return NextResponse.json(
      { error: "CREATOR_WALLET_PRIVATE_KEY not configured" },
      { status: 500 }
    );
  if (!rpcUrl)
    return NextResponse.json({ error: "SOLANA_RPC_URL not set" }, { status: 500 });
  if (!agentMint)
    return NextResponse.json(
      { error: "AGENT_TOKEN_MINT_ADDRESS not set" },
      { status: 500 }
    );

  let keypair: Keypair;
  try {
    const trimmed = privateKey.trim();
    // Support both JSON array [1,2,...,64] and base58 string
    const secret = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed) as number[])
      : bs58.decode(trimmed);
    keypair = Keypair.fromSecretKey(secret);
  } catch {
    return NextResponse.json(
      { error: "Invalid CREATOR_WALLET_PRIVATE_KEY (use JSON array [1,2,...,64] or base58 string)" },
      { status: 500 }
    );
  }

  const connection = new Connection(rpcUrl);

  console.log("[claim-auto] Creator:", keypair.publicKey.toBase58());

  try {
    // 1. Balance before claim
    const balanceBefore =
      await connection.getBalance(keypair.publicKey);
    console.log("[claim-auto] Balance before:", balanceBefore, "lamports");

    // 2. Claim creator rewards (pump SDK for fee-sharing tokens, PumpPortal fallback)
    let claimSig: string;
    const claimBuild = await buildClaimTx(connection, keypair, agentMint);

    if (claimBuild && claimBuild.ixs.length > 0) {
      console.log("[claim-auto] Using pump SDK, mode:", claimBuild.mode);
      console.log("[claim-auto] Sending claim tx...");
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
          ...claimBuild.ixs,
        ],
      }).compileToV0Message();
      const claimTx = new VersionedTransaction(msg);
      claimTx.sign([keypair]);
      claimSig = await connection.sendRawTransaction(claimTx.serialize(), {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });
    } else {
      console.log("[claim-auto] Using PumpPortal...");
      console.log("[claim-auto] Sending claim tx...");
      const claimRes = await fetch(PUMPPORTAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: keypair.publicKey.toBase58(),
          action: "collectCreatorFee",
          priorityFee: 0.000001,
        }),
      });
      if (!claimRes.ok) {
        const text = await claimRes.text();
        console.error("[claim-auto] PumpPortal error:", claimRes.status, text);
        let errMsg = `PumpPortal error (${claimRes.status})`;
        try {
          const json = JSON.parse(text);
          if (json.error || json.message) errMsg = json.error ?? json.message;
        } catch {
          if (text.length < 200) errMsg = text || errMsg;
        }
        console.error("[creator-rewards] Claim failed:", errMsg);
        return NextResponse.json({ error: errMsg }, { status: 400 });
      }
      const claimTxBuf = await claimRes.arrayBuffer();
      const claimTx = VersionedTransaction.deserialize(new Uint8Array(claimTxBuf));
      claimTx.sign([keypair]);
      claimSig = await connection.sendRawTransaction(claimTx.serialize(), {
        skipPreflight: true,
        preflightCommitment: "confirmed",
      });
    }

    // Wait for claim to confirm (HTTP polling, no WebSocket)
    await waitForConfirmation(connection, claimSig);
    console.log("[claim-auto] Claim tx confirmed:", claimSig);

    // Derive actual claimed amount from tx metadata (balance delta can be wrong due to tx fee)
    let claimedLamports = 0;
    try {
      let tx = await connection.getTransaction(claimSig, { maxSupportedTransactionVersion: 0 });
      if (!tx?.meta) {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          tx = await connection.getTransaction(claimSig, { maxSupportedTransactionVersion: 0 });
          if (tx?.meta) break;
        }
      }
      if (tx?.meta?.preBalances && tx?.meta?.postBalances) {
        const accountKeys = tx.transaction.message.getAccountKeys({
          accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined,
        });
        const preBalances = tx.meta.preBalances as number[];
        const postBalances = tx.meta.postBalances as number[];
        for (let i = 0; i < accountKeys.length; i++) {
          if (accountKeys.get(i)?.equals(keypair.publicKey)) {
            claimedLamports = Math.max(0, (postBalances[i] ?? 0) - (preBalances[i] ?? 0));
            break;
          }
        }
      }
    } catch (e) {
      console.warn("[claim-auto] Could not parse tx balance change, using balance delta:", e);
    }
    if (claimedLamports === 0) {
      const balanceAfter = await connection.getBalance(keypair.publicKey);
      claimedLamports = Math.max(0, balanceAfter - balanceBefore);
    }
    const claimedSol = claimedLamports / 1e9;
    console.log("[claim-auto] Claimed:", claimedLamports, "lamports (~", claimedSol.toFixed(6), "SOL)");

    // 3. If nothing meaningful claimed, log and return
    if (claimedLamports < MIN_CLAIM_LAMPORTS) {
      console.log("[creator-rewards]", { claimSig, claimedLamports });
      return NextResponse.json({
        success: true,
        claimSignature: claimSig,
        claimAmountLamports: claimedLamports,
        claimAmountSol: claimedSol,
        paymentSkipped: true,
        message: `Claimed ${claimedSol.toFixed(6)} SOL (below threshold, not paid to agent)`,
      });
    }

    // 4. Pay full claimed amount into agent (minus fee buffer) — same tx shape as manual 1 SOL test
    const payAmountLamports = Math.max(
      MIN_CLAIM_LAMPORTS,
      claimedLamports - FEE_BUFFER_LAMPORTS
    );

    const agent = new PumpAgent(
      new PublicKey(agentMint),
      "mainnet",
      connection
    );
    const memo = String(Math.floor(Math.random() * 900000000000) + 100000);
    const now = Math.floor(Date.now() / 1000);
    const startTime = String(now);
    const endTime = String(now + 86400);

    const payInstructions = await agent.buildAcceptPaymentInstructions({
      user: keypair.publicKey,
      currencyMint: WSOL_MINT,
      amount: String(payAmountLamports),
      memo,
      startTime,
      endTime,
      computeUnitLimit: 200_000,
      computeUnitPrice: 150_000,
    });

    const payTx = new Transaction();
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    payTx.recentBlockhash = blockhash;
    payTx.feePayer = keypair.publicKey;
    payTx.add(...payInstructions);

    payTx.sign(keypair);
    const paySig = await connection.sendRawTransaction(payTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: "confirmed",
    });

    await waitForConfirmation(connection, paySig);

    console.log("[creator-rewards]", { claimSig, paySig, payAmountLamports });

    return NextResponse.json({
      success: true,
      claimSignature: claimSig,
      claimAmountLamports: claimedLamports,
      claimAmountSol: claimedSol,
      paymentSignature: paySig,
      paymentAmountLamports: payAmountLamports,
      message: `Claimed ${claimedSol.toFixed(6)} SOL, paid ${(payAmountLamports / 1e9).toFixed(6)} SOL to agent`,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[claim-auto] Error:", errMsg, e);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
