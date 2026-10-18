"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Clock3, Crown, Sparkles } from "lucide-react";
import Link from "next/link";
import { browserClient, ensureAnonymousSession } from "@/lib/browser";
import { parseRoomInviteUrl } from "@/lib/invites";
import { MINIGAMES } from "@/lib/games";
import type { Action, GameOption, HouseRule, MinigameResolution, Snapshot } from "@/lib/types";
import { classifyBetaError, trackClientBetaEvent } from "@/lib/beta-client";
import InviteActions from "./invite-actions";
import FeedbackForm from "./feedback-form";
import { ObjectiveCard, ObjectiveReveal, PowerControls } from "./secret-tools";
import { PlayerRoster } from "./player-roster";
import { ChoiceTile, GameStage, HouseRuleChoice, LockedState, PlayerChip, ScoreReveal, SessionProgress, VisibilityLabel } from "./party-presentation";
import { LandingEntry } from "./landing-entry";

function friendlyError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("room not found") || lower.includes("room expired")) return "That room is no longer available. Ask your friend for a fresh invite.";
  if (lower.includes("room is full")) return "This room is full. Party rooms can hold up to 8 players.";
  if (lower.includes("at least two")) return "Invite at least one friend before starting.";
  if (lower.includes("all players must be connected")) return "Waiting for everyone to reconnect before the host can start.";
  if (lower.includes("only the host")) return "Only the host can do that.";
  if (lower.includes("winner can choose")) return "Only this round’s winner can choose the House Rule.";
  if (lower.includes("this beat changed")) return "The round moved on. Your room has refreshed—check the current move.";
  if (lower.includes("time is up")) return "That choice window closed. The room is moving to the next moment.";
  if (lower.includes("choice is already locked")) return "Your choice is safely locked in.";
  if (lower.includes("must commit first")) return "The opening commitment is still in progress. Talk it out while it opens.";
  if (lower.includes("has not locked in a choice")) return "That power can target a player after they lock in. Choose someone else or try again in a moment.";
  if (lower.includes("not enough chaos")) return "Not enough Chaos for that move. Earn more by playing a round.";
  if (lower.includes("party has already started")) return "This party is already underway. Ask your friend for the latest room link.";
  if (lower.includes("not a room member")) return "You’re no longer in this room. Ask your friend for a fresh invite.";
  if (lower.includes("removed you") || lower.includes("no longer a member")) return "You were removed from this room.";
  if (lower.includes("enter your name")) return "Add your name to join the party.";
  if (lower.includes("six-character")) return "Enter the full six-character room code.";
  if (lower.includes("server configuration") || lower.includes("supabase")) return "The party room is offline right now. Try again in a little while.";
  if (lower.includes("network") || lower.includes("fetch")) return "Connection interrupted. Check your internet and try again.";
  return message;
}

function houseRuleDescription(rule: HouseRule, players: Snapshot["players"]) {
  const targetId = rule.effect.type === "bounty" ? rule.effect.targetId : rule.effect.type === "forced-first" || rule.effect.type === "score-floor" ? rule.effect.playerId : undefined;
  const target = players.find((player) => player.id === targetId)?.name;
  return target ? `Marked player: ${target}. ${rule.description}` : rule.description;
}

function houseRuleTarget(rule: HouseRule, players: Snapshot["players"]) {
  const effect = rule.effect;
  const targetId = effect.type === "bounty" ? effect.targetId : effect.type === "forced-first" || effect.type === "score-floor" ? effect.playerId : undefined;
  return players.find((player) => player.id === targetId)?.name;
}

function playerHistoryCues(session: NonNullable<Snapshot["session"]>, players: Snapshot["players"], me: string) {
  const events = session.history.flatMap((item) => item.result.events);
  const cues: string[] = [];
  const myBetrayers = new Map<string, number>();
  for (const event of events) if (event.type === "betrayed" && event.playerId === me) myBetrayers.set(event.targetId, (myBetrayers.get(event.targetId) ?? 0) + 1);
  const repeatBetrayer = [...myBetrayers].sort((a, b) => b[1] - a[1])[0];
  if (repeatBetrayer && repeatBetrayer[1] > 1) {
    const name = players.find((player) => player.id === repeatBetrayer[0])?.name ?? "Someone";
    cues.push(`${name} betrayed you ${repeatBetrayer[1]} times already`);
  }
  const targeted = new Map<string, number>();
  for (const event of events) if (event.type === "target") targeted.set(event.targetId, (targeted.get(event.targetId) ?? 0) + 1);
  const repeatTarget = [...targeted].filter(([id]) => id !== me).sort((a, b) => b[1] - a[1])[0];
  if (repeatTarget && repeatTarget[1] > 1) {
    const name = players.find((player) => player.id === repeatTarget[0])?.name ?? "Someone";
    cues.push(`${name} has been targeted ${repeatTarget[1]} times`);
  }
  const save = events.filter((event) => event.type === "save" && event.successful && event.targetId === me).at(-1);
  if (save?.type === "save") cues.push(`${players.find((player) => player.id === save.actorId)?.name ?? "Someone"} used a lifeline on you`);
  const backed = events.filter((event) => event.type === "support" && event.successful && event.targetId === me).at(-1);
  if (backed?.type === "support") cues.push(`${players.find((player) => player.id === backed.actorId)?.name ?? "Someone"} backed you for the golden ticket`);
  return cues;
}

