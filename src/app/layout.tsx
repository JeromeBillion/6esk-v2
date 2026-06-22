import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"]
});

const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://6esk.com";
const siteUrl = rawSiteUrl.startsWith("http") ? rawSiteUrl : `https://${rawSiteUrl}`;
const brandDescription =
  "6esk unifies email, WhatsApp, voice, AI drafts, analytics, and admin recovery into one deliberate support operating surface.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "6esk",
  description: brandDescription,
  applicationName: "6esk",
  creator: "6esk",
  publisher: "6esk",
  keywords: [
    "6esk",
    "support CRM",
    "omnichannel support",
    "AI support",
    "WhatsApp support",
    "email support",
    "voice support"
  ],
  icons: {
    icon: [
      { url: "/new-logo-favicon-96.png", sizes: "96x96", type: "image/png" },
      { url: "/icon.jpeg", sizes: "96x96", type: "image/jpeg" }
    ],
    apple: [{ url: "/new-logo-apple-touch.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/new-logo-favicon-96.png"]
  },
  openGraph: {
    title: "6esk",
    description: brandDescription,
    url: "/",
    siteName: "6esk",
    images: [
      {
        url: "/new-logo.jpeg",
        width: 1254,
        height: 1254,
        alt: "6esk logo"
      }
    ],
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary",
    title: "6esk",
    description: brandDescription,
    images: [{ url: "/new-logo.jpeg", alt: "6esk logo" }]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var stored = localStorage.getItem('sixesk:theme');
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var mode = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
                  document.documentElement.classList.toggle('dark', mode === 'dark');
                } catch (e) {
                  document.documentElement.classList.remove('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className={spaceGrotesk.className}>{children}</body>
    </html>
  );
}
