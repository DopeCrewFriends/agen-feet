import fs from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

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
const REDIS_KEY = "feet-pics:claim-logs";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function getLogsPath(): string {
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

async function loadFromRedis(): Promise<ClaimLog[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get(REDIS_KEY);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.error("[claim-logs] redis read error:", e);
  }
  return [];
}

async function saveToRedis(logs: ClaimLog[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(REDIS_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error("[claim-logs] redis write error:", e);
  }
}

export async function logClaim(entry: ClaimLog) {
  const redis = getRedis();
  if (redis) {
    const logs = await loadFromRedis();
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.pop();
    await saveToRedis(logs);
  } else {
    const logs = loadFromFile();
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.pop();
    saveToFile(logs);
  }
  console.log("[creator-rewards]", JSON.stringify(entry));
}

export async function getClaimLogs(): Promise<ClaimLog[]> {
  const redis = getRedis();
  return redis ? loadFromRedis() : loadFromFile();
}
