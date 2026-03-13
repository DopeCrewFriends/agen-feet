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
