import { ImageResponse } from "next/og";

export const alt = "Make It Worse, a multiplayer party game for 2–8 friends";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "70px 80px",
        backgroundColor: "#f6f3e9",
        color: "#342552",
        fontFamily: "Arial",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24, fontWeight: 700, letterSpacing: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 16, background: "#d9e3b3", fontSize: 25, letterSpacing: 0 }}>MW</div>
        MAKE IT WORSE
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 800 }}>Know your friends.</div>
        <div style={{ fontSize: 94, lineHeight: 1, fontWeight: 800, color: "#ee5c50" }}>Make it worse.</div>
      </div>
      <div style={{ display: "flex", fontSize: 26, color: "#657166" }}>Multiplayer party games · 2–8 players · Phones welcome</div>
    </div>,
    size,
  );
}