function transitionCopy(session: NonNullable<Snapshot["session"]>, players: Snapshot["players"]) {
  const previous = session.history.at(-1);
  if (!previous) return null;
  const winnerId = Object.entries(previous.result.points).sort((a, b) => b[1] - a[1])[0]?.[0];
  const winner = players.find((player) => player.id === winnerId)?.name ?? "The winner";
  const rule = previous.selectedRule;
  const lead = [...players].sort((a, b) => (session.scores[b.id] ?? 0) - (session.scores[a.id] ?? 0))[0];
  const last = [...players].sort((a, b) => (session.scores[a.id] ?? 0) - (session.scores[b.id] ?? 0))[0];
  const swings = Object.entries(previous.result.points).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const swingPlayer = players.find((player) => player.id === swings[0]?.[0]);
  const swing = swings[0]?.[1] ?? 0;
  return { winner, rule, lead: lead?.name, last: last?.name, swingPlayer: swingPlayer?.name, swing };
}

function sessionRecap(session: NonNullable<Snapshot["session"]>, players: Snapshot["players"]) {
  const events = session.history.flatMap((item) => item.result.events);
  const betrayalEvents = events.filter((event) => event.type === "betrayal" || event.type === "betrayed");
  const betrayals = betrayalEvents.length;
  const pactEvents = events.filter((event) => event.type === "alliance" && event.mutual && event.playerId < event.targetId);
  const pacts = pactEvents.length;
  const swing = session.history.flatMap((game) => Object.entries(game.result.points).map(([playerId, points]) => ({ game: game.number, playerId, points }))).sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];
  const swingPlayer = players.find((player) => player.id === swing?.playerId)?.name;
  const createdRules = session.history.flatMap((game) => game.selectedRule ? [{ game: game.number, rule: game.selectedRule }] : []);
  const powers = events.filter((event) => event.type === "power");
  const powerNames: Record<string, string> = { guard: "Soft Landing", amplify: "Turn It Up", bounty: "Side Bet", bodyguard: "Take the Hit", hex: "Bad Omen", comeback: "Second Wind", pickpocket: "Pocket Change", contrarian: "Lone Wolf", scout: "Read Receipt" };
  const powerSummary = [...new Set(powers.map((event) => event.type === "power" ? event.powerId : ""))].map((id) => `${powerNames[id] ?? id}: ${powers.filter((event) => event.type === "power" && event.powerId === id).length} use${powers.filter((event) => event.type === "power" && event.powerId === id).length === 1 ? "" : "s"}`);
  const ruleInfluence = new Map<string, number>();
  for (const game of session.history) for (const rule of game.rules) {
    const matcher: Record<string, string> = { "double-down": "Double Down", underdog: "Underdog", bounty: "Bounty", "safety-net": "Soft Landing +" };
    const label = matcher[rule.id];
    if (label && Object.values(game.result.modifiers).some((modifiers) => modifiers.some((modifier) => modifier.includes(label)))) ruleInfluence.set(rule.name, (ruleInfluence.get(rule.name) ?? 0) + 1);
  }
  const leadingRule = [...ruleInfluence].sort((a, b) => b[1] - a[1])[0];
  const scoreProgression = session.scoreProgression.map((scores) => players.map((player) => scores[player.id] ?? 0));
  const beforeFinal = session.scoreProgression.at(-2) ?? {};
  const beforeLeader = Math.max(...players.map((player) => beforeFinal[player.id] ?? 0));
  const finalLeader = Math.max(...players.map((player) => session.scores[player.id] ?? 0));
  const comebacks = players.map((player) => ({ player, recovered: (beforeLeader - (beforeFinal[player.id] ?? 0)) - (finalLeader - (session.scores[player.id] ?? 0)) })).sort((a, b) => b.recovered - a.recovered);
  const names = (ids: string[]) => [...new Set(ids.map((id) => players.find((player) => player.id === id)?.name).filter((name): name is string => Boolean(name)))];
  const playerName = (id: string) => players.find((player) => player.id === id)?.name ?? "Someone";
  const betrayerNames = names(betrayalEvents.flatMap((event) => event.type === "betrayed" ? [event.targetId] : [event.playerId]));
  const pactNames = names(pactEvents.flatMap((event) => event.type === "alliance" ? [event.playerId, event.targetId] : []));
  const betrayalDetails = [...new Set(betrayalEvents.map((event) => event.type === "betrayed" ? `${playerName(event.targetId)} left ${playerName(event.playerId)} holding it` : `${playerName(event.playerId)} made a betrayal move`))];
  const allianceDetails = [...new Set(pactEvents.map((event) => event.type === "alliance" ? `${playerName(event.playerId)} + ${playerName(event.targetId)}` : "" ).filter(Boolean))];
  const memorableGames = [...session.history].filter((game) => game.result.events.some((event) => event.type !== "round-score")).sort((a, b) => b.result.events.filter((event) => event.type !== "round-score").length - a.result.events.filter((event) => event.type !== "round-score").length || a.number - b.number).slice(0, 2);
  const promises = events.filter(event => event.type === "promise");
  const moments = [
    ...(promises.length ? [`Public promises: ${promises.filter(event => event.type === "promise" && event.kept).length} kept, ${promises.filter(event => event.type === "promise" && !event.kept).length} broken`] : []),
    `${betrayals} betrayal${betrayals === 1 ? "" : "s"}${betrayerNames.length ? ` involving ${betrayerNames.join(", ")}` : ""}`,
    `${pacts} mutual pact${pacts === 1 ? "" : "s"}${pactNames.length ? ` between ${pactNames.join(", ")}` : ""}`,
    swing ? `Biggest single-game swing: ${swingPlayer} ${swing.points > 0 ? "+" : ""}${swing.points} in game ${swing.game}` : "No score swings recorded",
    ...(comebacks[0]?.recovered > 0 ? [`Biggest finale comeback: ${comebacks[0].player.name} closed a ${comebacks[0].recovered}-point gap`] : []),
    ...(leadingRule ? [`Most influential House Rule: ${leadingRule[0]} changed scoring in ${leadingRule[1]} game${leadingRule[1] === 1 ? "" : "s"}`] : []),
    ...(powerSummary.length ? [`Power use · ${powerSummary.join(" · ")}`] : ["No powers were used"]),
    ...memorableGames.filter((game) => game.result.events.length > 0).map((game) => `Game ${game.number}: ${game.result.reveal}`),
  ];
  return { moments, createdRules, betrayalDetails, allianceDetails, scoreProgression };
}

