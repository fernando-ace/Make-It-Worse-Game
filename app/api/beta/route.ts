import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { BETA_EVENT_NAMES, betaSessionKey, recordBetaEvents, type BetaEvent } from "@/lib/beta";
import type { Room } from "@/lib/types";
import { getEnvironmentSafety } from "@/lib/environment-safety.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clientEvents = new Set([
  "landing_viewed", "reconnect_attempted", "reconnect_succeeded",
  "reconnect_failed", "feedback_opened", "runtime_error",
]);

export async function POST(req: NextRequest) {
  try {
    if (!getEnvironmentSafety().runtimeMutationAllowed)
      return NextResponse.json({ error: "This deployment is not connected to an approved telemetry backend." }, { status: 503 });
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    const db = admin();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Session expired." }, { status: 401 });

    const body = await req.json();
    if (!BETA_EVENT_NAMES.includes(body.name) || !clientEvents.has(body.name))
      return NextResponse.json({ error: "Unsupported event." }, { status: 400 });

    let event: BetaEvent = { name: body.name };
    if (body.name === "runtime_error") {
      if (!["auth", "network", "server", "unknown"].includes(body.errorCode))
        return NextResponse.json({ error: "Invalid error category." }, { status: 400 });
      event.errorCode = body.errorCode;
    }
    if (body.name !== "landing_viewed") {
      const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
      if (!/^[A-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "Room code is missing." }, { status: 400 });
      const { data, error } = await db.rpc("cr_read", { p_code: code });
      if ((error || !data) && body.name === "reconnect_failed") {
        await recordBetaEvents(db, [event]);
        return new NextResponse(null, { status: 204 });
      }
      if (error || !data) return NextResponse.json({ error: "Room is no longer available." }, { status: 404 });
      const room = data.room as Room;
      if (!room.players.some((player) => player.id === auth.user!.id))
        return NextResponse.json({ error: "You are no longer in this room." }, { status: 403 });
      if (body.name === "feedback_opened" && (room.session?.phase !== "final-results" || !room.session.objectivesRevealedBy?.includes(auth.user!.id)))
        return NextResponse.json({ error: "This event is not available yet." }, { status: 409 });
      event = { ...event, roomId: room.id };
      if (room.session) event.sessionKey = betaSessionKey(room.id, room.session.seed);
    }
    await recordBetaEvents(db, [event]);
    return new NextResponse(null, { status: 204 });
  } catch {
    // Analytics failures are intentionally invisible to the player.
    return new NextResponse(null, { status: 204 });
  }
}
