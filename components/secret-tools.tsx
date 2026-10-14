"use client";

import { useEffect, useRef, useState } from "react";
import type { Action, Snapshot } from "@/lib/types";
import { POWER_LIST } from "@/lib/powers";

export function ObjectiveCard({ snapshot }: { snapshot: Snapshot }) {
  const objective = snapshot.session?.myObjective;
  const objectiveId = objective?.id;
  const progress = objective?.progress;
  const completed = objective?.completed;
  const reward = objective?.reward;
  const previous = useRef<{ id: string; progress: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!objectiveId || progress === undefined) { previous.current = null; return; }
    const old = previous.current;
    if (old?.id === objectiveId && progress > old.progress) setFeedback(completed ? `Complete · +${reward} bonus` : `Progress +${progress - old.progress}`);
    if (old && old.id !== objectiveId && progress === 0) setFeedback("");
    previous.current = { id: objectiveId, progress };
  }, [objectiveId, progress, completed, reward]);
  if (!objective || snapshot.session?.phase === "final-results") return null;
  return <section className="secret-objective" aria-label="Your secret objective">
    <div><span>YOUR SECRET OBJECTIVE · PRIVATE</span><strong>{objective.title}</strong><p>{objective.description}</p>{feedback && <small className="objective-feedback" aria-live="polite">{feedback}</small>}</div>
    <div className="objective-meter"><b>{objective.progress}/{objective.target}</b><i><span style={{ width: `${Math.min(100, objective.progress / objective.target * 100)}%` }}/></i></div>
  </section>;
}

export function PowerControls({ snapshot, busy, committed, onAction }: { snapshot: Snapshot; busy: boolean; committed: boolean; onAction: (action: Action) => void }) {
  const [targetId, setTargetId] = useState("");
  const session = snapshot.session;
  if (!session || session.phase !== "active-game" || committed) return null;
  const used = session.myPowers.length > 0;
  const otherPlayers = snapshot.players.filter((player) => player.id !== snapshot.me && (!session.myPowerOffers.some((id) => POWER_LIST.find((power) => power.id === id)?.targetableAfterCommit) || session.round?.submittedIds.includes(player.id)));
  const selectedTarget = otherPlayers.some((player) => player.id === targetId) ? targetId : otherPlayers[0]?.id ?? "";
  const availablePowers = POWER_LIST.filter((power) => session.myPowerOffers.includes(power.id));
  return <section className="chaos-tools" aria-label="Spend Chaos">
    <div className="chaos-tools-heading"><strong>Chaos {session.myChaos}</strong><span>Three rotating offers · earn Chaos by playing</span></div>
    <div className="power-list">{availablePowers.map((power) => <div className="power-option" key={power.id}>
      <div><strong>{power.name}</strong><p>{power.description}</p></div>
      {power.targetRequired && <label className="power-target">{power.name === "Read Receipt" ? "Scout" : "Mark"} <select aria-label={`${power.name} target`} value={selectedTarget} onChange={(event) => setTargetId(event.target.value)}>{otherPlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
      <button disabled={busy || used || session.myChaos < power.cost || (power.targetRequired && !selectedTarget)} onClick={() => onAction({ type: "use-power", value: power.targetRequired ? `${power.id}:${selectedTarget}` : power.id })}>{used ? "Used" : `Use · ${power.cost}`}</button>
    </div>)}</div>
    {used && <small className="power-armed">Your power is armed for this game. Only you can see it until the reveal.</small>}
    {session.myIntel && <small className="power-armed private-intel">Private intel · {session.myIntel.playerName} locked “{session.round?.config.options.find((option) => option.id === session.myIntel?.choice)?.label ?? "a choice"}”.</small>}
  </section>;
}

export function ObjectiveReveal({ snapshot }: { snapshot: Snapshot }) {
  const session = snapshot.session;
  if (session?.phase !== "final-results" || !session.objectiveReveal) return null;
  const missedLines: Record<string, string> = {
    "repeat-rival": "Your target kept slipping away.", "good-sport": "The pact never quite stuck.", "friend-saver": "You had their back. The lifeline did not land.",
    "friend-backer": "The room backed someone else this time.", "stockpile": "Chaos came in. You spent it just as fast.", "late-bloomer": "The late-game points never arrived.",
    "prison-break": "You kept your conscience. The room may remember.", "surprise-audit": "The secret stayed secret.", "quiet-climber": "You were quiet, but the scoreboard noticed.",
  };
  return <section className="objective-reveal" aria-label="Secret objective results">
    <h3>Secret objectives</h3>
    {snapshot.players.map((player) => {
      const objective = session.objectiveReveal?.[player.id];
      if (!objective) return null;
      const outcome = objective.completed ? `Complete · +${objective.reward} bonus · all part of the plan` : `Incomplete · ${objective.progress}/${objective.target} · ${missedLines[objective.id] ?? "The plan got away from you."}`;
      return <div className="objective-result" key={player.id}><strong>{player.name} · {objective.title}</strong><span>{outcome}</span><small>{objective.description}</small></div>;
    })}
  </section>;
}
