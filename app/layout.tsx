import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Make It Worse | Party Games",
  description: "Read the room, risk the bag, and make awkward situations worse with your friends.",
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
