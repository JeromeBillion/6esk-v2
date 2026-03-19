import { apiFetch } from "@/app/lib/api/http";

export type CurrentSessionUser = {
  id: string;
  email: string;
  display_name: string;
  role_id: string | null;
  role_name: string | null;
};

export async function getCurrentSessionUser() {
  const payload = await apiFetch<{ user: CurrentSessionUser | null }>("/api/auth/me");
  return payload.user;
}
