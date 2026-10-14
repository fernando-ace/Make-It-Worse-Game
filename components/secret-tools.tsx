"use client";

import { useState } from "react";
import type { Action, Snapshot } from "@/lib/types";
import { POWER_LIST } from "@/lib/powers";

export function ObjectiveCard({ snapshot }: { snapshot: Snapshot }) {
  const objective = snapshot.session?.myObjective;
  if (!objective || snapshot.session?.phase === "final-results") return null;
  return <section className="secret-objective" aria-label="Your secret objective">
    <div><span>YOUR SECRET OBJECTIVE</span><strong>{objective.title}</strong><p>{objective.description}</p></div>
    <div className="objective-meter"><b>{objective.progress}/{objective.target}</b><i><span style={{ width: `${Math.min(100, objective.progress / objective.target * 100)}%` }}/></i></div>
  </section>;
}

export function PowerControls({ snapshot, busy, committed, onAction }: { snapshot: Snapshot; busy: boolean; committed: boolean; onAction: (action: Action) => void }) {
  const [targetId, setTargetId] = useState("");
  const session = snapshot.session;
  if (!session || session.phase !== "active-game" || committed) return null;
  const used = session.myPowers.length > 0;
  const otherPlayers = snapshot.players.filter((player) => player.id !== snapshot.me);
  const selectedTarget = otherPlayers.some((player) => player.id === targetId) ? targetId : otherPlayers[0]?.id ?? "";
  return <section className="chaos-tools" aria-label="Spend Chaos">
    <div className="chaos-tools-heading"><strong>Chaos {session.myChaos}</strong><span>Each power costs 2 · earns come from playing</span></div>
    <div className="power-list">{POWER_LIST.map((power) => <div className="power-option" key={power.id}>
      <div><strong>{power.name}</strong><p>{power.description}</p></div>
      {power.targetRequired && <label className="power-target">Mark <select aria-label="Side Bet target" value={selectedTarget} onChange={(event) => setTargetId(event.target.value)}>{otherPlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
      <button disabled={busy || used || session.myChaos < power.cost || (power.targetRequired && !selectedTarget)} onClick={() => onAction({ type: "use-power", value: power.targetRequired ? `${power.id}:${selectedTarget}` : power.id })}>{used ? "Used" : `Use · ${power.cost}`}</button>
    </div>)}</div>
    {used && <small className="power-armed">Your power is armed for this game. Only you can see it until the reveal.</small>}
  </section>;
}

export function ObjectiveReveal({ snapshot }: { snapshot: Snapshot }) {
  const session = snapshot.session;
  if (session?.phase !== "final-results" || !session.objectiveReveal) return null;
  return <section className="objective-reveal" aria-label="Secret objective results">
    <h3>Secret objectives</h3>
    {snapshot.players.map((player) => {
      const objective = session.objectiveReveal?.[player.id];
      if (!objective) return null;
      return <div className="objective-result" key={player.id}><strong>{player.name} · {objective.title}</strong><span>{objective.completed ? `Complete · +${objective.reward} bonus` : `Incomplete · ${objective.progress}/${objective.target}`}</span><small>{objective.description}</small></div>;
    })}
  </section>;
}
