import { Crown, UserRound } from "lucide-react";
import type { Snapshot } from "@/lib/types";

type Player = Snapshot["players"][number];

export function PlayerRoster({
  players,
  me,
  hostId,
  clock,
  canRemove,
  onRemove,
}: {
  players: Player[];
  me: string;
  hostId: string;
  clock: number;
  canRemove: boolean;
  onRemove: (player: Player) => void;
}) {
  return (
    <section className="player-card" aria-labelledby="roster-title">
      <div className="section-title">
        <h2 id="roster-title">Who’s here</h2>
        <span>{players.length} of 8 players</span>
      </div>
      <ul className="players-list">
        {players.map((player, index) => {
          const isHere = clock - player.seenAt < 15_000;
          const isMe = player.id === me;
          return (
            <li className="player-row" key={player.id}>
              <span className={`avatar avatar-${index % 6}`} aria-hidden="true">
                {player.name.trim() ? player.name.trim().slice(0, 1).toUpperCase() : <UserRound size={16} />}
              </span>
              <span className="player-name">
                {player.name || "Player"}
                {isMe && <small>YOU</small>}
              </span>
              {player.id === hostId && (
                <span className="host-tag"><Crown size={12} aria-hidden="true" />HOST</span>
              )}
              <span className={`presence-tag ${isHere ? "here" : "away"}`}>
                {isHere ? "HERE" : "RECONNECTING"}
              </span>
              {canRemove && !isMe && (
                <button
                  type="button"
                  className="remove-player"
                  aria-label={`Remove ${player.name || "player"} from room`}
                  onClick={() => onRemove(player)}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {players.length < 2 && <p className="waiting-note">Waiting for one more friend to join…</p>}
      <div className="player-dots" aria-label={`${players.length} of 8 seats filled`}>
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} className={index < players.length ? "filled" : ""} />
        ))}
      </div>
    </section>
  );
}
