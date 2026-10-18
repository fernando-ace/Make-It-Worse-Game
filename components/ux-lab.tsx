"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Crown, Sparkles } from "lucide-react";
import Link from "next/link";
import { ChoiceTile, GameStage, HouseRuleChoice, LockedState, PlayerChip, ScoreReveal, SessionProgress, VisibilityLabel } from "./party-presentation";
import { PlayerRoster } from "./player-roster";
import { ObjectiveCard, PowerControls } from "./secret-tools";
import { LandingEntry } from "./landing-entry";
import InviteActions from "./invite-actions";
import type { Snapshot } from "@/lib/types";

const states = [
  "landing", "join-error", "lobby-2", "lobby-4", "lobby-8", "ready-lobby", "game-intro", "single-choice", "selected-choice", "locked-choice", "waiting", "target-picker", "beat-one", "public-reveal", "private-report", "phase-two", "objective", "powers", "low-chaos", "high-chaos", "house-rule", "close-result", "score-swing", "intermission", "finale", "awards", "reconnect", "room-expired",
] as const;
type FixtureState = (typeof states)[number];
const players = ["Maya", "Jordan", "Chris", "Alexandra Verylongname", "Sam", "Riley", "Taylor", "Morgan"];
const names: Record<FixtureState, string> = Object.fromEntries(states.map((state) => [state, state.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())])) as Record<FixtureState, string>;

