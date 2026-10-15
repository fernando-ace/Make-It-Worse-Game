import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL("https://make-it-worse-game.vercel.app"),
  alternates: { canonical: "/" },
  title: "Make It Worse | Multiplayer Party Game",
  description: "Start a room, invite 1–7 friends, and play six quick multiplayer party games from any phone or computer.",
  applicationName: "Make It Worse",
  category: "games",
  openGraph: {
    type: "website",
    siteName: "Make It Worse",
    title: "Make It Worse | Multiplayer Party Game",
    description: "One room, 2–8 friends, and six quick games that keep making the next round stranger.",
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Make It Worse, a multiplayer party game for 2–8 friends" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Make It Worse | Multiplayer Party Game",
    description: "One room, 2–8 friends, and six quick games that keep making the next round stranger.",
    images: ["/opengraph-image"],
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
