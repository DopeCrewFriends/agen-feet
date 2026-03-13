"use client";

import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import ConnectPhantom from "./components/ConnectPhantom";
import { Transaction } from "@solana/web3.js";

type Status = "idle" | "request" | "sign" | "sending" | "verifying" | "success" | "error";

type ClaimLog = {
  timestamp: string;
  claimSignature?: string;
  claimAmountLamports?: number;
  claimAmountSol?: number;
  paymentSignature?: string;
  paymentAmountLamports?: number;
  error?: string;
};

export default function Home() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"usdc" | "sol">("usdc");

  const [creatorStats, setCreatorStats] = useState<{
    totalCollectedSol: number;
    claims: ClaimLog[];
    nextClaimInMs: number;
  } | null>(null);
  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await fetch("/api/claim-creator-fee/stats");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setCreatorStats({
            totalCollectedSol: data.totalCollectedSol ?? 0,
            claims: data.claims ?? [],
            nextClaimInMs: data.nextClaimInMs ?? 300000,
          });
          setCountdownMs(data.nextClaimInMs ?? 300000);
        }
      } catch {
        if (!cancelled) setCreatorStats({ totalCollectedSol: 0, claims: [], nextClaimInMs: 300000 });
      }
    }
    fetchStats();
    const t = setInterval(fetchStats, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (creatorStats && countdownMs === null) setCountdownMs(creatorStats.nextClaimInMs);
  }, [creatorStats, countdownMs]);

  useEffect(() => {
    if (creatorStats && countdownMs === null) setCountdownMs(creatorStats.nextClaimInMs);
  }, [creatorStats, countdownMs]);

  useEffect(() => {
    if (countdownMs == null) return;
    const id = setInterval(() => {
      setCountdownMs((m) => {
        const next = Math.max(0, (m ?? 0) - 1000);
        return next === 0 ? 300000 : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [countdownMs]);

  async function handleUnlock() {
    if (!publicKey || !signTransaction) {
      setError("Connect your wallet to unlock");
      return;
    }

    setError("");
    setMessage("");
    setImageUrl(null);
    setStatus("request");

    try {
      const reqRes = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userWallet: publicKey.toBase58(), currency }),
      });
      const reqData = await reqRes.json();
      if (!reqRes.ok) throw new Error(reqData.error || "Failed");
      const { transaction, memo, startTime, endTime, amount, currencyMint } = reqData;
      if (!transaction) throw new Error("No transaction");

      setStatus("sign");
      setMessage("Approve the payment in your wallet");

      const binary = atob(transaction);
      const txBuf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) txBuf[i] = binary.charCodeAt(i);
      const tx = Transaction.from(txBuf);
      const signedTx = await signTransaction(tx as Parameters<typeof signTransaction>[0]);

      setStatus("sending");
      setMessage("Processing payment…");

      await connection.sendRawTransaction((signedTx as Transaction).serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      setStatus("verifying");
      setMessage("Unlocking…");

      for (let attempt = 0; attempt < 10; attempt++) {
        const genRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userWallet: publicKey.toBase58(),
            memo,
            startTime,
            endTime,
            amount,
            currencyMint,
          }),
        });
        const genData = await genRes.json();

        if (genRes.ok) {
          setImageUrl(genData.imageUrl);
          setStatus("success");
          setMessage("");
          return;
        }
        if (genRes.status === 402) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(genData.error || "Failed");
      }

      throw new Error("Timed out. Try again.");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  const loading = ["request", "sign", "sending", "verifying"].includes(status);

  const formatCountdown = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-dark)] relative">
      <div className="absolute top-4 right-4 z-10">
        <ConnectPhantom />
      </div>

      <div className="w-full max-w-md">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
          {/* Main content area — shows locked state OR unlocked image */}
          <div className="relative aspect-[4/5] overflow-hidden">
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt="Unlocked"
                  className="w-full h-full object-cover"
                />
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-black/50 text-white text-sm hover:bg-black/70"
                >
                  Open full size
                </a>
              </>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-[#2d1b3d] via-[#1a1a2e] to-[#0f0f1a] flex items-center justify-center">
                <div className="absolute inset-0 backdrop-blur-2xl bg-black/60" />
                <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                  <div className="w-20 h-20 rounded-full bg-[var(--accent)]/20 flex items-center justify-center mb-4 border-2 border-[var(--accent)]/50">
                    <svg className="w-10 h-10 text-[var(--accent)]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                    </svg>
                  </div>
                  <span className="text-[var(--text-muted)] text-sm font-medium">Locked content</span>
                  <span className="text-[var(--text)] text-lg font-semibold mt-1">Exclusive feet pic</span>
                </div>
              </div>
            )}
          </div>

          {/* CTA section */}
          <div className="p-6 border-t border-[var(--border)]">
            {connected ? (
              <>
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setCurrency("usdc")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      currency === "usdc"
                        ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]"
                        : "bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border)]"
                    }`}
                  >
                    1 USDC
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrency("sol")}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                      currency === "sol"
                        ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]"
                        : "bg-[var(--bg-card-hover)] text-[var(--text-muted)] border border-[var(--border)]"
                    }`}
                  >
                    ~$1 in SOL
                  </button>
                </div>
                <button
                  onClick={handleUnlock}
                  disabled={loading}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-bright)] text-white font-display font-semibold text-lg shadow-lg hover:shadow-[var(--glow)] transition-all disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {imageUrl && "Unlock another"}
                  {!imageUrl && status === "idle" && (currency === "usdc" ? "Unlock for 1 USDC" : "Unlock for ~$1 in SOL")}
                  {!imageUrl && status === "request" && "Preparing…"}
                  {!imageUrl && status === "sign" && "Approve in wallet…"}
                  {!imageUrl && status === "sending" && "Processing…"}
                  {!imageUrl && status === "verifying" && "Unlocking…"}
                  {!imageUrl && status === "success" && "Unlocked"}
                  {!imageUrl && status === "error" && "Try again"}
                </button>
                {message && (
                  <p className="mt-3 text-center text-sm text-[var(--text-muted)]">{message}</p>
                )}
                {error && (
                  <p className="mt-3 text-center text-sm text-red-400">{error}</p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4">
                <p className="text-center text-[var(--text-muted)] text-sm">
                  Connect Phantom to unlock exclusive content
                </p>
                <ConnectPhantom />
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] mb-3">Creator rewards (auto-claimed every 5 min)</p>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Collected (recent)</span>
                  <span className="font-medium text-[var(--text)]">
                    {creatorStats ? `${creatorStats.totalCollectedSol.toFixed(6)} SOL` : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Claims</span>
                  <span className="font-medium text-[var(--text)]">
                    {creatorStats ? creatorStats.claims.length : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-muted)]">Next claim in</span>
                  <span className="font-mono font-medium text-[var(--accent)] tabular-nums">
                    {countdownMs != null ? formatCountdown(countdownMs) : "—"}
                  </span>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <p className="text-xs text-[var(--text-muted)] mb-2">Past claims</p>
                {creatorStats && creatorStats.claims.length > 0 ? (
                  <ul className="space-y-2 max-h-32 overflow-y-auto">
                    {creatorStats.claims.slice(0, 10).map((c, i) => {
                      const sig = c.paymentSignature || c.claimSignature;
                      const amount =
                        c.paymentAmountLamports != null
                          ? `${(c.paymentAmountLamports / 1e9).toFixed(6)} SOL`
                          : c.claimAmountSol != null
                            ? `${c.claimAmountSol.toFixed(6)} SOL`
                            : c.error ?? "—";
                      const time = new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      return (
                        <li key={i} className="text-xs flex justify-between items-center gap-2">
                          {sig ? (
                            <a
                              href={`https://solscan.io/tx/${sig}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-[var(--accent)] hover:underline truncate"
                            >
                              {amount}
                            </a>
                          ) : (
                            <span className="font-medium text-[var(--text)]">{amount}</span>
                          )}
                          <span className="text-[var(--text-muted)] shrink-0">{time}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">No claims yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
