import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Control Room | Party Games",
  description: "Quick original party games, surprising twists, and House Rules made for your friends.",
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
