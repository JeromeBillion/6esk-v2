/** WhatsApp Cloud API message types */
export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'interactive'
  | 'template'
  | 'reaction'
  | 'location'
  | 'contacts'
  | 'sticker'
  | 'unknown';

/** Inbound message from WhatsApp Cloud API webhook */
export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: WhatsAppMessageType;
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string; caption?: string };
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string };
  audio?: { id: string; mime_type: string; sha256: string };
  video?: { id: string; mime_type: string; sha256: string; caption?: string };
  reaction?: { message_id: string; emoji: string };
  context?: { from: string; id: string };
}

/** Contact info from WhatsApp webhook */
export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

/** Status update from WhatsApp webhook */
export interface WhatsAppStatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

/** Top-level webhook payload from Meta Cloud API */
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: WhatsAppContact[];
        messages?: WhatsAppInboundMessage[];
        statuses?: WhatsAppStatusUpdate[];
        errors?: Array<{ code: number; title: string; message?: string }>;
      };
      field: 'messages';
    }>;
  }>;
}

/** Send text message request */
export interface WhatsAppSendTextRequest {
  to: string;
  text: string;
  previewUrl?: boolean;
}

/** Send template message request */
export interface WhatsAppSendTemplateRequest {
  to: string;
  templateName: string;
  languageCode: string;
  components?: Array<{
    type: 'header' | 'body' | 'button';
    parameters: Array<{ type: 'text'; text: string }>;
  }>;
}

/** Runtime configuration for the WhatsApp plugin */
export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  graphApiVersion: string;
}

/** Session tracking for WhatsApp conversations */
export interface WhatsAppSession {
  phoneNumber: string;
  contactName: string;
  roomId: string;
  entityId: string;
  lastMessageAt: number;
}
