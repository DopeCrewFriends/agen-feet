import fs from "fs";
import path from "path";

export type ClaimLog = {
  timestamp: string;
  claimSignature?: string;
  claimAmountLamports?: number;
  claimAmountSol?: number;
  paymentSignature?: string;
  paymentAmountLamports?: number;
  error?: string;
};

const MAX_LOGS = 100;

function getLogsPath(): string {
  // Use /tmp in serverless (Vercel), project data dir otherwise
  const base = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data");
  return path.join(base, "claim-logs.json");
}

function loadFromFile(): ClaimLog[] {
  try {
    const filePath = getLogsPath();
    const dir = path.dirname(filePath);
    if (!process.env.VERCEL && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error("[claim-logs] read error:", e);
  }
  return [];
}

function saveToFile(logs: ClaimLog[]): void {
  try {
    const filePath = getLogsPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(logs, null, 0), "utf-8");
  } catch (e) {
    console.error("[claim-logs] write error:", e);
  }
}

export function logClaim(entry: ClaimLog) {
  const logs = loadFromFile();
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.pop();
  saveToFile(logs);
  console.log("[creator-rewards]", JSON.stringify(entry));
}

export function getClaimLogs(): ClaimLog[] {
  return loadFromFile();
}