function revealMoments(result: MinigameResolution, players: Snapshot["players"]) {
  const name = (id: string) => players.find((player) => player.id === id)?.name ?? "Someone";
  const powerName: Record<string, string> = { guard: "Soft Landing", amplify: "Turn It Up", bounty: "Side Bet", bodyguard: "Take the Hit", hex: "Bad Omen", comeback: "Second Wind", pickpocket: "Pocket Change", contrarian: "Lone Wolf", scout: "Read Receipt" };
  const moments = result.events.flatMap((event) => {
    if (event.type === "target") return [`${name(event.actorId)} called out ${name(event.targetId)}`];
    if (event.type === "gamble") return [`${name(event.playerId)} ${event.result === "won" ? "won" : "lost"} the gamble`];
    if (event.type === "read" && event.accurate) return [`${name(event.playerId)} read the room`];
    if (event.type === "chaos") return [`${name(event.playerId)} chose chaos`];
    if (event.type === "betrayal") return [`${name(event.playerId)} made the betrayal move`];
    if (event.type === "alliance" && event.mutual && event.playerId < event.targetId) return [`${name(event.playerId)} and ${name(event.targetId)} made a pact`];
    if (event.type === "alliance" && !event.mutual) return [`${name(event.playerId)} reached for ${name(event.targetId)}; it wasn't mutual`];
    if (event.type === "betrayed") return [`${name(event.targetId)} left ${name(event.playerId)} holding it`];
    if (event.type === "save" && event.successful) return [`${name(event.actorId)} saved ${name(event.targetId)}`];
    if (event.type === "support" && event.successful) return [`${name(event.actorId)} backed ${name(event.targetId)}`];
    if (event.type === "contribution") return [`${name(event.playerId)} ${event.effort === 2 ? "carried" : "helped with"} the project${event.successful ? " that cleared" : " despite missing"} the bar`];
    if (event.type === "power") return [event.outcome === "info" ? `${name(event.playerId)} used ${powerName[event.powerId]} on ${name(event.targetId ?? "")}` : event.outcome === "success" ? `${powerName[event.powerId]} worked for ${name(event.playerId)}` : `${powerName[event.powerId]} did not trigger for ${name(event.playerId)}`];
    return [];
  });
  for (const [playerId, modifiers] of Object.entries(result.modifiers)) {
    if (modifiers.includes("Finale round leader +3")) moments.push(`${name(playerId)} led the finale round for +3`);
    if (modifiers.includes("Finale comeback +2")) moments.push(`${name(playerId)} earned the finale comeback +2`);
  }
  return [...new Set(moments)].slice(0, 5);
}

function OptionCard({ option, selected, disabled, onClick }: { option: GameOption; selected: boolean; disabled: boolean; onClick: () => void }) {
  return <ChoiceTile title={option.label} detail={option.detail} selected={selected} disabled={disabled} onClick={onClick} />;
}

