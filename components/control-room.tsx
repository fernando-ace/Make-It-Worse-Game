"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Circle, Clock3, Sparkles } from "lucide-react";
import Link from "next/link";
import { browserClient, ensureAnonymousSession } from "@/lib/browser";
import { parseRoomInviteUrl } from "@/lib/invites";
import { MINIGAMES } from "@/lib/games";
import type { Action, GameOption, HouseRule, MinigameResolution, Snapshot } from "@/lib/types";
import InviteActions from "./invite-actions";

function friendlyError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("room not found")) return "We couldn’t find that room. Check the code and try again.";
  if (lower.includes("room is full")) return "This room is full. Party rooms can hold up to 8 players.";
  if (lower.includes("at least two")) return "Invite at least one friend before starting.";
  if (lower.includes("only the host")) return "Only the host can do that.";
  if (lower.includes("winner can choose")) return "Only this round’s winner can choose the House Rule.";
  if (lower.includes("removed you") || lower.includes("no longer a member")) return "You were removed from this room.";
  if (lower.includes("enter your name")) return "Add your name to join the party.";
  if (lower.includes("six-character")) return "Enter the full six-character room code.";
  if (lower.includes("server configuration") || lower.includes("supabase")) return "The party room is temporarily unavailable. Check the Supabase setup.";
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
  const names = (ids: string[]) => [...new Set(ids.map((id) => players.find((player) => player.id === id)?.name).filter((name): name is string => Boolean(name)))];
  const betrayerNames = names(betrayalEvents.flatMap((event) => event.type === "betrayed" ? [event.targetId] : [event.playerId]));
  const pactNames = names(pactEvents.flatMap((event) => event.type === "alliance" ? [event.playerId, event.targetId] : []));
  const moments = [
    `${betrayals} betrayal${betrayals === 1 ? "" : "s"}${betrayerNames.length ? ` involving ${betrayerNames.join(", ")}` : ""}`,
    `${pacts} mutual pact${pacts === 1 ? "" : "s"}${pactNames.length ? ` between ${pactNames.join(", ")}` : ""}`,
    swing ? `Biggest single-game swing: ${swingPlayer} ${swing.points > 0 ? "+" : ""}${swing.points} in game ${swing.game}` : "No score swings recorded",
  ];
  return { moments, createdRules };
}

function revealMoments(result: MinigameResolution, players: Snapshot["players"]) {
  const name = (id: string) => players.find((player) => player.id === id)?.name ?? "Someone";
  const moments = result.events.flatMap((event) => {
    if (event.type === "target") return [`${name(event.actorId)} called out ${name(event.targetId)}`];
    if (event.type === "gamble") return [`${name(event.playerId)} ${event.result === "won" ? "won" : "lost"} the gamble`];
    if (event.type === "read" && event.accurate) return [`${name(event.playerId)} read the room`];
    if (event.type === "betrayal") return [`${name(event.playerId)} made the betrayal move`];
    if (event.type === "alliance" && event.mutual && event.playerId < event.targetId) return [`${name(event.playerId)} and ${name(event.targetId)} made a pact`];
    if (event.type === "alliance" && !event.mutual) return [`${name(event.playerId)} reached for ${name(event.targetId)}; it wasn't mutual`];
    if (event.type === "betrayed") return [`${name(event.targetId)} left ${name(event.playerId)} holding it`];
    return [];
  });
  for (const [playerId, modifiers] of Object.entries(result.modifiers)) if (modifiers.includes("Finale comeback +2")) moments.push(`${name(playerId)} earned the finale comeback +2`);
  return [...new Set(moments)].slice(0, 5);
}

