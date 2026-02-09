import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "6esk",
  description: "Lightweight support platform with first-class email.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
