#!/usr/bin/env node
/**
 * Claim creator fees using @pump-fun/pump-sdk directly.
 * Handles: 1) Standard creator vault (bonding curve + AMM)
 *          2) Fee sharing config (distributeCreatorFees) - when creator migrated
 * Run: cd feet-pics && node scripts/claim-direct.js
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

const { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } = require("@solana/web3.js");
const { OnlinePumpSdk, PUMP_SDK, bondingCurvePda, feeSharingConfigPda } = require("@pump-fun/pump-sdk");
const { ComputeBudgetProgram } = require("@solana/web3.js");
const bs58 = require("bs58");

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

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const pk = process.env.CREATOR_WALLET_PRIVATE_KEY;
  const agentMint = process.env.AGENT_TOKEN_MINT_ADDRESS;
  if (!rpc || !pk) {
    console.error("Missing SOLANA_RPC_URL or CREATOR_WALLET_PRIVATE_KEY");
    process.exit(1);
  }

  const trimmed = pk.trim();
  const secret = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed))
    : (bs58.default?.decode ?? bs58.decode)(trimmed);
  const keypair = Keypair.fromSecretKey(secret);
  const conn = new Connection(rpc);
  const creator = keypair.publicKey;
  const mint = agentMint ? new PublicKey(agentMint) : null;

  console.log("Creator:", creator.toBase58());
  if (mint) console.log("Agent mint:", mint.toBase58());

  const sdk = new OnlinePumpSdk(conn);

  let ixs = [];
  let claimMode = null;

  // 1. Check if token uses fee sharing (bonding curve creator = fee sharing config PDA)
  if (mint) {
    const bcPda = bondingCurvePda(mint);
    const bcInfo = await conn.getAccountInfo(bcPda);
    if (bcInfo) {
      const bc = PUMP_SDK.decodeBondingCurveNullable(bcInfo);
      if (bc) {
        const sharingPda = feeSharingConfigPda(mint);
        const isFeeSharing = bc.creator.equals(sharingPda);
        console.log("Bonding curve creator:", bc.creator.toBase58());
        console.log("Fee sharing:", isFeeSharing);

        if (isFeeSharing) {
          const sharingInfo = await conn.getAccountInfo(sharingPda);
          if (sharingInfo) {
            claimMode = "distribute";
            const res = await sdk.buildDistributeCreatorFeesInstructions(mint);
            ixs = res.instructions;
            console.log("Claim mode: distributeCreatorFees (fee sharing)");
            console.log("Graduated:", res.isGraduated);
          }
        }
      }
    }
  }

  // 2. Standard creator vault (bonding curve + AMM)
  if (ixs.length === 0) {
    const bcBalance = await sdk.getCreatorVaultBalance(creator);
    const ammBalance = await sdk.pumpAmmSdk.getCoinCreatorVaultBalance(creator);
    const totalLamports = bcBalance.add(ammBalance).toNumber();
    console.log("Creator vault (bonding curve):", (bcBalance.toNumber() / 1e9).toFixed(6), "SOL");
    console.log("Creator vault (AMM/PumpSwap):", (ammBalance.toNumber() / 1e9).toFixed(6), "SOL");
    console.log("Total claimable:", (totalLamports / 1e9).toFixed(6), "SOL");

    if (totalLamports === 0) {
      console.log("Nothing to claim from standard vault.");
      if (!claimMode) process.exit(0);
    } else {
      claimMode = "collect";
      ixs = await sdk.collectCoinCreatorFeeInstructions(creator, creator);
      console.log("Claim mode: collectCreatorFee (standard)");
    }
  }

  if (ixs.length === 0) {
    console.log("No claimable amount found.");
    process.exit(0);
  }

  const balanceBefore = await conn.getBalance(creator);
  console.log("\nInstructions:", ixs.length);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: creator,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }),
      ...ixs,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([keypair]);

  console.log("Sending claim tx...");
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  console.log("Tx:", sig);
  await waitForConfirm(conn, sig);

  const balanceAfter = await conn.getBalance(creator);
  const claimed = balanceAfter - balanceBefore;
  console.log("Claimed:", (claimed / 1e9).toFixed(6), "SOL");
  console.log("https://solscan.io/tx/" + sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
