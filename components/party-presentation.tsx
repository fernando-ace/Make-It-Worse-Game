import { Check, Eye, EyeOff, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";

export function GameStage({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return <section className={`phase-card ${className}`} aria-label={label}>{children}</section>;
}

export function SessionProgress({ game, total = 6, rules = 0, finale = false }: { game: number; total?: number; rules?: number; finale?: boolean }) {
  return <div className={`session-progress ${finale ? "is-finale" : ""}`} role="group" aria-label={`Game ${game} of ${total}${rules ? `, ${rules} active House Rules` : ""}`}>
    <div className="session-progress-copy"><strong>{finale ? "FINAL GAME" : `GAME ${game}`}</strong><span>{rules ? `${rules} rule${rules === 1 ? "" : "s"} changing the room` : `${total} quick games · winner shapes the rules`}</span></div>
    <div className="session-progress-track" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < game ? "done" : ""} />)}</div>
  </div>;
}

export function PlayerChip({ name, meta, selected = false, disabled = false, onClick }: { name: string; meta?: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  const tone = [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 6;
  const content = <><span className={`player-chip-avatar avatar-${tone}`} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || <UserRound size={16} />}</span><span className="player-chip-copy"><strong>{name}</strong>{meta && <small>{meta}</small>}</span>{selected && <Check size={18} aria-hidden="true" />}</>;
  return onClick ? <button type="button" className={`player-chip ${selected ? "is-selected" : ""}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>{content}</button> : <span className="player-chip">{content}</span>;
}

export function ChoiceTile({ title, detail, selected, disabled, onClick }: { title: string; detail?: string; selected: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" className={`choice-button ${selected ? "chosen" : ""}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    <span className="choice-orb" aria-hidden="true"/><strong>{title}</strong><small>{selected ? "Locked in" : "Choose this"}</small>{detail && <span className="choice-detail">{detail}</span>}
  </button>;
}

export function VisibilityLabel({ kind }: { kind: "public" | "private" }) {
  return <span className={`info-visibility ${kind}`}><span aria-hidden="true">{kind === "public" ? <Eye size={13} /> : <EyeOff size={13} />}</span>{kind === "public" ? "EVERYONE CAN SEE" : "ONLY YOU CAN SEE"}</span>;
}

export function LockedState({ locked, count, total, children }: { locked: boolean; count: number; total: number; children?: ReactNode }) {
  return <div className={`lock-state ${locked ? "is-locked" : ""}`} role="status" aria-live="polite"><span className="lock-state-icon" aria-hidden="true">{locked ? <Check size={18} /> : <Sparkles size={17} />}</span><span><strong>{locked ? "Locked in." : "Your move."}</strong><small>{children ?? (locked ? "Talk it out while the room catches up." : "Choose when you’re ready." )}</small></span><b>{count} / {total} in</b></div>;
}

export function ChaosWallet({ amount, cost, effect, disabled = false }: { amount: number; cost?: number; effect?: string; disabled?: boolean }) {
  return <div className={`chaos-wallet ${disabled ? "is-unavailable" : ""}`}><span className="chaos-wallet-icon" aria-hidden="true"><Sparkles size={17}/></span><span><strong>{amount} Chaos</strong><small>{disabled ? "Not enough for this power" : cost !== undefined ? `${cost} to use · ${effect ?? "spend a power"}` : "Spend it on a power or save it for the finale"}</small></span></div>;
}

export function HouseRuleChoice({ label, name, description, action = "Choose this twist", disabled = false, onSelect }: { label: string; name: string; description: string; action?: string; disabled?: boolean; onSelect: () => void }) {
  return <button type="button" className="rule-card" disabled={disabled} onClick={onSelect}><span>{label}</span><strong>{name}</strong><small>{description}</small><b>{action} <span aria-hidden="true">→</span></b></button>;
}

export function ScoreReveal({ rows }: { rows: Array<{ id: string; name: string; choice: string; points: number; reason: string; winner: boolean }> }) {
  return <section className="score-reveal" aria-label="Round score explanation">
    <div className="score-reveal-heading"><strong>HOW THE ROUND LANDED</strong><span>Points and the reason behind each move</span></div>
    <div className="reveal-list">{rows.map((row) => <div className={`reveal-row ${row.winner ? "is-round-winner" : ""}`} key={row.id}>
      <span className="reveal-name">{row.name}{row.winner && <small>Round winner</small>}</span>
      <b>{row.choice}</b>
      <span className={`earned ${row.points < 0 ? "is-negative" : ""}`}>{row.points > 0 ? "+" : ""}{row.points}</span>
      <small className="reason">{row.reason}</small>
    </div>)}</div>
  </section>;
}