export default function ControlRoom() {
  const [room, setRoom] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState(false);
  const [network, setNetwork] = useState("Connecting");
  const [clock, setClock] = useState(0);
  const [recapReveal, setRecapReveal] = useState({ key: "", stage: 0 });
  const roomRef = useRef<Snapshot | null>(null);
  const ignoredRoomId = useRef<string | null>(null);
  const offset = useRef(0);

  const accept = useCallback((snapshot: Snapshot) => {
    if (snapshot.id === ignoredRoomId.current) return;
    if (ignoredRoomId.current && snapshot.id !== ignoredRoomId.current) ignoredRoomId.current = null;
    const previous = roomRef.current;
    if (previous?.id === snapshot.id && previous.revision > snapshot.revision) return;
    roomRef.current = snapshot;
    offset.current = snapshot.serverNow - Date.now();
    setRoom(snapshot);
    localStorage.setItem("cr-room", snapshot.code);
  }, []);

  const clearRoom = useCallback((message?: string) => {
    ignoredRoomId.current = roomRef.current?.id ?? ignoredRoomId.current;
    roomRef.current = null;
    setRoom(null);
    localStorage.removeItem("cr-room");
    if (message) setError(friendlyError(message));
  }, []);

  const call = useCallback(async (op: string, roomCode?: string, action?: Action, playerName?: string, targetId?: string) => {
    const db = browserClient();
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("No session. Refresh to reconnect.");
    const response = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ op, code: roomCode, name: playerName, action, targetId, actionId: crypto.randomUUID() }),
    });
    const result = await response.json();
    if (response.status === 410) { clearRoom(result.error); throw new Error(result.error); }
    if (!response.ok) throw new Error(result.error ?? "Connection failed");
    if (result.left) { clearRoom(); return null; }
    accept(result as Snapshot);
    return result as Snapshot;
  }, [accept, clearRoom]);

  useEffect(() => {
    let alive = true;
    const invite = parseRoomInviteUrl(window.location.href);
    window.setTimeout(() => {
      if (invite.status === "valid") setCode(invite.code);
      if (invite.status === "invalid") setError("That invite link looks incomplete. Ask your host for a fresh one.");
    }, 0);
    void (async () => {
      try {
        await ensureAnonymousSession();
        if (!alive) return;
        setIdentity(true);
        setNetwork("Connected");
        const saved = localStorage.getItem("cr-room");
        if (!sessionStorage.getItem("mw-landing-tracked")) {
          sessionStorage.setItem("mw-landing-tracked", "1");
          trackClientBetaEvent("landing_viewed");
        }
        if (saved && (invite.status === "none" || (invite.status === "valid" && saved === invite.code))) {
          trackClientBetaEvent("reconnect_attempted", { code: saved });
          try { await call("action", saved, { type: "sync" }); trackClientBetaEvent("reconnect_succeeded", { code: saved }); }
          catch { trackClientBetaEvent("reconnect_failed", { code: saved }); localStorage.removeItem("cr-room"); }
        }
      } catch (cause) {
        if (alive) setError(friendlyError(cause instanceof Error ? cause.message : "Could not connect."));
      }
    })();
    return () => { alive = false; };
  }, [call]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() + offset.current), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!room?.id) return;
    const db = browserClient();
    let alive = true;
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try { await call("action", roomRef.current?.code, { type: "sync" }); if (alive) setNetwork("Connected"); }
      catch { if (alive) setNetwork("Reconnecting"); }
      finally { syncing = false; }
    };
    const channel = db.channel(`room-${room.id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "cr_rooms", filter: `id=eq.${room.id}` }, () => { void sync(); }).subscribe((status) => { if (alive) setNetwork(status === "SUBSCRIBED" ? "Connected" : "Reconnecting"); });
    const interval = window.setInterval(() => void sync(), 2500);
    const visible = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; window.clearInterval(interval); void db.removeChannel(channel); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible); };
  }, [room?.id, call]);

  const run = async (action: Action) => {
    if (!room) return;
    setBusy(true);
    setError("");
    try { await call("action", room.code, { ...action, ...(room.session?.round?.beat ? { beat: room.session.round.beat.index } : {}) }); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "That action did not work.";
      if (["auth", "network", "server"].includes(classifyBetaError(message))) trackClientBetaEvent("runtime_error", { code: room.code, errorCode: classifyBetaError(message) });
      setError(friendlyError(message));
    }
    finally { setBusy(false); }
  };

  const enter = async (op: "create" | "join") => {
    setBusy(true); setError("");
    try { await call(op, code.toUpperCase(), undefined, name.trim()); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not enter the room.";
      if (["auth", "network", "server"].includes(classifyBetaError(message))) trackClientBetaEvent("runtime_error", { errorCode: classifyBetaError(message) });
      setError(friendlyError(message));
    }
    finally { setBusy(false); }
  };

  const leave = async () => {
    if (!room || busy) return;
    setBusy(true);
    const departingName = room.players.find((player) => player.id === room.me)?.name ?? "";
    try { await call("leave", room.code); setName(departingName); clearRoom(); }
    catch (cause) { setError(friendlyError(cause instanceof Error ? cause.message : "Could not leave.")); }
    finally { setBusy(false); }
  };

  const kick = async (targetId: string, playerName: string) => {
    if (!room || !window.confirm(`Remove ${playerName} from this party?`)) return;
    setBusy(true);
    try { await call("kick", room.code, undefined, undefined, targetId); }
    catch (cause) { setError(friendlyError(cause instanceof Error ? cause.message : "Could not remove player.")); }
    finally { setBusy(false); }
  };

  const host = room?.hostId === room?.me;
  const session = room?.session;
  const recapKey = `${room?.id ?? ""}:${session?.phase ?? ""}:${session?.gameNumber ?? 0}`;
  const recapStage = recapReveal.key === recapKey ? recapReveal.stage : session?.objectiveReveal ? 1 : 0;
  const advanceRecap = async (stage: number) => {
    if (stage === 1 && room) {
      setBusy(true);
      try {
        await call("action", room.code, { type: "reveal-objectives" });
        setRecapReveal({ key: recapKey, stage });
      } catch (cause) {
        setError(friendlyError(cause instanceof Error ? cause.message : "Could not reveal the objectives."));
      } finally {
        setBusy(false);
      }
      return;
    }
    setRecapReveal({ key: recapKey, stage });
  };
  const round = session?.round;
  const seconds = round ? Math.max(0, Math.ceil((round.deadlineAt - clock) / 1000)) : 0;
  const winner = session?.ruleWinnerId ? room?.players.find((player) => player.id === session.ruleWinnerId) : null;
  const connectedCount = room?.players.filter((player) => clock - player.seenAt < 15000).length ?? 0;
  const scoreRows = room ? [...room.players].sort((a, b) => (session?.scores[b.id] ?? 0) - (session?.scores[a.id] ?? 0) || room.players.indexOf(a) - room.players.indexOf(b)) : [];
  const currentGame = session ? MINIGAMES[session.gameSlots[session.gameNumber - 1]] : null;
  const historyCues = session ? playerHistoryCues(session, room!.players, room!.me) : [];
  const transition = session ? transitionCopy(session, room!.players) : null;
  const recap = session?.phase === "final-results" ? sessionRecap(session, room!.players) : null;
  const roundMoments = round?.result ? revealMoments(round.result, room!.players) : [];

  return <main className="app-shell">
    <header className="topbar"><Link className="brand" href="/" aria-label="Make It Worse home"><span className="brand-mark"><Crown size={21} strokeWidth={2.5} aria-hidden="true" /></span><span>MAKE IT WORSE<small>PARTY GAME</small></span></Link><span className={`connection ${network === "Connected" ? "is-online" : ""}`} aria-live="polite"><i className={network === "Connected" ? "online" : ""} />{network}</span></header>
    {!room ? <section className="landing">
      <div className="hero-copy"><div className="hero-lockup"><span className="hero-star"><Sparkles size={37} strokeWidth={2.8} aria-hidden="true" /></span><h1>MAKE IT<br/><em>WORSE.</em></h1></div><p className="hero-line">Friends play short games.<br/>Winners change the rules.<br/>Every round gets worse.</p><p>Start a room. Bring your people. No accounts, no setup.</p><div className="hero-chips"><span>2–8 friends</span><span>6 quick games</span><span>Phones welcome</span></div></div>
      <LandingEntry name={name} code={code} error={error} identity={identity} busy={busy} onNameChange={setName} onCodeChange={setCode} onCreate={() => void enter("create")} onJoin={() => void enter("join")} onEnter={() => void enter(code ? "join" : "create")} />
    </section> : <section className="party-shell">
      <div className="room-heading"><div><div className="eyebrow">Your party · {connectedCount} of {room.players.length} here</div><h1>{session ? "The group is in." : "The room is yours."}</h1></div><button className="quiet-button" onClick={() => void leave()}>Leave room</button></div>
      <section className="room-banner"><div><span>ROOM CODE · SHARE IT WITH YOUR PEOPLE</span><strong>{room.code}</strong></div><InviteActions code={room.code}/></section>
      {!session ? <div className="lobby-grid"><PlayerRoster players={room.players} me={room.me} hostId={room.hostId} clock={clock} canRemove={host} onRemove={(player) => void kick(player.id, player.name)} />
        <section className="start-card"><div className="eyebrow">Six games. One room.</div><div className="game-icon"><Sparkles size={25} aria-hidden="true" /></div><h2>Make it worse.</h2><p>Read your friends, trust them (maybe), and see what happens when the whole room gets involved.</p><div className="game-facts"><span><Clock3 size={14} aria-hidden="true" /> Quick rounds</span><span><Sparkles size={14} aria-hidden="true" /> House Rules stack up</span></div><div className="session-setting"><label htmlFor="chaos-intensity">Chaos intensity</label><select id="chaos-intensity" aria-label="Chaos intensity" disabled={!host || busy} value={room.chaosIntensity} onChange={(event) => void run({ type: "set-chaos-intensity", value: event.target.value })}><option value="standard">Standard · 2 starting Chaos</option><option value="high">High · 3 starting Chaos</option></select><small>{host ? "Choose how much fuel everyone starts with." : "The host chooses how much Chaos everyone starts with."}</small></div><button className="cta-button" disabled={!host || room.players.length < 2 || connectedCount < 2 || busy} onClick={() => void run({ type: "start" })}>{!host ? "Waiting for the host" : room.players.length < 2 ? "Invite someone to start" : connectedCount < 2 ? "Waiting for your people" : "Start the party"}<ArrowRight size={16} aria-hidden="true" /></button><p className="start-eligibility" aria-live="polite">{!host ? "The host starts when everyone’s ready." : room.players.length < 2 ? "Invite at least one friend to start." : connectedCount < 2 ? "Waiting for your friends to reconnect." : `${connectedCount} players here. Ready when you are.`}</p></section></div>
      : <>
        <div className="game-layout"><section className="game-main">{session.phase !== "final-results" && <SessionProgress game={session.gameNumber} total={session.gameSlots.length} rules={session.activeRules.length} finale={session.gameNumber === session.gameSlots.length} />}<ObjectiveCard snapshot={room} />
          {session.phase === "game-intro" && <div className="phase-card intro-phase"><div className={`eyebrow ${session.gameNumber >= 5 ? "chaos-eyebrow" : ""}`}>{session.gameNumber >= 5 ? `CHAOS LEVEL ${session.gameNumber - 4} · ` : ""}Game {session.gameNumber} of {session.gameSlots.length} · ready?</div><span className="game-icon"><Sparkles size={25} aria-hidden="true" /></span><h2>{currentGame?.displayName}</h2><p>{currentGame?.instructions}</p>{transition && <div className="transition-card"><strong>Last game changed this one</strong><span>{transition.winner} won and {transition.rule ? `put ${transition.rule.name} in play` : "set the next twist"}. {session.activeRules.length} House Rule{session.activeRules.length === 1 ? "" : "s"} now active. The score swing was {transition.swingPlayer} {transition.swing > 0 ? "+" : ""}{transition.swing}; {transition.lead} leads, {transition.last} trails.</span></div>}{session.gameNumber === 5 && <div className="finale-banner"><strong>CHAOS ROUND</strong><span>Moves that create chaos earn +1 on top of the active House Rules.</span></div>}{session.gameNumber === 6 && <div className="finale-banner"><strong>THE FINALE</strong><span>Every point still counts. Round leader +3; last-place scorer +2. At the final tally, each 3 saved Chaos earns +1 (cap +2), plus completed secret objectives.</span></div>}<div className="scenario-card"><strong>{session.gameConfig.title}</strong><span>{session.gameConfig.prompt}</span></div><div className="rule-explainer"><strong>How to score</strong><span>{session.gameConfig.scoreHint}</span><span>{currentGame?.multiBeat ? "Two decisions: commitments open first, then a private response. Talk between decisions." : "Your pick stays private until everyone has committed."}</span></div>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "begin-game" })}>Start game {session.gameNumber} <ArrowRight size={16} aria-hidden="true" /></button> : <p className="waiting-note">The host is about to start the round…</p>}</div>}
          {session.phase === "active-game" && round && <GameStage className="decision-phase" label="Current game decision">
            <div className="round-meta"><span>GAME {round.number} / {session.gameSlots.length} · {currentGame?.displayName}</span><span role="timer" aria-label={`${seconds} seconds remaining`} className={seconds <= 5 ? "urgent" : ""}>00:{String(seconds).padStart(2, "0")}</span></div>
            {round.beat && <div className="beat-board" aria-live="polite"><div className="beat-heading"><strong>BEAT {round.beat.index + 1} OF 2</strong><VisibilityLabel kind="public" /></div>{round.beat.publicLines.map(line => <p key={line}>{line}</p>)}{round.beat.myHint && <div className="private-report"><VisibilityLabel kind="private"/><p>{round.beat.myHint}</p></div>}{round.beat.index === 0 && <small className="talk-cue">Talk before the next move. Everyone can see this.</small>}</div>}
            <h2>{round.config.title}</h2><p className="game-prompt">{round.config.prompt}</p>
            <div className="decision-context"><span className="chaos-pill"><Sparkles size={14} aria-hidden="true"/>CHAOS {session.myChaos}</span><span>{session.myPowers.length ? "Power used this game" : `${session.myPowerOffers.length} power${session.myPowerOffers.length === 1 ? "" : "s"} available`} · one per game</span>{session.gameNumber === 6 && <span>Save 3 for +1 finale bonus</span>}</div>
            {session.activeRules.slice(-1).map((rule,index) => <div className="active-rule contextual-rule" key={`${rule.id}-${index}`}><span>RULE IN PLAY · {rule.name}</span><strong>{houseRuleDescription(rule, room.players)}</strong></div>)}
            {round.firstCommitPlayerId && <div className="first-commit-note">{room.players.find((player) => player.id === round.firstCommitPlayerId)?.name} commits first. Their choice stays hidden.</div>}
            <div className="choice-grid">{round.config.options.filter((option) => !["target:", "reach:", "pass:", "favor:"].some((prefix) => option.id === `${prefix}${room.me}`)).map((option) => {
              const targetMatch = option.id.match(/^(target|reach|pass|favor):(.+)$/);
              const target = targetMatch ? room.players.find((player) => player.id === targetMatch[2]) : undefined;
              const waitingForFirst = round.firstCommitPlayerId !== null && !round.submittedIds.includes(round.firstCommitPlayerId) && room.me !== round.firstCommitPlayerId;
              const disabled = busy || Boolean(round.myChoice) || waitingForFirst || (option.id.startsWith("target:") && option.id === `target:${room.me}`);
              const onClick = () => void run({ type: "submit", value: option.id });
              if (target) return <PlayerChip key={option.id} name={target.name} meta={targetMatch?.[1] === "reach" ? "Choose as a partner" : targetMatch?.[1] === "pass" ? "Pass to" : targetMatch?.[1] === "favor" ? "Back this player" : "Target"} selected={round.myChoice === option.id} disabled={disabled} onClick={onClick}/>;
              return <OptionCard key={option.id} option={option} selected={round.myChoice === option.id} disabled={disabled} onClick={onClick}/>;
            })}</div>
            <LockedState locked={Boolean(round.myChoice)} count={round.answeredCount} total={room.players.length}>{round.myChoice ? round.beat?.index === 0 ? "Talk it out while the room catches up." : "Everyone reveals together." : round.firstCommitPlayerId && !round.submittedIds.includes(round.firstCommitPlayerId) && room.me !== round.firstCommitPlayerId ? "Waiting for the marked player to commit first." : round.beat?.index === 0 ? "Your commitment opens before the next move." : "Talk it out while everyone decides."}</LockedState>
            <PowerControls snapshot={room} busy={busy} committed={Boolean(round.myChoice)} onAction={(action) => void run(action)} />
            <details className="decision-extra"><summary>Session details · {session.activeRules.length} House Rules · {session.history.length} games played</summary>{session.activeRules.map((rule,index) => <div className="active-rule" key={`${rule.id}-${index}`}><span>House Rule · {rule.name}</span><strong>{houseRuleDescription(rule, room.players)}</strong></div>)}{session.history.length > 0 && <div className="history-cues">{historyCues.length ? historyCues.slice(0, 4).map((cue) => <span key={cue}>{cue}</span>) : <span>The room is still making its history.</span>}</div>}</details>
          </GameStage>}
{session.phase === "game-results" && round?.result && <div className="phase-card results-phase"><div className="eyebrow">WHAT HAPPENED · GAME {session.gameNumber} · {currentGame?.displayName}</div><h2>{round.result.reveal}</h2>{roundMoments.length > 0 && <div className="moment-stack" aria-label="Moments from this game">{roundMoments.map((moment) => <span key={moment}>{moment}</span>)}</div>}<p>{round.result.optionCounts && Object.values(round.result.optionCounts).reduce((sum, count) => sum + count, 0)} choices hit the table.</p><div className="reveal-groups">{round.config.options.map((option) => <div className="reveal-group" key={option.id}><strong>{option.label}</strong><span>{round.result!.optionCounts[option.id] ?? 0} picked</span><p>{room.players.filter((player) => round.result!.choices[player.id] === option.id).map((player) => player.name).join(", ") || "Nobody"}</p></div>)}</div><ScoreReveal rows={room.players.map((player) => ({ id: player.id, name: player.name, choice: round.config.options.find((option) => option.id === round.result!.choices[player.id])?.label ?? "NO PICK", points: round.result!.points[player.id] ?? 0, reason: round.result!.reasons[player.id] ?? "No pick before time ran out.", winner: player.id === winner?.id }))}/>{session.gameNumber === session.gameSlots.length ? <div className="rule-selection"><h3>{host ? "Ready for the final results?" : "The host is preparing the final results."}</h3>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "finish-session" })}>See final results <ArrowRight size={16}/></button> : <p className="waiting-note">The host is preparing the final results…</p>}</div> : <div className="rule-selection"><h3>{winner?.id === room.me ? "Choose a House Rule." : `${winner?.name ?? "The winner"} chooses a House Rule.`}</h3>{winner?.id === room.me ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "open-rule-selection" })}>Choose a House Rule <ArrowRight size={16}/></button> : <p className="waiting-note">Waiting for the game winner…</p>}</div>}</div>}
          {session.phase === "house-rule-selection" && <div className="phase-card results-phase"><div className="eyebrow">WINNER’S PICK · {winner?.name}</div><h2>You earned the twist.</h2><p>Choose what changes next. This rule starts in the next game and stays in play.</p><div className="rule-selection">{session.offeredRules.map((rule, index) => <HouseRuleChoice key={`${rule.id}-${index}`} label={`HOUSE RULE${rule.canStack ? " · STACKS" : ""} · NEXT GAME`} name={rule.name} description={`${houseRuleTarget(rule, room.players) ? `Marked player: ${houseRuleTarget(rule, room.players)}. ` : ""}${rule.description}`} disabled={busy || winner?.id !== room.me} onSelect={() => void run({ type: "select-rule", value: rule.id })}/>)}</div></div>}
          {session.phase === "intermission" && <div className="phase-card results-phase intermission"><div className="eyebrow">GAME {session.gameNumber} COMPLETE · SESSION {session.gameNumber}/{session.gameSlots.length}</div><h2>{session.newlyActivatedRule ? `${session.newlyActivatedRule.name} is in play.` : "Final game complete."}</h2>{transition && <div className="transition-card"><strong>{session.gameNumber === session.gameSlots.length ? `${transition.winner} changed the finale.` : `${transition.winner} changed the next game.`}</strong><span>{transition.rule ? `${transition.rule.name} now shapes every later reveal.` : "The rule stack carries forward."} Biggest swing: {transition.swingPlayer} {transition.swing > 0 ? "+" : ""}{transition.swing}. Current lead: {transition.lead}; chasing: {transition.last}.</span></div>}<div className="standings"><h3>Standings</h3>{scoreRows.map((player,index)=><div className="standing-row" key={player.id}><span>{index+1}</span><strong>{player.name}</strong><b>{session.scores[player.id] ?? 0} pts</b></div>)}</div><div className="active-rule"><span>NEW HOUSE RULE</span><strong>{session.newlyActivatedRule?.name ?? "No new rule"}{session.newlyActivatedRule ? ` · ${houseRuleDescription(session.newlyActivatedRule, room.players)}` : ""}</strong></div><div className="rule-explainer"><strong>All active House Rules</strong>{session.activeRules.map((rule,index)=><span key={`${rule.id}-${index}`}>{rule.name}: {houseRuleDescription(rule,room.players)}</span>)}</div><p>Next up · {session.gameNumber < session.gameSlots.length ? MINIGAMES[session.gameSlots[session.gameNumber]]?.displayName : "Final standings"}</p>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "continue-session" })}>{session.gameNumber < session.gameSlots.length ? "Next game" : "See final results"} <ArrowRight size={16}/></button> : <p className="waiting-note">Waiting for the host to continue…</p>}</div>}
          {session.phase === "final-results" && <div className="phase-card results-phase"><div className="eyebrow">SESSION COMPLETE · {session.gameSlots.length} GAMES</div><h2>{scoreRows[0]?.name ?? "The group"} takes the room.</h2><div className="finale-banner"><strong>Six games. One winner.</strong><span>The round leader earned +3; the +2 comeback bonus went only to players who entered in last place and scored.</span></div><div className="standings"><h3>Final standings</h3>{scoreRows.map((player,index)=><div className="standing-row" key={player.id}><span>{index+1}</span><strong>{player.name}</strong><b>{session.scores[player.id] ?? 0} pts</b></div>)}</div>{recapStage >= 1 && <><ObjectiveReveal snapshot={room} /><FeedbackForm roomCode={room.code} gameIds={session.gameSlots} /></>}<div className="recap-reveal-controls">{recapStage === 0 ? <button onClick={() => advanceRecap(1)}>Reveal secret objectives <ArrowRight size={15}/></button> : recapStage === 1 ? <button onClick={() => advanceRecap(2)}>Reveal party awards <ArrowRight size={15}/></button> : recapStage === 2 ? <button onClick={() => advanceRecap(3)}>Reveal session records <ArrowRight size={15}/></button> : null}</div>{recapStage >= 2 && <><div className="rule-explainer"><strong>Session awards</strong>{session.awards.length ? session.awards.map((award) => <span key={award.id}>{award.name}: {room.players.find((player) => player.id === award.playerId)?.name} · {award.count} {award.detail}</span>) : <span>No award had enough real session events.</span>}</div><div className="rule-explainer"><strong>Betrayals</strong>{recap?.betrayalDetails.length ? recap.betrayalDetails.map((detail) => <span key={detail}>{detail}</span>) : <span>No betrayal recorded.</span>}</div><div className="rule-explainer"><strong>Alliances</strong>{recap?.allianceDetails.length ? recap.allianceDetails.map((pair) => <span key={pair}>{pair}</span>) : <span>No mutual pact held.</span>}</div></>}{recapStage >= 3 && <><div className="rule-explainer"><strong>House Rules created · {recap?.createdRules.length ?? 0}</strong>{recap?.createdRules.length ? recap.createdRules.map((entry) => <span key={`${entry.game}-${entry.rule.id}`}>Game {entry.game}: {entry.rule.name}{entry.rule.canStack ? " · stacked" : ""}</span>) : <span>No rules were added.</span>}</div><div className="rule-explainer"><strong>Session moments</strong>{recap?.moments.map((moment) => <span key={moment}>{moment}</span>)}</div><div className="rule-explainer score-paths"><strong>Score progression · start → finale</strong>{recap?.scoreProgression && room.players.map((player,index) => <span key={player.id}>{player.name}: {recap.scoreProgression.map((game) => game[index]).join(" → ")}</span>)}</div><div className="rule-explainer"><strong>Rules still active at the buzzer</strong>{session.activeRules.map((rule,index)=><span key={`${rule.id}-${index}`}>{rule.name}: {houseRuleDescription(rule,room.players)}</span>)}</div><p className="waiting-note">All six games, scores, and private bonuses are in the open.</p>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "restart-session" })}>Run it back with new games</button> : <p className="waiting-note">The host can start a new session in this room.</p>}</>}</div>}        </section><aside className="score-panel"><details className="score-fold"><summary><span>SESSION STATUS</span><strong>Standings · {scoreRows[0]?.name ?? "The group"} leads</strong><small>Tap to check scores and active rules</small></summary><div className="section-title"><h2>Standings</h2><span>Live</span></div>{scoreRows.map((player, index) => <div className="score-row" key={player.id}><span className="score-rank">{index + 1}</span><span>{player.name}{player.id === room.me && <small>YOU</small>}</span><b>{session.scores[player.id] ?? 0}</b></div>)}<div className="score-divider"/><div className="house-rule-panel"><span>Active House Rules</span>{session.activeRules.length ? session.activeRules.map((rule,index) => <div key={`${rule.id}-${index}`}><strong>{rule.name}</strong><p>{houseRuleDescription(rule, room.players)}</p></div>) : <p>No House Rules yet. The first game winner gets to set one.</p>}</div><div className="party-progress"><span>Session progress</span><div className="progress-dots">{Array.from({ length: session.gameSlots.length }, (_, index) => <i key={index} className={index < session.gameNumber ? "current" : ""}/>)}</div><small>Game {session.gameNumber} of {session.gameSlots.length}</small></div></details></aside></div>
      </>}
      {error && <p className="error room-error" role="alert">{error}</p>}
    </section>}
    <footer className="footer"><span>Make It Worse · party games for your people</span></footer>
  </main>;
}
