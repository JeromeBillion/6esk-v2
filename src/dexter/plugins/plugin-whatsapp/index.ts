import { type Plugin } from '@elizaos/core';
import { WhatsAppService } from './whatsapp-service';
import { whatsappVerifyRoute, whatsappWebhookRoute } from './whatsapp-routes';
import { withRouteScope } from '../../security/route-scope';

export const pluginWhatsApp: Plugin = {
  name: 'plugin-whatsapp',
  description: 'WhatsApp Business integration via Meta Cloud API for Dexter',
  services: [WhatsAppService as any],
  routes: [
    withRouteScope(whatsappVerifyRoute, 'public'),
    withRouteScope(whatsappWebhookRoute, 'public'),
  ],
};

export { WhatsAppService } from './whatsapp-service';
export type {
  WhatsAppConfig,
  WhatsAppInboundMessage,
  WhatsAppWebhookPayload,
  WhatsAppSendTextRequest,
  WhatsAppSendTemplateRequest,
  WhatsAppSession,
} from './types';
