#!/usr/bin/env node
/**
 * Local claim loop — calls the auto-claim endpoint every minute.
 * Run alongside `npm run dev`. Vercel cron only runs when deployed.
 *
 * Usage: CRON_SECRET=yoursecret node scripts/claim-loop.js
 *    or: npm run claim-loop   (reads CRON_SECRET from .env)
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

loadEnv();

const CRON_SECRET = process.env.CRON_SECRET;
const BASE = process.env.BASE || "http://localhost:3000";

if (!CRON_SECRET) {
  console.error("❌ CRON_SECRET not set. Add it to .env or run: CRON_SECRET=xxx node scripts/claim-loop.js");
  process.exit(1);
}

async function run() {
  const ts = new Date().toISOString();
  try {
    const res = await fetch(`${BASE}/api/claim-creator-fee/auto`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    console.log(`[${ts}] ${res.status}`, body.message || body.error || body.raw || JSON.stringify(body));
    if (!res.ok) console.error("Response:", text);
  } catch (e) {
    console.error(`[${ts}] ERROR`, e.message);
  }
}

console.log("Claim loop started. Waiting 15s for server, then hitting", BASE, "every 5 min. Ctrl+C to stop.\n");
setTimeout(() => {
  run();
  setInterval(run, 5 * 60 * 1000);
}, 15_000);
