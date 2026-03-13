# agen-feet

Paywall site — pay 1 USDC or ~$1 in SOL to unlock AI-generated exclusive content.

## Setup

1. Clone and install:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your values:
   - `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL` — Solana RPC
   - `AGENT_TOKEN_MINT_ADDRESS` — your pump.fun tokenized agent mint
   - `REPLICATE_API_TOKEN` — get at [replicate.com](https://replicate.com)

3. Run:
   ```bash
   npm run dev
   ```

## Env vars

| Variable | Description |
|----------|-------------|
| `SOLANA_RPC_URL` | Server-side RPC |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Client-side RPC (wallet) |
| `AGENT_TOKEN_MINT_ADDRESS` | Pump tokenized agent mint |
| `CURRENCY_MINT` | USDC mint (default: EPjFWdd5...) |
| `PRICE_AMOUNT` | USDC price in smallest units (1e6 = 1 USDC) |
| `PRICE_SOL_LAMPORTS` | SOL price in lamports (~$1 worth) |
| `REPLICATE_API_TOKEN` | Replicate API key |
| `CREATOR_WALLET_PRIVATE_KEY` | Optional: JSON array for auto-claim (bonding curve creator) |
| `CRON_SECRET` | Required for auto-claim endpoint; use as `Authorization: Bearer <secret>` |

## Creator rewards vs agent revenue

- **Agent revenue** — USDC/SOL from users paying to unlock content. Claim via `PumpAgent.withdraw()` (agent authority).
- **Creator rewards** — SOL from trading fees when people buy/sell the agent token on pump.fun. Different stream.

### Manual claim

When connected, use the "Claim creator rewards (SOL)" button. Your wallet must be the bonding curve creator for the agent token.

### Auto-claim (every 5 minutes)

A cron runs every 5 min: (1) claim, (2) wrap to wSOL and pay into agent, (3) log. Set in `.env`:

- `CREATOR_WALLET_PRIVATE_KEY` — JSON array, e.g. `[1,2,3,...,64]` (the bonding curve creator’s keypair)
- `CRON_SECRET` — Vercel sends this for cron; use for manual curl

Manual trigger: `curl -X POST .../api/claim-creator-fee/auto -H "Authorization: Bearer $CRON_SECRET"`. Logs: `GET /api/claim-creator-fee/logs`.




