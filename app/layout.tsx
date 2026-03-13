import type { Metadata } from "next";
import "./globals.css";
import WalletProvider from "./components/WalletProvider";
import WalletModalWrapper from "./components/WalletModalWrapper";

export const metadata: Metadata = {
  title: "Exclusive Content",
  description: "Unlock exclusive content for 1 USDC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <WalletProvider>
          <WalletModalWrapper>{children}</WalletModalWrapper>
        </WalletProvider>
      </body>
    </html>
  );
}
