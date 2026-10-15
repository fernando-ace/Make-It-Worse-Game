import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Make It Worse | Multiplayer Party Game",
  description: "Start a room, invite 1–7 friends, and play six quick multiplayer party games from any phone or computer.",
  applicationName: "Make It Worse",
  category: "games",
  openGraph: {
    type: "website",
    siteName: "Make It Worse",
    title: "Make It Worse | Multiplayer Party Game",
    description: "One room, 2–8 friends, and six quick games that keep making the next round stranger.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Make It Worse | Multiplayer Party Game",
    description: "One room, 2–8 friends, and six quick games that keep making the next round stranger.",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
