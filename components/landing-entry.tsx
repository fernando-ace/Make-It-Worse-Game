import { ArrowRight } from "lucide-react";

export function LandingEntry({ name, code, error, identity, busy, onNameChange, onCodeChange, onCreate, onJoin, onEnter }: {
  name: string;
  code: string;
  error: string;
  identity: boolean;
  busy: boolean;
  onNameChange: (name: string) => void;
  onCodeChange: (code: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onEnter: () => void;
}) {
  return <section className="entry-card" aria-labelledby="entry-title">
    <div className="entry-stamp" aria-hidden="true">GOOD FRIENDS<br/>BAD JUDGMENT</div>
    <h2 id="entry-title">Get the group together.</h2>
    <p>Pick a name. Start a room or join the one your friend made.</p>
    <form onSubmit={(event) => { event.preventDefault(); onEnter(); }}>
      <label htmlFor="player-name">Your name</label>
      <input id="player-name" autoComplete="nickname" maxLength={24} placeholder="e.g. Jamie" value={name} aria-describedby={error ? "entry-error" : undefined} onChange={(event) => onNameChange(event.target.value)} />
      <label htmlFor="room-code">Room code <span>for joining</span></label>
      <input id="room-code" className="code-input" inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={6} placeholder="ABC123" value={code} aria-describedby={error ? "entry-error" : undefined} onChange={(event) => onCodeChange(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} />
      <div className="entry-actions">
        <button className="cta-button" disabled={!identity || busy || !name.trim()} type="button" onClick={onCreate}>{busy ? "One sec…" : "Create game"}<ArrowRight size={17} aria-hidden="true" /></button>
        <button className="join-button" disabled={!identity || busy || !name.trim() || code.length !== 6} type="button" onClick={onJoin}>Join game</button>
      </div>
    </form>
    {error && <p className="error" id="entry-error" role="alert">{error}</p>}
    <p className="privacy-note">{identity ? "No account needed. Your room is private to its players." : "Getting your guest session ready…"}</p>
  </section>;
}
