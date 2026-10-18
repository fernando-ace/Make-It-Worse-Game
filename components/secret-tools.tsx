"use client";

import { useEffect, useRef, useState } from "react";
import type { Action, Snapshot } from "@/lib/types";
import { POWER_LIST } from "@/lib/powers";
import { ChaosWallet, PlayerChip } from "./party-presentation";

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
  return <details className="secret-objective">
    <summary aria-label={`Your private objective: ${objective.title}, progress ${objective.progress} of ${objective.target}`}>
      <div><span>YOUR OBJECTIVE · PRIVATE</span><strong>{objective.title}</strong></div>
      <div className="objective-meter"><b>{objective.progress}/{objective.target}</b><i><span style={{ width: `${Math.min(100, objective.progress / objective.target * 100)}%` }}/></i></div>
    </summary>
    {feedback && <small className="objective-feedback objective-feedback-live" role="status" aria-live="polite">{feedback}</small>}
    <div className="objective-detail"><p>{objective.description}</p></div>
  </details>;
}

export function PowerControls({ snapshot, busy, committed, onAction }: { snapshot: Snapshot; busy: boolean; committed: boolean; onAction: (action: Action) => void }) {
  const [targetId, setTargetId] = useState("");
  const [powerFeedback, setPowerFeedback] = useState("");
  const session = snapshot.session;
  const used = Boolean(session?.myPowers.length);
  const currentChaos = session?.myChaos ?? 0;
  const previous = useRef({ chaos: currentChaos, used });
  useEffect(() => {
    if (!previous.current.used && used && previous.current.chaos > currentChaos) {
      const spent = previous.current.chaos - currentChaos;
      setPowerFeedback(`Spent ${spent} Chaos · power armed for this game.`);
    }
    if (previous.current.used && !used) setPowerFeedback("");
    previous.current = { chaos: currentChaos, used };
  }, [currentChaos, used]);
  if (!session || session.phase !== "active-game") return null;
  const otherPlayers = snapshot.players.filter((player) => player.id !== snapshot.me);
  const selectedTarget = otherPlayers.some((player) => player.id === targetId) ? targetId : otherPlayers[0]?.id ?? "";
  const availablePowers = POWER_LIST.filter((power) => session.myPowerOffers.includes(power.id) && (!committed || power.targetableAfterCommit));
  return <details className="chaos-tools" open={used || Boolean(session.myIntel)}>
    <summary className="chaos-tools-heading"><ChaosWallet amount={session.myChaos}/><span className="wallet-action">{used ? "View details" : `${availablePowers.length} power${availablePowers.length === 1 ? "" : "s"}`}</span></summary>
    <p className="wallet-note">One power each game. Save 3 Chaos for +1 at the finale (max +2).</p>
    {powerFeedback && <p className="power-feedback" role="status" aria-live="polite">{powerFeedback}</p>}
    {!used && availablePowers.length === 0 && <p className="power-unavailable">No power is available right now. Keep your Chaos for the finale.</p>}
    <div className="power-list">{availablePowers.map((power) => <div className="power-option" key={power.id}>
      <div><strong>{power.name}</strong><p>{power.description}</p></div>
      {power.targetRequired && <fieldset className="power-target-picker"><legend>{power.name === "Read Receipt" ? "Choose who to scout" : "Choose who to target"}</legend><div>{otherPlayers.map((player) => <PlayerChip key={player.id} name={player.name} meta="Player" selected={selectedTarget === player.id} disabled={Boolean(power.targetableAfterCommit && !session.round?.submittedIds.includes(player.id))} onClick={() => setTargetId(player.id)}/>)}</div></fieldset>}
      <button aria-label={`${used ? "Used" : `Use ${power.name}`} · costs ${power.cost} Chaos`} disabled={busy || used || (committed && !power.targetableAfterCommit) || session.myChaos < power.cost || (power.targetRequired && (!selectedTarget || Boolean(power.targetableAfterCommit && !session.round?.submittedIds.includes(selectedTarget))))} onClick={() => onAction({ type: "use-power", value: power.targetRequired ? `${power.id}:${selectedTarget}` : power.id })}>{used ? "Used" : `Use · ${power.cost} Chaos`}</button>
      {session.myChaos < power.cost && <small className="power-unavailable">Need {power.cost - session.myChaos} more Chaos to use this.</small>}
    </div>)}</div>
    {used && <small className="power-armed">Your power is armed for this game. Only you can see it until the reveal.</small>}
    {session.myIntel && <small className="power-armed private-intel">Private intel · {session.myIntel.playerName} locked “{session.round?.config.options.find((option) => option.id === session.myIntel?.choice)?.label ?? "a choice"}”.</small>}
  </details>;
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
