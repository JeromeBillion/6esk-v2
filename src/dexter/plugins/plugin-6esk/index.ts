import { type Plugin } from '@elizaos/core';
import { SixeskService } from './sixesk-service';
import { sixeskTicketProvider } from './sixesk-provider';
import { sixeskWebhookRoute } from './sixesk-routes';
import { withRouteScope } from '../../security/route-scope';
import {
  sixeskGetTicketCallOptionsAction,
  sixeskInitiateTicketCallAction,
} from './sixesk-call-actions';

export const plugin6esk: Plugin = {
  name: 'plugin-6esk',
  description: '6esk CRM integration for Dexter support agent',
  services: [SixeskService as any],
  providers: [sixeskTicketProvider],
  routes: [withRouteScope(sixeskWebhookRoute, 'public')],
  actions: [sixeskGetTicketCallOptionsAction, sixeskInitiateTicketCallAction],
};

export { SixeskService } from './sixesk-service';
export type {
  SixeskConfig,
  SixeskTicket,
  SixeskMessage,
  SixeskAction,
  SixeskCustomerHistoryResponse,
  TicketMergePreflight,
  CustomerMergePreflight,
} from './types';
