import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { betaSessionKey, recordBetaEvents } from "@/lib/beta";
import { MINIGAMES } from "@/lib/games";
import type { Room } from "@/lib/types";
import { getEnvironmentSafety } from "@/lib/environment-safety.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!getEnvironmentSafety().runtimeMutationAllowed)
      return NextResponse.json({ error: "This deployment is not connected to an approved feedback backend." }, { status: 503 });
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return NextResponse.json({ error: "Reconnect before sending feedback." }, { status: 401 });
    const db = admin();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Your connection expired. Reconnect and try again." }, { status: 401 });
    const body = await req.json();
    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    if (!/^[A-Z2-9]{6}$/.test(code)) return NextResponse.json({ error: "The session is no longer available." }, { status: 400 });
    if (!Number.isInteger(body.funRating) || body.funRating < 1 || body.funRating > 5)
      return NextResponse.json({ error: "Choose a fun rating from 1 to 5." }, { status: 400 });
    if (typeof body.playAgain !== "boolean") return NextResponse.json({ error: "Choose whether you would play again." }, { status: 400 });
    const { data, error } = await db.rpc("cr_read", { p_code: code });
    if (error || !data) return NextResponse.json({ error: "That completed session is no longer available." }, { status: 404 });
    const room = data.room as Room;
    if (!room.players.some((player) => player.id === auth.user!.id))
      return NextResponse.json({ error: "Only players in this session can leave feedback." }, { status: 403 });
    if (room.session?.phase !== "final-results")
      return NextResponse.json({ error: "Feedback opens after the session ends." }, { status: 409 });
    if (!room.session.objectivesRevealedBy?.includes(auth.user.id))
      return NextResponse.json({ error: "Reveal the secret objectives before leaving feedback." }, { status: 409 });

    const played = new Set(room.session.gameSlots);
    const validGame = (value: unknown) => value === "" || (typeof value === "string" && played.has(value) && Boolean(MINIGAMES[value]));
    if (!validGame(body.favoriteGame) || !validGame(body.leastFavoriteGame))
      return NextResponse.json({ error: "Choose a game from this session." }, { status: 400 });
    if (typeof body.confusion !== "string" || body.confusion.length > 500 || typeof body.comment !== "string" || body.comment.length > 1200)
      return NextResponse.json({ error: "Feedback is too long. Shorten it and try again." }, { status: 400 });

    const sessionKey = betaSessionKey(room.id, room.session.seed);
    const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Server configuration incomplete");
    const respondentKey = createHmac("sha256", secret).update(`${auth.user.id}:${sessionKey}`).digest("hex");
    const { data: inserted, error: submitError } = await db.rpc("cr_submit_beta_feedback", {
      p_room_id: room.id,
      p_session_key: sessionKey,
      p_respondent_key: respondentKey,
      p_fun_rating: body.funRating,
      p_play_again: body.playAgain,
      p_favorite_game: body.favoriteGame,
      p_least_favorite_game: body.leastFavoriteGame,
      p_confusion: redactContactDetails(body.confusion.trim()),
      p_comment: redactContactDetails(body.comment.trim()),
    });
    if (submitError) throw submitError;
    if (inserted) await recordBetaEvents(db, [{ name: "feedback_submitted", roomId: room.id, sessionKey }]);
    return NextResponse.json({ submitted: Boolean(inserted) }, { status: inserted ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Feedback could not be saved right now. You can keep playing or try again later." }, { status: 503 });
  }
}
function redactContactDetails(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "[link removed]")
    .replace(/(?<!\w)\+?\d[\d().\s-]{7,}\d(?!\w)/g, "[phone removed]");
}