function OptionCard({ option, selected, disabled, onClick }: { option: GameOption; selected: boolean; disabled: boolean; onClick: () => void }) {
  return <button className={`choice-button ${selected ? "chosen" : ""}`} disabled={disabled} onClick={onClick}>
    <span className="choice-orb"/><strong>{option.label}</strong><small>{selected ? "Locked in" : "Choose this"}</small>{option.detail && <span className="choice-detail">{option.detail}</span>}
  </button>;
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
        if (saved && (invite.status === "none" || (invite.status === "valid" && saved === invite.code))) {
          try { await call("action", saved, { type: "sync" }); }
          catch { localStorage.removeItem("cr-room"); }
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
    try { await call("action", room.code, action); }
    catch (cause) { setError(friendlyError(cause instanceof Error ? cause.message : "That action did not work.")); }
    finally { setBusy(false); }
  };

  const enter = async (op: "create" | "join") => {
    setBusy(true); setError("");
    try { await call(op, code.toUpperCase(), undefined, name.trim()); }
    catch (cause) { setError(friendlyError(cause instanceof Error ? cause.message : "Could not enter the room.")); }
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
    <header className="topbar"><Link className="brand" href="/" aria-label="Make It Worse home"><span className="brand-mark">MW</span><span>MAKE IT WORSE<small>PARTY GAMES</small></span></Link><span className="connection"><i className={network === "Connected" ? "online" : ""} />{network}</span></header>
    {!room ? <section className="landing">
      <div className="hero-copy"><div className="eyebrow">A party game for your people</div><h1>Know your friends.<br/><em>Make it worse.</em></h1><p>Read the room, risk the bag, and find out who your friends really are. Six quick games. House Rules that keep getting worse.</p><div className="hero-chips"><span>2–8 players</span><span>No accounts</span><span>Better with friends</span></div></div>
      <section className="entry-card"><div className="card-spark"><Sparkles size={22} aria-hidden="true" /></div><h2>Get the group together</h2><p>Choose a name, then start a room or join your friends.</p><form onSubmit={(event) => { event.preventDefault(); void enter(code ? "join" : "create"); }}>
        <label htmlFor="player-name">Your name</label><input id="player-name" autoComplete="nickname" maxLength={24} placeholder="e.g. Jamie" value={name} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="room-code">Room code <span>optional</span></label><input id="room-code" className="code-input" maxLength={6} placeholder="ABC123" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} />
        <button className="cta-button" disabled={!identity || busy || !name.trim()} type="submit">{busy ? "Connecting…" : code ? "Join the party" : "Create a room"}</button>
      </form>{error && <p className="error" role="alert">{error}</p>}<p className="privacy-note">{identity ? "No sign-up. Your room is private to its players." : "Connecting your guest session…"}</p></section>
      <div className="landing-bottom"><span>One room. Many bad ideas.</span><span>Original games by Make It Worse</span></div>
    </section> : <section className="party-shell">
      <div className="room-heading"><div><div className="eyebrow">Your party · {connectedCount} of {room.players.length} here</div><h1>{session ? "The group is in." : "The room is yours."}</h1></div><button className="quiet-button" onClick={() => void leave()}>Leave room</button></div>
      <section className="room-banner"><div><span>Room code</span><strong>{room.code}</strong></div><InviteActions code={room.code}/></section>
      {!session ? <div className="lobby-grid"><section className="player-card"><div className="section-title"><h2>Who’s here</h2><span>{room.players.length}/8</span></div><div className="players-list">{room.players.map((player, index) => <div className="player-row" key={player.id}><span className={`avatar avatar-${index % 6}`}>{player.name.slice(0, 1).toUpperCase()}</span><span className="player-name">{player.name}{player.id === room.me && <small>YOU</small>}</span>{player.id === room.hostId && <span className="host-tag">HOST</span>}{host && player.id !== room.me && <button className="remove-player" aria-label={`Remove ${player.name} from room`} onClick={() => void kick(player.id, player.name)}>×</button>}</div>)}</div>{room.players.length < 2 && <p className="waiting-note">Waiting for one more friend to join…</p>}<div className="player-dots">{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < room.players.length ? "filled" : ""}/>)}</div></section>
        <section className="start-card"><div className="eyebrow">Six games. One room.</div><div className="game-icon"><Sparkles size={25} aria-hidden="true" /></div><h2>Make it worse.</h2><p>Read your friends, trust them (maybe), and see what happens when the whole room gets involved.</p><div className="game-facts"><span><Clock3 size={14} aria-hidden="true" /> Quick rounds</span><span><Sparkles size={14} aria-hidden="true" /> House Rules stack up</span></div><button className="cta-button" disabled={!host || room.players.length < 2 || connectedCount < 2 || busy} onClick={() => void run({ type: "start" })}>{!host ? "Waiting for the host" : room.players.length < 2 ? "Invite someone to start" : "Start the party"}</button></section></div>
      : <>
        <div className="game-layout"><section className="game-main">
          {session.phase === "game-intro" && <div className="phase-card intro-phase"><div className={`eyebrow ${session.gameNumber >= 5 ? "chaos-eyebrow" : ""}`}>{session.gameNumber >= 5 ? `CHAOS LEVEL ${session.gameNumber - 4} · ` : ""}Game {session.gameNumber} of {session.gameSlots.length} · ready?</div><span className="game-icon"><Sparkles size={25} aria-hidden="true" /></span><h2>{currentGame?.displayName}</h2><p>{currentGame?.instructions}</p>{transition && <div className="transition-card"><strong>Last game changed this one</strong><span>{transition.winner} won and {transition.rule ? `put ${transition.rule.name} in play` : "set the next twist"}. {session.activeRules.length} House Rule{session.activeRules.length === 1 ? "" : "s"} now active. The score swing was {transition.swingPlayer} {transition.swing > 0 ? "+" : ""}{transition.swing}; {transition.lead} leads, {transition.last} trails.</span></div>}{session.gameNumber === 6 && <div className="finale-banner"><strong>THE FINALE</strong><span>Every point still counts. Players entering in last place can earn a +2 comeback bonus by scoring this game.</span></div>}<div className="scenario-card"><strong>{session.gameConfig.title}</strong><span>{session.gameConfig.prompt}</span></div><div className="rule-explainer"><strong>How to score</strong><span>{session.gameConfig.scoreHint}</span><span>Your pick stays private until everyone has committed.</span></div>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "begin-game" })}>Start game {session.gameNumber} <ArrowRight size={16} aria-hidden="true" /></button> : <p className="waiting-note">The host is about to start the round…</p>}</div>}
          {session.phase === "active-game" && round && <div className="phase-card decision-phase"><div className="round-meta"><span>Game {round.number} of {session.gameSlots.length} · {currentGame?.displayName}</span><span className={seconds <= 5 ? "urgent" : ""}>00:{String(seconds).padStart(2, "0")}</span></div><h2>{round.config.title}</h2><p className="game-prompt">{round.config.prompt}</p>{session.gameNumber >= 5 && <div className="chaos-meter"><strong>{session.gameNumber === 6 ? "Finale pressure" : "The room is getting unstable"}</strong><span>{session.activeRules.length} active House Rules · {session.history.length} games of grudges to remember</span></div>}{historyCues.length > 0 && <div className="history-cues">{historyCues.map((cue) => <span key={cue}>{cue}</span>)}</div>}{session.activeRules.map((rule,index) => <div className="active-rule" key={`${rule.id}-${index}`}><span>House Rule · {rule.name}</span><strong>{houseRuleDescription(rule, room.players)}</strong></div>)}{round.firstCommitPlayerId && <div className="first-commit-note">{room.players.find((player) => player.id === round.firstCommitPlayerId)?.name} must commit first. Their choice stays hidden.</div>}<div className="choice-grid">{round.config.options.map((option) => <OptionCard key={option.id} option={option} selected={round.myChoice === option.id} disabled={busy || Boolean(round.myChoice) || (round.firstCommitPlayerId !== null && !round.submittedIds.includes(round.firstCommitPlayerId) && room.me !== round.firstCommitPlayerId) || (option.id.startsWith("target:") && option.id === `target:${room.me}`)} onClick={() => void run({ type: "submit", value: option.id })}/>)}</div><div className="submitted-status"><span className={round.myChoice ? "status-check" : "status-dot"}>{round.myChoice ? <Check size={13} aria-hidden="true" /> : null}</span>{round.myChoice ? "Your choice is locked and hidden from the group." : round.firstCommitPlayerId && !round.submittedIds.includes(round.firstCommitPlayerId) && room.me !== round.firstCommitPlayerId ? "Waiting for the marked player to commit first." : "Choose one move. Everyone reveals together."}<span className="answered-count">{round.answeredCount}/{room.players.length} in</span></div><div className="answer-people">{room.players.map((player) => <span key={player.id} className={round.submittedIds.includes(player.id) ? "answered" : ""}>{round.submittedIds.includes(player.id) ? <Check size={12} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}{player.name}</span>)}</div></div>}
          {session.phase === "game-results" && round?.result && <div className="phase-card results-phase"><div className="eyebrow">GAME {session.gameNumber} RESULTS · {currentGame?.displayName}</div><h2>{round.result.reveal}</h2>{roundMoments.length > 0 && <div className="moment-stack" aria-label="Moments from this game">{roundMoments.map((moment) => <span key={moment}>{moment}</span>)}</div>}<p>{round.result.optionCounts && Object.values(round.result.optionCounts).reduce((sum, count) => sum + count, 0)} choices hit the table.</p><div className="reveal-groups">{round.config.options.map((option) => <div className="reveal-group" key={option.id}><strong>{option.label}</strong><span>{round.result!.optionCounts[option.id] ?? 0} picked</span><p>{room.players.filter((player) => round.result!.choices[player.id] === option.id).map((player) => player.name).join(", ") || "Nobody"}</p></div>)}</div><div className="reveal-list">{room.players.map((player) => <div className="reveal-row" key={player.id}><span className="reveal-name">{player.name}{player.id === winner?.id && <small>Round winner</small>}</span><b>{round.config.options.find((option) => option.id === round.result!.choices[player.id])?.label ?? "NO PICK"}</b><span className="earned">{round.result!.points[player.id] > 0 ? "+" : ""}{round.result!.points[player.id] ?? 0}</span><small className="reason">{round.result!.reasons[player.id]}</small></div>)}</div><div className="rule-selection"><h3>{winner?.id === room.me ? "Choose a House Rule." : `${winner?.name ?? "The winner"} chooses a House Rule.`}</h3>{winner?.id === room.me ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "open-rule-selection" })}>Choose a House Rule <ArrowRight size={16}/></button> : <p className="waiting-note">Waiting for the game winner…</p>}</div></div>}
          {session.phase === "house-rule-selection" && <div className="phase-card results-phase"><div className="eyebrow">WINNER’S PICK · {winner?.name}</div><h2>Change what comes next.</h2><p>House Rules stay active in later games.</p><div className="rule-selection">{session.offeredRules.map((rule, index) => <button className="rule-card" key={`${rule.id}-${index}`} disabled={busy || winner?.id !== room.me} onClick={() => void run({ type: "select-rule", value: rule.id })}><span>HOUSE RULE{rule.canStack ? " · STACKS" : ""}</span><strong>{rule.name}</strong><small>{houseRuleTarget(rule, room.players) ? `Marked player: ${houseRuleTarget(rule, room.players)}. ` : ""}{rule.description}</small></button>)}</div></div>}
          {session.phase === "intermission" && <div className="phase-card results-phase intermission"><div className="eyebrow">GAME {session.gameNumber} COMPLETE · SESSION {session.gameNumber}/{session.gameSlots.length}</div><h2>{session.newlyActivatedRule ? `${session.newlyActivatedRule.name} is in play.` : "Final game complete."}</h2>{transition && <div className="transition-card"><strong>{session.gameNumber === session.gameSlots.length ? `${transition.winner} changed the finale.` : `${transition.winner} changed the next game.`}</strong><span>{transition.rule ? `${transition.rule.name} now shapes every later reveal.` : "The rule stack carries forward."} Biggest swing: {transition.swingPlayer} {transition.swing > 0 ? "+" : ""}{transition.swing}. Current lead: {transition.lead}; chasing: {transition.last}.</span></div>}<div className="standings"><h3>Standings</h3>{scoreRows.map((player,index)=><div className="standing-row" key={player.id}><span>{index+1}</span><strong>{player.name}</strong><b>{session.scores[player.id] ?? 0} pts</b></div>)}</div><div className="active-rule"><span>NEW HOUSE RULE</span><strong>{session.newlyActivatedRule?.name ?? "No new rule"}{session.newlyActivatedRule ? ` · ${houseRuleDescription(session.newlyActivatedRule, room.players)}` : ""}</strong></div><div className="rule-explainer"><strong>All active House Rules</strong>{session.activeRules.map((rule,index)=><span key={`${rule.id}-${index}`}>{rule.name}: {houseRuleDescription(rule,room.players)}</span>)}</div><p>Next up · {session.gameNumber < session.gameSlots.length ? MINIGAMES[session.gameSlots[session.gameNumber]]?.displayName : "Final standings"}</p>{host ? <button className="cta-button" disabled={busy} onClick={() => void run({ type: "continue-session" })}>{session.gameNumber < session.gameSlots.length ? "Next game" : "See final results"} <ArrowRight size={16}/></button> : <p className="waiting-note">Waiting for the host to continue…</p>}</div>}
          {session.phase === "final-results" && <div className="phase-card results-phase"><div className="eyebrow">SESSION COMPLETE · {session.gameSlots.length} GAMES</div><h2>{scoreRows[0]?.name ?? "The group"} takes the room.</h2><div className="finale-banner"><strong>Six games. One winner.</strong><span>The finale comeback bonus was earned only by scoring players who entered game 6 in last place.</span></div><div className="standings"><h3>Final standings</h3>{scoreRows.map((player,index)=><div className="standing-row" key={player.id}><span>{index+1}</span><strong>{player.name}</strong><b>{session.scores[player.id] ?? 0} pts</b></div>)}</div><div className="rule-explainer"><strong>Session awards</strong>{session.awards.length ? session.awards.map((award) => <span key={award.id}>{award.name}: {room.players.find((player) => player.id === award.playerId)?.name} · {award.count} {award.detail}</span>) : <span>No award had enough real session events.</span>}</div><div className="rule-explainer"><strong>House Rules created · {recap?.createdRules.length ?? 0}</strong>{recap?.createdRules.length ? recap.createdRules.map((entry) => <span key={`${entry.game}-${entry.rule.id}`}>Game {entry.game}: {entry.rule.name}{entry.rule.canStack ? " · stacked" : ""}</span>) : <span>No rules were added.</span>}</div><div className="rule-explainer"><strong>Session moments</strong>{recap?.moments.map((moment) => <span key={moment}>{moment}</span>)}</div><div className="rule-explainer"><strong>Rules still active at the buzzer</strong>{session.activeRules.map((rule,index)=><span key={`${rule.id}-${index}`}>{rule.name}: {houseRuleDescription(rule,room.players)}</span>)}</div><p className="waiting-note">Thanks for playing. Start a new room for another session.</p></div>}        </section><aside className="score-panel"><div className="section-title"><h2>Standings</h2><span>Live</span></div>{scoreRows.map((player, index) => <div className="score-row" key={player.id}><span className="score-rank">{index + 1}</span><span>{player.name}{player.id === room.me && <small>YOU</small>}</span><b>{session.scores[player.id] ?? 0}</b></div>)}<div className="score-divider"/><div className="house-rule-panel"><span>Active House Rules</span>{session.activeRules.length ? session.activeRules.map((rule,index) => <div key={`${rule.id}-${index}`}><strong>{rule.name}</strong><p>{houseRuleDescription(rule, room.players)}</p></div>) : <p>No House Rules yet. The first game winner gets to set one.</p>}</div><div className="party-progress"><span>Session progress</span><div className="progress-dots">{Array.from({ length: session.gameSlots.length }, (_, index) => <i key={index} className={index < session.gameNumber ? "current" : ""}/>)}</div><small>Game {session.gameNumber} of {session.gameSlots.length}</small></div></aside></div>
      </>}
      {error && <p className="error room-error" role="alert">{error}</p>}
    </section>}
    <footer className="footer"><span>Make It Worse · party games for your people</span><span>Original games · always better together</span></footer>
  </main>;
}
