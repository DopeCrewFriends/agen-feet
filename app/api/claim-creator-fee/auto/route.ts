import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { PumpAgent } from "@pump-fun/agent-payments-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { logClaim, type ClaimLog } from "../logs-store";

const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";
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

    // 2. Claim creator rewards
    const claimRes = await fetch(PUMPPORTAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: 0.000001,
        pool: "pump",
      }),
    });

    if (!claimRes.ok) {
      const text = await claimRes.text();
      console.error("[claim-auto] PumpPortal error:", claimRes.status, text);
      let errMsg = `PumpPortal error (${claimRes.status})`;
      try {
        const json = JSON.parse(text);
        if (json.error || json.message) errMsg = json.error || json.message;
      } catch {
        if (text.length < 200) errMsg = text || errMsg;
      }
      const entry: ClaimLog = {
        timestamp: new Date().toISOString(),
        error: `Claim failed: ${errMsg}`,
      };
      logClaim(entry);
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const claimTxBuf = await claimRes.arrayBuffer();
    const claimTx = VersionedTransaction.deserialize(new Uint8Array(claimTxBuf));
    claimTx.sign([keypair]);

    console.log("[claim-auto] Sending claim tx...");
    const claimSig = await connection.sendRawTransaction(claimTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

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
      const entry: ClaimLog = {
        timestamp: new Date().toISOString(),
        claimSignature: claimSig,
        claimAmountLamports: claimedLamports,
        claimAmountSol: claimedSol,
      };
      logClaim(entry);
      return NextResponse.json({
        success: true,
        claimSignature: claimSig,
        claimAmountLamports: claimedLamports,
        claimAmountSol: claimedSol,
        paymentSkipped: true,
        message: `Claimed ${claimedSol.toFixed(6)} SOL (below threshold, not paid to agent)`,
      });
    }

    // 4. Pay full claimed amount into agent (minus fee buffer)
    const payAmountLamports = Math.max(
      MIN_CLAIM_LAMPORTS,
      claimedLamports - FEE_BUFFER_LAMPORTS
    );

    const wsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      keypair.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
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
    });

    const payTx = new Transaction();
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    payTx.recentBlockhash = blockhash;
    payTx.feePayer = keypair.publicKey;
    payTx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey,
        wsolAta,
        keypair.publicKey,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: wsolAta,
        lamports: payAmountLamports,
      }),
      createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
      ...payInstructions
    );

    payTx.sign(keypair);
    const paySig = await connection.sendRawTransaction(payTx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await waitForConfirmation(connection, paySig);

    const entry: ClaimLog = {
      timestamp: new Date().toISOString(),
      claimSignature: claimSig,
      claimAmountLamports: claimedLamports,
      claimAmountSol: claimedSol,
      paymentSignature: paySig,
      paymentAmountLamports: payAmountLamports,
    };
    logClaim(entry);

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
    const entry: ClaimLog = {
      timestamp: new Date().toISOString(),
      error: errMsg,
    };
    logClaim(entry);
    console.error("[claim-creator-fee/auto]", e);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
