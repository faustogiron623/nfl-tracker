import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NFL Betting Tracker",
  description: "Analizador y tracker de apuestas NFL — moneyline y props, motor determinístico.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
