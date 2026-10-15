import { createHash } from "node:crypto";

export const BETA_EVENT_NAMES = [
  "landing_viewed", "room_created", "room_joined", "lobby_reached",
  "session_started", "chaos_intensity_selected", "game_started",
  "game_completed", "session_round_reached", "house_rule_selected",
  "power_used", "objective_completed", "objective_revealed",
  "reconnect_attempted", "reconnect_succeeded", "reconnect_failed",
  "player_left", "finale_reached", "session_completed", "replay_started",
  "feedback_opened", "feedback_submitted", "runtime_error",
] as const;

export type BetaEventName = (typeof BETA_EVENT_NAMES)[number];
export type BetaErrorCode = "auth" | "network" | "server" | "unknown";
export type BetaEvent = {
  name: BetaEventName;
  roomId?: string;
  sessionKey?: string;
  gameId?: string;
  gameNumber?: number;
  playerCount?: number;
  chaosIntensity?: "standard" | "high";
  houseRuleId?: string;
  powerId?: string;
  errorCode?: BetaErrorCode;
};

export function betaSessionKey(roomId: string, seed: string) {
  return createHash("sha256").update(`${roomId}:${seed}`).digest("hex");
}
export async function recordBetaEvents(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> }, events: BetaEvent[]) {
  if (!events.length) return;
  try {
    await db.rpc("cr_record_beta_events", {
      p_events: events.map((event) => ({
        name: event.name,
        room_id: event.roomId,
        session_key: event.sessionKey,
        game_id: event.gameId,
        game_number: event.gameNumber,
        player_count: event.playerCount,
        chaos_intensity: event.chaosIntensity,
        house_rule_id: event.houseRuleId,
        power_id: event.powerId,
        error_code: event.errorCode,
      })),
    });
  } catch {
    // Beta telemetry is deliberately best-effort and must never block play.
  }
}

