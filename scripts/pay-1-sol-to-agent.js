#!/usr/bin/env node
/**
 * One-off: Pay 1 SOL into the agent from CREATOR_WALLET.
 * Run: cd feet-pics && node scripts/pay-1-sol-to-agent.js
 */
const fs = require("fs");
const path = require("path");

// Load .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { PumpAgent } = require("@pump-fun/agent-payments-sdk");
const bs58 = require("bs58");

const AMOUNT_LAMPORTS = BigInt(1e9); // 1 SOL

async function main() {
  const rpc = process.env.SOLANA_RPC_URL;
  const agentMint = process.env.AGENT_TOKEN_MINT_ADDRESS;
  const pk = process.env.CREATOR_WALLET_PRIVATE_KEY;

  if (!rpc || !agentMint || !pk) {
    console.error("Missing SOLANA_RPC_URL, AGENT_TOKEN_MINT_ADDRESS, or CREATOR_WALLET_PRIVATE_KEY");
    process.exit(1);
  }

  const trimmed = pk.trim();
  const secret = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed))
    : (bs58.default?.decode ?? bs58.decode)(trimmed);
  const keypair = Keypair.fromSecretKey(secret);

  const conn = new Connection(rpc);
  const agent = new PumpAgent(new PublicKey(agentMint), "mainnet", conn);

  const memo = String(Math.floor(Math.random() * 900000000000) + 100000);
  const now = Math.floor(Date.now() / 1000);
  const startTime = String(now);
  const endTime = String(now + 86400);

  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

  const payIxs = await agent.buildAcceptPaymentInstructions({
    user: keypair.publicKey,
    currencyMint: WSOL_MINT,
    amount: String(AMOUNT_LAMPORTS),
    memo,
    startTime,
    endTime,
    computeUnitLimit: 200_000,
    computeUnitPrice: 150_000,
  });

  const tx = new Transaction();
  tx.add(...payIxs);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.sign(keypair);

  console.log("Sending 1 SOL to agent", agentMint, "from", keypair.publicKey.toBase58());
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
  console.log("Tx:", sig);
  console.log("https://solscan.io/tx/" + sig);

  // Wait for confirm
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await conn.getSignatureStatuses([sig]);
    const s = status.value[0];
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
      console.log("Confirmed");
      return;
    }
    if (s?.err) {
      console.error("Failed:", s.err);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log("\nTimeout waiting for confirm, check solscan");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
