#!/usr/bin/env node
/**
 * Test: 1) Claim creator fees, 2) Pay into agent, 3) Distribute (allocates to buyback + withdraw).
 * Uses @pump-fun/pump-sdk for fee-sharing tokens (distributeCreatorFees); falls back to PumpPortal
 * for standard creator vault. buybackTrigger requires pump's global key - we can't call it.
 * Run: cd feet-pics && node scripts/claim-and-buyback.js
 */
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

const { Connection, Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction } = require("@solana/web3.js");
const { PumpAgent } = require("@pump-fun/agent-payments-sdk");
const { OnlinePumpSdk, PUMP_SDK, bondingCurvePda, feeSharingConfigPda } = require("@pump-fun/pump-sdk");
const { ComputeBudgetProgram } = require("@solana/web3.js");
const bs58 = require("bs58");

const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const FEE_BUFFER_LAMPORTS = 50_000;
const MIN_PAY_LAMPORTS = 10_000;

async function waitForConfirm(conn, sig, maxMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const status = await conn.getSignatureStatuses([sig]);
    const s = status.value[0];
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
    if (s?.err) throw new Error(`Tx failed: ${JSON.stringify(s.err)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Confirm timeout");
}

async function buildClaimTx(conn, keypair, agentMint) {
  const sdk = new OnlinePumpSdk(conn);
  const mint = new PublicKey(agentMint);
  let ixs = [];

  // Check if fee sharing token
  const bcPda = bondingCurvePda(mint);
  const bcInfo = await conn.getAccountInfo(bcPda);
  if (bcInfo) {
    const bc = PUMP_SDK.decodeBondingCurveNullable(bcInfo);
    if (bc && bc.creator.equals(feeSharingConfigPda(mint))) {
      const res = await sdk.buildDistributeCreatorFeesInstructions(mint);
      return { ixs: res.instructions, mode: "distribute" };
    }
  }

  // Standard: collectCreatorFee + collectCoinCreatorFee (bonding + AMM)
  ixs = await sdk.collectCoinCreatorFeeInstructions(keypair.publicKey, keypair.publicKey);
  return { ixs, mode: "collect" };
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const agentMint = process.env.AGENT_TOKEN_MINT_ADDRESS;
  const pk = process.env.CREATOR_WALLET_PRIVATE_KEY;
  if (!rpc || !agentMint || !pk) {
    console.error("Missing env");
    process.exit(1);
  }

  const trimmed = pk.trim();
  const secret = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed))
    : (bs58.default?.decode ?? bs58.decode)(trimmed);
  const keypair = Keypair.fromSecretKey(secret);
  const conn = new Connection(rpc);

  console.log("Creator:", keypair.publicKey.toBase58());
  console.log("Agent mint:", agentMint);

  // 1. Claim creator fees (pump SDK for fee-sharing, PumpPortal fallback for standard)
  const balanceBefore = await conn.getBalance(keypair.publicKey);
  console.log("\n1. Claiming creator fees...");

  let claimSig;
  try {
    const { ixs, mode } = await buildClaimTx(conn, keypair, agentMint);
    if (ixs.length > 0) {
      console.log("Using pump SDK, mode:", mode);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
          ...ixs,
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([keypair]);
      claimSig = await conn.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });
    } else {
      throw new Error("No instructions from pump SDK");
    }
  } catch (e) {
    console.log("Pump SDK claim failed:", e.message, "- trying PumpPortal...");
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
      console.error("PumpPortal error:", claimRes.status, text);
      process.exit(1);
    }
    const claimTx = VersionedTransaction.deserialize(new Uint8Array(await claimRes.arrayBuffer()));
    claimTx.sign([keypair]);
    claimSig = await conn.sendRawTransaction(claimTx.serialize(), {
      skipPreflight: true,
      preflightCommitment: "confirmed",
    });
  }

  console.log("Claim tx:", claimSig);
  await waitForConfirm(conn, claimSig);

  // Derive claimed amount
  let claimedLamports = 0;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const tx = await conn.getTransaction(claimSig, { maxSupportedTransactionVersion: 0 });
    if (tx?.meta?.preBalances && tx?.meta?.postBalances) {
      const keys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta.loadedAddresses ?? undefined,
      });
      for (let j = 0; j < keys.length; j++) {
        if (keys.get(j)?.equals(keypair.publicKey)) {
          claimedLamports = Math.max(0, (tx.meta.postBalances[j] ?? 0) - (tx.meta.preBalances[j] ?? 0));
          break;
        }
      }
      if (claimedLamports > 0) break;
    }
  }
  if (claimedLamports === 0) {
    const balanceAfter = await conn.getBalance(keypair.publicKey);
    claimedLamports = Math.max(0, balanceAfter - balanceBefore);
  }
  const payAmountLamports = Math.max(0, claimedLamports - FEE_BUFFER_LAMPORTS);
  console.log("Claimed:", (claimedLamports / 1e9).toFixed(6), "SOL");
  console.log("Pay amount:", (payAmountLamports / 1e9).toFixed(6), "SOL");

  if (payAmountLamports < MIN_PAY_LAMPORTS) {
    console.log("Amount too small (<", MIN_PAY_LAMPORTS, "lamports), skipping pay+distribute");
    process.exit(0);
  }

  // 2. Pay into agent
  console.log("\n2. Paying into agent...");
  const agent = new PumpAgent(new PublicKey(agentMint), "mainnet", conn);
  const memo = String(Math.floor(Math.random() * 900000000000) + 100000);
  const now = Math.floor(Date.now() / 1000);
  const payIxs = await agent.buildAcceptPaymentInstructions({
    user: keypair.publicKey,
    currencyMint: WSOL_MINT,
    amount: String(payAmountLamports),
    memo,
    startTime: String(now),
    endTime: String(now + 86400),
    computeUnitLimit: 200_000,
    computeUnitPrice: 150_000,
  });
  const payTx = new Transaction();
  payTx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  payTx.feePayer = keypair.publicKey;
  payTx.add(...payIxs);
  payTx.sign(keypair);
  const paySig = await conn.sendRawTransaction(payTx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
  console.log("Pay tx:", paySig);
  await waitForConfirm(conn, paySig);

  // 3. Distribute (moves payment vault → buyback vault + withdraw vault)
  console.log("\n3. Distributing (allocates to buyback + withdraw)...");
  const distIx = await agent.distributePayments({
    user: keypair.publicKey,
    currencyMint: WSOL_MINT,
    includeTransferExtraLamportsForNative: true,
  });
  const distTx = new Transaction();
  distTx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  distTx.feePayer = keypair.publicKey;
  distTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 150_000 }), ...distIx);
  distTx.sign(keypair);
  const distSig = await conn.sendRawTransaction(distTx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
  console.log("Distribute tx:", distSig);
  await waitForConfirm(conn, distSig);

  console.log("\nDone.");
  console.log("Claim: https://solscan.io/tx/" + claimSig);
  console.log("Pay:   https://solscan.io/tx/" + paySig);
  console.log("Dist:  https://solscan.io/tx/" + distSig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
