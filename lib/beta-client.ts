import type { BetaErrorCode } from "@/lib/beta";

export function classifyBetaError(message: string): BetaErrorCode {
  const value = message.toLowerCase();
  if (value.includes("auth") || value.includes("session")) return "auth";
  if (value.includes("network") || value.includes("fetch") || value.includes("connection")) return "network";
  if (value.includes("server") || value.includes("supabase")) return "server";
  return "unknown";
}

export function trackClientBetaEvent(name: "landing_viewed" | "reconnect_attempted" | "reconnect_succeeded" | "reconnect_failed" | "feedback_opened" | "runtime_error", options: { code?: string; errorCode?: BetaErrorCode } = {}) {
  try {
    void (async () => {
      const { browserClient } = await import("@/lib/browser");
      const { data } = await browserClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) return;
      await fetch("/api/beta", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ name, ...options }),
        keepalive: true,
      });
    })().catch(() => {});
  } catch {
    // A missing browser session is not a gameplay error.
  }
}
