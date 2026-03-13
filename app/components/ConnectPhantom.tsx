"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";

function PhantomGhostIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C7 2 3 6 3 11c0 2.4 1 4.6 2.6 6.2V20h4v-2h2v2h2v-2h2v2h4v-2.8C20 15.6 21 13.4 21 11c0-5-4-9-9-9zm0 2c3.9 0 7 3.1 7 7 0 1.5-.5 2.8-1.4 3.9L17 15H7l-.6-2.1C5.5 11.8 5 10.5 5 9c0-3.9 3.1-7 7-7zm-2.5 6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" />
    </svg>
  );
}

export default function ConnectPhantom() {
  const { publicKey, connected, connect, disconnect, select, wallets } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const phantomWallet = wallets.find((w) => w.adapter.name === "Phantom");

  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [showDropdown]);

  const handleConnect = useCallback(async () => {
    if (!connect || !phantomWallet) return;
    setConnecting(true);
    try {
      await select(phantomWallet.adapter.name);
      await connect();
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  }, [connect, select, phantomWallet]);

  const handleDisconnect = useCallback(async () => {
    if (!disconnect) return;
    await disconnect();
    setShowDropdown(false);
  }, [disconnect]);

  const truncate = (addr: string) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

  if (connected && publicKey) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setShowDropdown((v) => !v)}
          className="flex items-center gap-2.5 pl-3 pr-3.5 py-2 rounded-full bg-[#1e1e24] border border-[#2d2d32] text-[var(--text)] text-sm font-medium hover:border-[#3d3d45] hover:bg-[#242428] transition-all duration-200"
        >
          <span className="w-7 h-7 rounded-full bg-[#AB9FF2]/20 flex items-center justify-center shrink-0">
            <PhantomGhostIcon className="w-4 h-4 text-[#AB9FF2]" />
          </span>
          <span className="tabular-nums">{truncate(publicKey.toBase58())}</span>
          <svg className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${showDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute right-0 top-full mt-2 z-50 py-1 rounded-xl bg-[#1a1a1d] border border-[#2d2d32] shadow-xl shadow-black/40 min-w-[180px] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#2d2d32]">
              <p className="text-xs text-[var(--text-muted)]">Connected</p>
              <p className="text-sm font-mono text-[var(--text)] truncate">{publicKey.toBase58()}</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              className="w-full px-4 py-3 text-left text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-[#222226] transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConnect}
      disabled={connecting || !phantomWallet}
      className="flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#AB9FF2] to-[#7C3AED] text-white text-sm font-semibold transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:shadow-[#AB9FF2]/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
    >
      {connecting ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Connecting…</span>
        </>
      ) : (
        <>
          <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <PhantomGhostIcon className="w-3.5 h-3.5 text-white" />
          </span>
          <span>Connect Phantom</span>
        </>
      )}
    </button>
  );
}
