import type { Metadata } from "next";
import LandingPageClient from "@/app/components/landing/LandingPageClient";

const title = "6esk | Omnichannel Support CRM";
const description =
  "6esk unifies email, WhatsApp, voice, AI drafts, analytics, and admin recovery into one deliberate support operating surface.";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical: "/"
  },
  openGraph: {
    title,
    description,
    url: "/",
    images: [
      {
        url: "/new-logo.jpeg",
        width: 1254,
        height: 1254,
        alt: "6esk logo"
      }
    ]
  },
  twitter: {
    title,
    description,
    images: [{ url: "/new-logo.jpeg", alt: "6esk logo" }]
  }
};

export default async function HomePage() {
  return <LandingPageClient signInHref="/login" demoWorkspaceHref="/tickets?demo=1" />;
}
