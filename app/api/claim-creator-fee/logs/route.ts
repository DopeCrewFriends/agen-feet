import { NextResponse } from "next/server";

/**
 * Returns recent creator reward claim logs.
 * Logs are stored in memory and reset on cold start.
 * For production persistence, use a database or external logging service.
 */
export async function GET() {
  try {
    // Dynamic import to get the in-memory logs from the auto route
    // We need to share the log store - create a shared module
    const { getClaimLogs } = await import("../logs-store");
    const logs = getClaimLogs();
    return NextResponse.json({ logs });
  } catch {
    return NextResponse.json({ logs: [], message: "No logs available" });
  }
}
