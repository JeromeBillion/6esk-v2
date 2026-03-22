import type { Metadata } from "next";
import LandingPageClient from "@/app/components/landing/LandingPageClient";
import { getSessionUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "6esk | Omnichannel Support CRM",
  description:
    "6esk unifies email, WhatsApp, voice, AI drafts, analytics, and admin recovery into one deliberate support operating surface."
};

export default async function HomePage() {
  const user = await getSessionUser();

  return <LandingPageClient authenticated={Boolean(user)} workspaceHref={user ? "/tickets" : "/login"} />;
}
