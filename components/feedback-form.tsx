"use client";

import { useState } from "react";
import { browserClient } from "@/lib/browser";
import { trackClientBetaEvent } from "@/lib/beta-client";
import { MINIGAMES } from "@/lib/games";

export default function FeedbackForm({ roomCode, gameIds }: { roomCode: string; gameIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [playAgain, setPlayAgain] = useState(true);
  const [favorite, setFavorite] = useState("");
  const [leastFavorite, setLeastFavorite] = useState("");
  const [confusion, setConfusion] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const showForm = () => {
    setOpen(true);
    trackClientBetaEvent("feedback_opened", { code: roomCode });
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || message.startsWith("Thanks") || message.startsWith("Feedback already")) return;
    setBusy(true);
    setMessage("");
    try {
      const { data } = await browserClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("Reconnect before sending feedback.");
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ code: roomCode, funRating: rating, playAgain, favoriteGame: favorite, leastFavoriteGame: leastFavorite, confusion, comment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Feedback could not be saved.");
      setMessage(result.submitted ? "Thanks. Your feedback is private and saved." : "Feedback already received for this session. Thanks for sharing.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Feedback could not be saved. Try again later.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="feedback-card" aria-label="Optional private game feedback">
    <div className="feedback-heading"><div><span className="eyebrow">OPTIONAL · PRIVATE</span><h3>Help make the next party better</h3><p>Quick feedback from each player stays private from the group.</p></div><button type="button" className="quiet-button" onClick={showForm}>{open ? "Feedback open" : "Give feedback"}</button></div>
    {open && <form className="feedback-form" onSubmit={(event) => void submit(event)}>
      <fieldset><legend>How fun was the session?</legend><div className="rating-options">{[1, 2, 3, 4, 5].map((value) => <label key={value} className={rating === value ? "selected" : ""}><input type="radio" name="fun-rating" value={value} checked={rating === value} onChange={() => setRating(value)} />{value}</label>)}</div><small>1 = not much fun · 5 = a great time</small></fieldset>
      <fieldset><legend>Would you play again?</legend><div className="feedback-toggle"><button type="button" className={playAgain ? "selected" : ""} aria-pressed={playAgain} onClick={() => setPlayAgain(true)}>Yes, I would</button><button type="button" className={!playAgain ? "selected" : ""} aria-pressed={!playAgain} onClick={() => setPlayAgain(false)}>Probably not</button></div></fieldset>
      <div className="feedback-selects"><label>Favorite game<select value={favorite} onChange={(event) => setFavorite(event.target.value)}><option value="">Skip</option>{gameIds.map((id) => <option key={id} value={id}>{MINIGAMES[id]?.displayName ?? id}</option>)}</select></label><label>Game to improve<select value={leastFavorite} onChange={(event) => setLeastFavorite(event.target.value)}><option value="">Skip</option>{gameIds.map((id) => <option key={id} value={id}>{MINIGAMES[id]?.displayName ?? id}</option>)}</select></label></div>
      <label>Anything confusing? <span>Optional</span><textarea value={confusion} maxLength={500} rows={2} onChange={(event) => setConfusion(event.target.value)} placeholder="A rule, instruction, or moment that was unclear" /></label>
      <label>Anything else you want us to know? <span>Optional</span><textarea value={comment} maxLength={1200} rows={3} onChange={(event) => setComment(event.target.value)} placeholder="What worked, what dragged, or what made everyone laugh?" /></label>
      <small>Please don’t include names, contact details, or private game choices.</small>
      <button className="cta-button" type="submit" disabled={busy || message.startsWith("Thanks") || message.startsWith("Feedback already")}>{busy ? "Saving…" : "Send private feedback"}</button>
      {message && <p className="feedback-message" role="status">{message}</p>}
    </form>}
  </section>;
}
