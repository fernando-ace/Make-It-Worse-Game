import { NextRequest, NextResponse } from "next/server";
import { randomInt, randomUUID } from "node:crypto";
import { admin } from "@/lib/server";
import { betaSessionKey, recordBetaEvents, type BetaEvent } from "@/lib/beta";
import { apply, join, snapshot } from "@/lib/engine";
import type { Room } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token)
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    const db = admin();
    const { data: user, error: authError } = await db.auth.getUser(token);
    if (authError || !user.user)
      return NextResponse.json(
        { error: "Session expired. Reconnect to continue." },
        { status: 401 },
      );
    const uid = user.user.id;
    const body = await req.json();
    if (!["create", "join", "action", "leave", "kick"].includes(body.op))
      throw new Error("Invalid request");
    if (
      typeof body.actionId !== "string" ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(body.actionId)
    )
      throw new Error("Invalid action ID");
    const name = String(body.name ?? "")
      .trim()
      .slice(0, 24);
    if (["create", "join"].includes(body.op) && !name)
      throw new Error("Enter your name");
    if (body.op === "create") {
      for (let attempt = 0; attempt < 4; attempt++) {
        const now = Date.now();
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const code = Array.from(
          { length: 6 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
        const room: Room = {
          id: randomUUID(),
          code,
          hostId: uid,
          revision: 0,
          createdAt: now,
          players: [
            { id: uid, name, seenAt: now },
          ],
          chaosIntensity: "standard",
          session: null,
          processed: [],
        };
        const { error } = await db.rpc("cr_create", { p_room: room });
        if (!error) {
          await recordBetaEvents(db, [
            { name: "room_created", roomId: room.id, playerCount: 1, chaosIntensity: room.chaosIntensity },
            { name: "lobby_reached", roomId: room.id, playerCount: 1 },
          ]);
          return NextResponse.json(snapshot(room, uid, now), {
            headers: { "Cache-Control": "no-store" },
          });
        }
        if (error.code !== "23505") throw new Error(error.message);
      }
      throw new Error("Could not allocate a room code. Try again.");
    }
    const code = String(body.code ?? "").toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code))
      throw new Error("Enter a six-character room code");
    for (let attempt = 0; attempt < 25; attempt++) {
      const { data, error } = await db.rpc("cr_read", { p_code: code });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Room not found");
      const room = data.room as Room,
        now = Number(data.now);
      const revision = room.revision;
      const before = structuredClone(room);
      const alreadyMember = room.players.some((player) => player.id === uid);
      if (body.op === "join") join(room, uid, name, now);
      else if (body.op === "leave" || body.op === "kick") {
        const targetId = body.op === "leave" ? uid : String(body.targetId ?? "");
        if (body.op === "kick" && uid !== room.hostId)
          throw new Error("Only the host can remove a guest");
        if (!targetId || (body.op === "kick" && targetId === room.hostId))
          throw new Error("The host cannot remove themselves");
        const target = room.players.find((player) => player.id === targetId);
        if (!target)
          return NextResponse.json(
            { error: "You are no longer a member of this room" },
            { status: 410 },
          );
        room.players = room.players.filter((player) => player.id !== targetId);
        if (body.op === "kick")
          room.blockedPlayers = [...new Set([...(room.blockedPlayers ?? []), targetId])];
        if (room.hostId === targetId && room.players.length)
          room.hostId = room.players[0].id;
      } else {
        if (!room.players.some((player) => player.id === uid))
          return NextResponse.json(
            { error: "The host removed you from this room" },
            { status: 410 },
          );
        if (!body.action || typeof body.action.type !== "string")
          throw new Error("Invalid action");
        apply(room, uid, body.action, now, body.actionId);
      }
      if (
        body.op === "action" &&
        body.action.type === "sync" &&
        body.action.value === false
      )
        return NextResponse.json(snapshot(room, uid, now), {
          headers: { "Cache-Control": "no-store" },
        });
      room.revision = revision + 1;
      const { data: committed, error: commitError } = await db.rpc(
        "cr_commit",
        { p_room: room, p_expected: revision },
      );
      if (commitError) throw new Error(commitError.message);
      if (committed) {
        await recordBetaEvents(db, committedEvents(before, room, body.op, body.action, alreadyMember, uid));
        if (body.op === "leave")
          return NextResponse.json(
            { left: true },
            {
              headers: { "Cache-Control": "no-store" },
            },
          );
        return NextResponse.json(snapshot(room, uid, now), {
          headers: { "Cache-Control": "no-store" },
        });
      }
      if (attempt < 24)
        await new Promise((resolve) => setTimeout(resolve, randomInt(8, 25)));
    }
    return NextResponse.json(
      { error: "Room busy. Please retry." },
      { status: 409 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message.startsWith("Server configuration") ? 503 : 400 },
    );
  }
}

function committedEvents(before: Room, after: Room, op: string, action: { type?: string; value?: string | number | boolean } | undefined, alreadyMember: boolean, uid: string): BetaEvent[] {
  const events: BetaEvent[] = [];
  const session = after.session;
  const previousSession = before.session;
  const sessionKey = session ? betaSessionKey(after.id, session.seed) : undefined;
  const gameNumber = session?.gameNumber;
  const gameId = session && gameNumber ? session.gameSlots[gameNumber - 1] : undefined;
  const base = { roomId: after.id, sessionKey, gameNumber, gameId, playerCount: after.players.length, chaosIntensity: session?.chaosIntensity ?? after.chaosIntensity };
  const add = (name: BetaEvent["name"], fields: Partial<BetaEvent> = {}) => events.push({ name, ...base, ...fields });

  if (op === "join") {
    if (!alreadyMember) add("room_joined");
    add("lobby_reached");
  } else if (op === "leave" || op === "kick") {
    add("player_left", { playerCount: after.players.length });
  } else if (op === "action" && action) {
    if (action.type === "set-chaos-intensity") add("chaos_intensity_selected", { chaosIntensity: after.chaosIntensity });
    if (!previousSession && session) add("session_started");
    if (previousSession?.phase === "final-results" && session?.phase === "game-intro") {
      add("replay_started");
      add("session_started");
    }
    if (previousSession?.phase !== "active-game" && session?.phase === "active-game") {
      add("game_started");
      add("session_round_reached");
    }
    if (previousSession?.phase === "active-game" && session?.phase === "game-results") add("game_completed");
    if (action.type === "use-power" && typeof action.value === "string") add("power_used", { powerId: action.value.split(":", 1)[0] });
    if (action.type === "reveal-objectives" && !previousSession?.objectivesRevealedBy.includes(uid) && session?.objectivesRevealedBy.includes(uid)) add("objective_revealed");
    if (action.type === "select-rule" && session?.history.at(-1)?.selectedRule) add("house_rule_selected", { houseRuleId: session.history.at(-1)!.selectedRule!.id });
    if (session) {
      const priorObjectives = previousSession?.objectives ?? {};
      for (const [playerId, objective] of Object.entries(session.objectives)) {
        if (objective.completed && !priorObjectives[playerId]?.completed) add("objective_completed");
      }
    }
    if ((previousSession?.gameNumber ?? 0) < 6 && gameNumber === 6) add("finale_reached");
    if (previousSession?.phase !== "final-results" && session?.phase === "final-results") add("session_completed");
  }
  return events;
}
