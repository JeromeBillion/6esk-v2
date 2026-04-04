import type { Metadata } from "next";
import LandingPageClient from "@/app/components/landing/LandingPageClient";

export const metadata: Metadata = {
  title: "6esk | Omnichannel Support CRM",
  description:
    "6esk unifies email, WhatsApp, voice, AI drafts, analytics, and admin recovery into one deliberate support operating surface."
};

export default async function HomePage() {
  return <LandingPageClient signInHref="/login" demoWorkspaceHref="/tickets?demo=1" />;
}
