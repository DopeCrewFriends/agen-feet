#!/usr/bin/env node
/**
 * Diagnose creator fee situation for the agent token.
 * Shows: bonding curve creator, fee sharing status, vault balances, minimum distributable.
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

const { Connection, PublicKey } = require("@solana/web3.js");
const { OnlinePumpSdk, PUMP_SDK, bondingCurvePda, feeSharingConfigPda, creatorVaultPda } = require("@pump-fun/pump-sdk");

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const agentMint = process.env.AGENT_TOKEN_MINT_ADDRESS;
  const creator = process.env.CREATOR_WALLET_PRIVATE_KEY ? "4mj9ZizeZo7c9How3vBom4HZtmPYsMLR9jc7ZQPoqbtW" : null;

  if (!rpc || !agentMint) {
    console.error("Missing SOLANA_RPC_URL or AGENT_TOKEN_MINT_ADDRESS");
    process.exit(1);
  }

  const conn = new Connection(rpc);
  const mint = new PublicKey(agentMint);
  const sdk = new OnlinePumpSdk(conn);

  console.log("Mint:", mint.toBase58());
  console.log("Creator (from env):", creator || "not set");

  // Bonding curve
  const bcPda = bondingCurvePda(mint);
  const bcInfo = await conn.getAccountInfo(bcPda);
  if (!bcInfo) {
    console.log("Bonding curve: not found");
    process.exit(1);
  }

  const bc = PUMP_SDK.decodeBondingCurveNullable(bcInfo);
  if (!bc) {
    console.log("Bonding curve: failed to decode");
    process.exit(1);
  }

  const sharingPda = feeSharingConfigPda(mint);
  const isFeeSharing = bc.creator.equals(sharingPda);

  console.log("Bonding curve creator:", bc.creator.toBase58());
  console.log("Fee sharing config PDA:", sharingPda.toBase58());
  console.log("Uses fee sharing:", isFeeSharing);

  // Standard creator vault (4mj9)
  if (creator) {
    const creatorPub = new PublicKey(creator);
    const bcBal = await sdk.getCreatorVaultBalance(creatorPub);
    const ammBal = await sdk.pumpAmmSdk.getCoinCreatorVaultBalance(creatorPub);
    console.log("\nStandard vault (creator", creator + "):");
    console.log("  Bonding curve vault:", (bcBal.toNumber() / 1e9).toFixed(6), "SOL");
    console.log("  AMM vault:", (ammBal.toNumber() / 1e9).toFixed(6), "SOL");
  }

  // Fee sharing vault
  const fsVaultPda = creatorVaultPda(sharingPda);
  const fsVaultInfo = await conn.getAccountInfo(fsVaultPda);
  if (fsVaultInfo) {
    const rentExempt = await conn.getMinimumBalanceForRentExemption(fsVaultInfo.data.length);
    const fsBalance = Math.max(0, (fsVaultInfo.lamports ?? 0) - rentExempt);
    console.log("\nFee sharing vault:", fsVaultPda.toBase58());
    console.log("  Balance:", (fsBalance / 1e9).toFixed(6), "SOL");
  } else {
    console.log("\nFee sharing vault: account not found");
  }

  // Minimum distributable (for fee sharing)
  if (isFeeSharing) {
    try {
      const minResult = await sdk.getMinimumDistributableFee(mint);
      console.log("\nMinimum distributable fee:");
      console.log("  minimumRequired:", (minResult.minimumRequired.toNumber() / 1e9).toFixed(6), "SOL");
      console.log("  distributableFees:", (minResult.distributableFees.toNumber() / 1e9).toFixed(6), "SOL");
      console.log("  canDistribute:", minResult.canDistribute);
      console.log("  isGraduated:", minResult.isGraduated);
    } catch (e) {
      console.log("\nMinimum distributable fee: error", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
