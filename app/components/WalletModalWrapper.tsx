"use client";

import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletModalWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WalletModalProvider>{children}</WalletModalProvider>;
}