function fixtureSnapshot(state: FixtureState, roster: { id: string; name: string; seenAt: number }[]): Snapshot {
  const myChaos = state === "high-chaos" ? 7 : state === "low-chaos" ? 1 : 3;
  return {
    id: "ux-fixture", code: "NOISE8", hostId: roster[0]?.id ?? "fixture-0", revision: 1, players: roster, me: roster[0]?.id ?? "fixture-0", serverNow: 10_000, chaosIntensity: "standard",
    session: { phase: "active-game", gameNumber: 3, gameSlots: ["cross-my-heart", "signal-noise", "last-seats", "breaking-point", "fixture-five", "fixture-finale"], chaosIntensity: "standard", gameConfig: { title: "Who do you trust?", prompt: "Choose someone you trust most.", options: [], scoreHint: "Read the room." }, scores: {}, objectives: {}, round: { number: 3, minigameId: "cross-my-heart", startedAt: 0, deadlineAt: 30_000, config: { title: "Who gets your last slice?", prompt: "Pick one person.", options: [{ id: "trust", label: "Trust them" }], scoreHint: "" }, firstCommitPlayerId: null, result: null, answeredCount: 2, myChoice: null, submittedIds: [], beat: undefined }, activeRules: [], offeredRules: [], newlyActivatedRule: null, ruleWinnerId: null, history: [], awards: [], scoreProgression: [], objectivesRevealedBy: [], myObjective: { id: "repeat-rival", title: "Keep an eye on Jordan", description: "Target Jordan twice before the session ends.", progress: 1, target: 2, completed: false, reward: 2 }, myChaos, myPowers: [], myPowerOffers: ["guard", "amplify", "bounty"], myIntel: null,
    } as unknown as Snapshot["session"],
  } as Snapshot;
}
export default function UxLab({ initialState }: { initialState?: string }) {
  const initial = states.includes(initialState as FixtureState) ? initialState as FixtureState : "landing";
  const [state, setState] = useState<FixtureState>(initial);
  const [selected, setSelected] = useState("Maya");
  const activeCount = state === "intermission" ? 3 : state === "finale" || state === "awards" ? 5 : 2;
  const count = state === "lobby-2" ? 2 : state === "lobby-8" ? 8 : 4;
  const roster = useMemo(() => players.slice(0, count).map((name, index) => ({ id: `fixture-${index}`, name, seenAt: 5_000 })), [count]);
  const snapshot = fixtureSnapshot(state, roster);
  const [actionMessage, setActionMessage] = useState("");
  const [fixtureError, setFixtureError] = useState(initial === "join-error" ? "That room is no longer available. Ask your friend for a fresh invite." : "");
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const isLobby = state.startsWith("lobby-") || state === "ready-lobby";
  const isFinale = state === "finale" || state === "awards";
  const isWaiting = state === "waiting" || state === "locked-choice" || state === "selected-choice";
  const setFixture = (next: string) => {
    if (!states.includes(next as FixtureState)) return;
    setState(next as FixtureState);
    const url = new URL(window.location.href);
    url.searchParams.set("state", next);
    window.history.replaceState({}, "", url);
  };
  return <main className="app-shell ux-lab-shell">
    <header className="topbar"><Link className="brand" href="/" aria-label="Make It Worse home"><span className="brand-mark"><Crown size={21}/></span><span>MAKE IT WORSE<small>UX LAB · FIXTURES ONLY</small></span></Link><span className="ux-lab-badge">DEV / TEST ONLY</span></header>
    <div className="ux-lab-toolbar"><div><strong>Player Experience Lab</strong><span>Real presentation components · deterministic fixtures · no room service</span></div><label>Preview state<select aria-label="Preview state" value={state} onChange={(event) => setFixture(event.target.value)}>{states.map((item) => <option key={item} value={item}>{names[item]}</option>)}</select></label></div>
    <div className="ux-lab-stage">
      <section className="party-shell">
        {isLobby ? <>
          <header className="room-heading"><div><div className="eyebrow">Your party · {count} of 8 here</div><h1>{state === "ready-lobby" ? "They’re all here." : "Room is filling up."}</h1></div><button className="quiet-button" onClick={() => setFixture("landing")}>Leave room</button></header>
          <div className="room-banner"><div><span>ROOM CODE · SEND IT TO YOUR PEOPLE</span><strong>NOISE8</strong></div><InviteActions code="NOISE8"/></div>
          <div className="lobby-grid"><PlayerRoster players={roster} me="fixture-0" hostId="fixture-0" clock={10_000} canRemove={false} onRemove={() => {}}/><section className="start-card"><div className="eyebrow">Six quick games</div><h2>Let the bad ideas begin.</h2><p>The winner changes a rule. Every round gets stranger.</p><label className="session-setting">Chaos for the room<select aria-label="Chaos intensity"><option>Standard · 2 starting Chaos</option><option>High · 3 starting Chaos</option></select></label><button className="cta-button" disabled={count < 2} onClick={() => setFixture("game-intro")}>{count < 2 ? "Invite one more friend" : "Start the party"}<ArrowRight size={16}/></button><p className="start-eligibility">{count} players connected. Ready when you are.</p></section></div>
        </> : state === "landing" || state === "join-error" ? <div className="lab-landing"><div className="hero-copy"><h1>MAKE IT<br/><em>WORSE.</em></h1><p className="hero-line">Friends play short games.<br/>Winners change the rules.<br/>Every round gets worse.</p><p>2–8 people · Six quick games · Phones welcome</p></div><LandingEntry name={playerName} code={roomCode} error={fixtureError} identity busy={false} onNameChange={setPlayerName} onCodeChange={setRoomCode} onCreate={() => setFixtureError("Fixture only. No room was created.")} onJoin={() => setFixtureError("Fixture only. No room was joined.")} onEnter={() => setFixtureError("Fixture only. No room was created or joined.")}/></div> : <>
          <SessionProgress game={isFinale ? 6 : state === "game-intro" ? 2 : state === "intermission" || state.includes("result") ? 3 : 3} rules={activeCount} finale={isFinale}/>
          {state === "objective" && <ObjectiveCard snapshot={snapshot}/>}
          {state === "game-intro" && <GameStage className="intro-phase" label="Game introduction"><span className="eyebrow">GAME 2 OF 6 · READY?</span><h2>Cross My Heart</h2><p>Pick someone you trust most. They may return the favor—or leave you hanging.</p><div className="scenario-card"><strong>Who gets your last slice?</strong><span>Choose one friend. Your choice stays private until everyone commits.</span></div><button className="cta-button" onClick={() => setFixture("single-choice")}>Start game 2 <ArrowRight size={16}/></button></GameStage>}
          {(state === "single-choice" || state === "selected-choice" || state === "locked-choice" || state === "waiting" || state === "target-picker" || state === "beat-one" || state === "public-reveal" || state === "private-report" || state === "phase-two" || state === "objective" || state === "powers" || state === "low-chaos" || state === "high-chaos") && <GameStage className="decision-phase" label="Current game decision">
            <div className="round-meta"><span>GAME 3 / 6 · CROSS MY HEART</span><span role="timer" aria-label="18 seconds remaining">00:18</span></div>
            {(state === "beat-one" || state === "public-reveal" || state === "private-report" || state === "phase-two") && <div className="beat-board"><div className="beat-heading"><strong>{state === "phase-two" ? "BEAT 2 OF 2" : "BEAT 1 OF 2"}</strong><VisibilityLabel kind="public"/></div><p>Two players picked Maya. The room can see this before the next move.</p>{state === "private-report" && <div className="private-report"><VisibilityLabel kind="private"/><p>Jordan promised you the last slice in the previous round.</p></div>}<small className="talk-cue">Everyone can see this. Talk before you decide.</small></div>}
            <h2>{state === "target-picker" ? "Who gets your power?" : "Who do you trust with the last slice?"}</h2><p className="game-prompt">Choose carefully. Your pick stays private until the reveal.</p>
            {state === "target-picker" ? <div className="player-targets">{players.filter((name) => name !== "Maya").map((name) => <PlayerChip key={name} name={name} meta="player" selected={selected === name} onClick={() => setSelected(name)}/>)}</div> : <div className="choice-grid">{["Maya", "Jordan", "Risk it yourself", "Share the slice"].map((choice) => <ChoiceTile key={choice} title={choice} selected={selected === choice} disabled={isWaiting} onClick={() => { setSelected(choice); setFixture("selected-choice"); }}/>)}</div>}
            <div className="lab-wallet"><Sparkles size={17}/><strong>{state === "high-chaos" ? 7 : 1} Chaos</strong><span>{state === "low-chaos" ? "Need 2 more for this power" : "Save 3 for +1 at the finale"}</span></div>
            {(state === "powers" || state === "low-chaos" || state === "high-chaos") && <><PowerControls snapshot={snapshot} busy={false} committed={false} onAction={() => setActionMessage("Power action shown in the fixture. No room state or service was changed.")}/>{actionMessage && <p className="fixture-action-message" role="status">{actionMessage}</p>}</>}
            <LockedState locked={isWaiting} count={3} total={4}>{isWaiting ? "Talk it out while the room catches up." : "Tap a choice to lock it in. Your choice stays private."}</LockedState>
          </GameStage>}
          {(state === "house-rule" || state === "close-result" || state === "score-swing" || state === "intermission" || isFinale || state === "reconnect" || state === "room-expired") && <GameStage className={`results-phase ${isFinale ? "lab-finale" : ""}`} label={`${names[state]} fixture`}>
            {state === "house-rule" ? <><div className="eyebrow">WINNER’S PICK · MAYA</div><h2>You earned the twist.</h2><p>Choose what changes next. It starts in Game 4 and stays in play.</p><div className="rule-cards"><HouseRuleChoice label="HOUSE RULE · NEXT GAME" name="First on the Record" description="Maya commits first. Everyone else waits to see it open." onSelect={() => setActionMessage("Selected fixture rule: First on the Record. No room state was changed.")}/><HouseRuleChoice label="HOUSE RULE · NEXT GAME" name="Double Down" description="Betrayals are worth double this game." onSelect={() => setActionMessage("Selected fixture rule: Double Down. No room state was changed.")}/>{actionMessage && <p className="fixture-action-message" role="status">{actionMessage}</p>}</div></> : isFinale ? <><div className="eyebrow">SIX GAMES · ONE ROOM</div><h2>{state === "awards" ? "The receipts are in." : "Maya takes the room."}</h2><p>One last reveal. Every point, promise, and saved Chaos counted.</p><div className="standings"><h3>Final standings</h3>{["Maya", "Jordan", "Chris", "Alex"].map((name, index) => <div className="standing-row" key={name}><span>{index + 1}</span><strong>{name}</strong><b>{31 - index * 4} pts</b></div>)}</div><div className="finale-banner"><strong>THE BIGGEST SWING</strong><span>Jordan closed a 5-point gap in the final game.</span></div><button className="cta-button" onClick={() => { setActionMessage("Replay preview only. No session was restarted."); setFixture("ready-lobby"); }}>Run it back with new games <ArrowRight size={16}/></button></> : state === "reconnect" || state === "room-expired" ? <><div className="eyebrow">{state === "reconnect" ? "CATCHING UP" : "ROOM CLOSED"}</div><h2>{state === "reconnect" ? "Back with your people." : "This room has expired."}</h2><p>{state === "reconnect" ? "Your last choice is still locked. The room is moving on." : "Ask the host for a fresh invite, then jump back in."}</p><button className="cta-button" onClick={() => setFixture(state === "reconnect" ? "single-choice" : "landing")}>{state === "reconnect" ? "Return to game" : "Join another room"}</button></> : <><div className="eyebrow">{state === "intermission" ? "GAME 3 COMPLETE · 3 OF 6" : "WHAT HAPPENED"}</div><h2>{state === "intermission" ? "First on the Record is in play." : state === "score-swing" ? "That changed the standings." : "Jordan kept the promise. Maya didn’t."}</h2><p>{state === "score-swing" ? "Maya +4 · Jordan −2. Jordan moves up two places." : "Three players backed the same person. One player had other plans."}</p><div className="rule-explainer"><strong>Score movement</strong><span>+2 base · +1 House Rule · −1 betrayal</span><b>= +2 points</b></div>{state !== "intermission" && <ScoreReveal rows={[{ id: "maya", name: "Maya", choice: "Kept the promise", points: 2, reason: "+2 base · +1 House Rule · −1 betrayal", winner: true }, { id: "jordan", name: "Jordan", choice: "Shared the slice", points: 1, reason: "+1 for backing the room", winner: false }, { id: "chris", name: "Chris", choice: "Took the risk", points: -1, reason: "The room chose the safer option", winner: false }]} />}{state === "intermission" && <div className="active-rule"><span>NEW HOUSE RULE</span><strong>First on the Record · Maya commits first next round.</strong></div>}<button className="cta-button" onClick={() => setFixture(state === "intermission" ? "game-intro" : "house-rule")}>{state === "intermission" ? "Next game" : "Choose a House Rule"}<ArrowRight size={16}/></button></>}
          </GameStage>}
        </>}
      </section>
    </div>
    <footer className="footer ux-lab-footer"><span>Fixture content only. Preview actions stay local. No Supabase client, room API, or persisted game state.</span>{actionMessage && !["powers", "low-chaos", "high-chaos", "house-rule"].includes(state) && <span role="status">{actionMessage}</span>}</footer>
  </main>;
}
