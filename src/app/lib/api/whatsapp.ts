import { apiFetch } from "@/app/lib/api/http";

export type ActiveWhatsAppTemplate = {
  id: string;
  provider: string;
  name: string;
  language: string;
  category?: string | null;
  status: string;
  components?: Array<Record<string, unknown>> | null;
};

export async function listActiveWhatsAppTemplates(signal?: AbortSignal) {
  const payload = await apiFetch<{ templates: ActiveWhatsAppTemplate[] }>("/api/whatsapp/templates", {
    signal
  });
  return payload.templates ?? [];
}
