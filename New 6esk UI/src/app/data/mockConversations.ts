// Enhanced mock data for conversation messages
export interface ConversationMessage {
  id: string;
  ticket_id: string;
  channel: 'email' | 'whatsapp' | 'voice';
  direction: 'inbound' | 'outbound';
  from: {
    name: string;
    email?: string;
    phone?: string;
  };
  to: {
    name: string;
    email?: string;
    phone?: string;
  };
  subject?: string;
  body: string;
  timestamp: string;
  read: boolean;
  // WhatsApp specific
  whatsapp_status?: 'sent' | 'delivered' | 'read' | 'failed';
  is_template?: boolean;
  template_name?: string;
  // Voice specific
  call_duration?: number;
  call_status?: 'ringing' | 'in-progress' | 'completed' | 'failed' | 'no-answer';
  call_outcome?: string;
  transcript?: string;
  recording_url?: string;
  // Email specific
  has_attachments?: boolean;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  type: 'status_change' | 'assignment' | 'tag_added' | 'tag_removed' | 'priority_change' | 'note_added';
  actor: string;
  timestamp: string;
  details: string;
  metadata?: Record<string, any>;
}

export interface CustomerInteraction {
  id: string;
  ticket_id: string;
  type: 'ticket_created' | 'message_sent' | 'call_completed' | 'ticket_resolved';
  summary: string;
  timestamp: string;
}

export interface AIDraft {
  id: string;
  ticket_id: string;
  suggested_body: string;
  confidence: number;
  generated_at: string;
}

// Mock conversation messages for ticket TKT-1847
export const mockConversationMessages: Record<string, ConversationMessage[]> = {
  'TKT-1847': [
    {
      id: 'msg-1847-1',
      ticket_id: 'TKT-1847',
      channel: 'email',
      direction: 'inbound',
      from: { name: 'John Davidson', email: 'john.davidson@techcorp.com' },
      to: { name: 'Support', email: 'support@6esk.com' },
      subject: 'Unable to access dashboard after latest update',
      body: `Hi,

I've been trying to log into my dashboard since the update went live this morning, but I keep getting an error message saying "Session expired, please try again."

I've tried:
- Clearing my browser cache
- Using incognito mode
- Different browsers (Chrome, Firefox, Safari)
- Different devices (laptop and phone)

Nothing seems to work. This is urgent as I need to access our reports for a client meeting in 2 hours.

Can you please help?

Best regards,
John Davidson
Senior Product Manager, TechCorp`,
      timestamp: '2026-03-18T09:24:00Z',
      read: true,
      has_attachments: false,
    },
    {
      id: 'msg-1847-2',
      ticket_id: 'TKT-1847',
      channel: 'email',
      direction: 'outbound',
      from: { name: 'Sarah Chen', email: 'sarah@6esk.com' },
      to: { name: 'John Davidson', email: 'john.davidson@techcorp.com' },
      subject: 'Re: Unable to access dashboard after latest update',
      body: `Hi John,

Thanks for reaching out and I apologize for the inconvenience.

I can see the issue on our end - there was a session management bug introduced in this morning's update that's affecting some users. Our engineering team is working on a hotfix right now.

In the meantime, I've manually refreshed your session on the backend. Can you try logging in again? You should be able to access your dashboard now.

I'll follow up once the permanent fix is deployed to make sure everything is working smoothly.

Best regards,
Sarah Chen
Lead Support Agent, 6esk`,
      timestamp: '2026-03-18T09:45:00Z',
      read: true,
      has_attachments: false,
    },
    {
      id: 'msg-1847-3',
      ticket_id: 'TKT-1847',
      channel: 'whatsapp',
      direction: 'inbound',
      from: { name: 'John Davidson', phone: '+1234567890' },
      to: { name: 'Support', phone: '+1987654321' },
      body: 'Thanks Sarah! Just tried and I can access it now. You saved my meeting! 🙏',
      timestamp: '2026-03-18T09:52:00Z',
      read: true,
      whatsapp_status: 'read',
      is_template: false,
    },
    {
      id: 'msg-1847-4',
      ticket_id: 'TKT-1847',
      channel: 'whatsapp',
      direction: 'outbound',
      from: { name: 'Sarah Chen', phone: '+1987654321' },
      to: { name: 'John Davidson', phone: '+1234567890' },
      body: 'Glad to hear it! The permanent fix will be deployed in the next hour. Let me know if you run into any other issues.',
      timestamp: '2026-03-18T09:54:00Z',
      read: true,
      whatsapp_status: 'read',
      is_template: false,
    },
  ],
  'TKT-1846': [
    {
      id: 'msg-1846-1',
      ticket_id: 'TKT-1846',
      channel: 'email',
      direction: 'inbound',
      from: { name: 'Maria Santos', email: 'maria.santos@globex.io' },
      to: { name: 'Support', email: 'support@6esk.com' },
      subject: 'Billing discrepancy on March invoice',
      body: `Hello,

I noticed our March invoice shows charges for features we haven't activated yet. Specifically:

- Advanced Analytics Pro: $499/mo (we're on Basic Analytics)
- WhatsApp Business Premium: $299/mo (we only have Standard)
- Custom Integrations: $199/mo (not using this)

Our expected total should be around $850/mo, but the invoice shows $1,846/mo.

Please review and send a corrected invoice.

Thank you,
Maria Santos
CFO, Globex Inc.`,
      timestamp: '2026-03-18T08:15:00Z',
      read: true,
      has_attachments: false,
    },
    {
      id: 'msg-1846-2',
      ticket_id: 'TKT-1846',
      channel: 'email',
      direction: 'outbound',
      from: { name: 'Marcus Reid', email: 'marcus@6esk.com' },
      to: { name: 'Maria Santos', email: 'maria.santos@globex.io' },
      subject: 'Re: Billing discrepancy on March invoice',
      body: `Hi Maria,

Thank you for bringing this to our attention. I've reviewed your account and you're absolutely right - these features were incorrectly included on your invoice.

I've already:
- Corrected your invoice to reflect your actual plan ($850/mo)
- Applied a $100 credit to your account for the inconvenience
- Updated our billing system to prevent this from happening again

Your corrected invoice has been sent to your email. The credit will be applied to next month's payment.

I apologize for the confusion and appreciate your patience.

Best regards,
Marcus Reid
Support Agent, 6esk`,
      timestamp: '2026-03-18T10:32:00Z',
      read: true,
      has_attachments: true,
    },
    {
      id: 'msg-1846-3',
      ticket_id: 'TKT-1846',
      channel: 'voice',
      direction: 'outbound',
      from: { name: 'Marcus Reid', phone: '+1987654321' },
      to: { name: 'Maria Santos', phone: '+1234567891' },
      body: 'Follow-up call to ensure billing issue was resolved.',
      timestamp: '2026-03-18T11:00:00Z',
      read: true,
      call_duration: 320,
      call_status: 'completed',
      call_outcome: 'Customer confirmed receipt of corrected invoice and was satisfied with the resolution.',
      transcript: `Marcus: Hi Maria, this is Marcus from 6esk. I wanted to follow up on the billing issue you reported earlier.

Maria: Oh hi Marcus! Yes, I received the corrected invoice. Thank you for handling that so quickly.

Marcus: Great! I also wanted to confirm you received the $100 credit we applied to your account.

Maria: Yes, I saw that. That's very much appreciated. 

Marcus: Wonderful. Is there anything else I can help you with today?

Maria: No, that's all. Thanks again for the quick resolution.

Marcus: My pleasure. Have a great day!`,
      recording_url: '#',
    },
  ],
  'TKT-1840': [
    {
      id: 'msg-1840-1',
      ticket_id: 'TKT-1840',
      channel: 'email',
      direction: 'inbound',
      from: { name: 'Emily Zhang', email: 'emily.zhang@saas.company' },
      to: { name: 'Support', email: 'support@6esk.com' },
      subject: 'Mobile app keeps crashing on iOS',
      body: `Hi,

The mobile app crashes immediately after opening on my iPhone 15 Pro. I've tried reinstalling multiple times but the issue persists.

iOS version: 17.3
App version: 2.4.1

Please help!

Emily`,
      timestamp: '2026-03-17T10:15:00Z',
      read: true,
      has_attachments: false,
    },
    {
      id: 'msg-1840-2',
      ticket_id: 'TKT-1840',
      channel: 'whatsapp',
      direction: 'outbound',
      from: { name: 'Sarah Chen', phone: '+1987654321' },
      to: { name: 'Emily Zhang', phone: '+1234567892' },
      body: "Hi Emily, we've identified the iOS crash issue and pushed an emergency update. Can you update to version 2.4.2 from the App Store and let us know if it's working?",
      timestamp: '2026-03-17T11:30:00Z',
      read: true,
      whatsapp_status: 'read',
      is_template: true,
      template_name: 'urgent_update_notification',
    },
    {
      id: 'msg-1840-3',
      ticket_id: 'TKT-1840',
      channel: 'whatsapp',
      direction: 'inbound',
      from: { name: 'Emily Zhang', phone: '+1234567892' },
      to: { name: 'Sarah Chen', phone: '+1987654321' },
      body: 'Updated and it works perfectly now! Thank you so much for the quick fix!',
      timestamp: '2026-03-17T11:45:00Z',
      read: true,
      whatsapp_status: 'read',
      is_template: false,
    },
  ],
};

// Mock ticket events
export const mockTicketEvents: Record<string, TicketEvent[]> = {
  'TKT-1847': [
    {
      id: 'evt-1847-1',
      ticket_id: 'TKT-1847',
      type: 'status_change',
      actor: 'System',
      timestamp: '2026-03-18T09:24:00Z',
      details: 'Ticket created with status: Open',
    },
    {
      id: 'evt-1847-2',
      ticket_id: 'TKT-1847',
      type: 'assignment',
      actor: 'Auto-Assignment',
      timestamp: '2026-03-18T09:24:30Z',
      details: 'Assigned to Sarah Chen',
    },
    {
      id: 'evt-1847-3',
      ticket_id: 'TKT-1847',
      type: 'tag_added',
      actor: 'Sarah Chen',
      timestamp: '2026-03-18T09:30:00Z',
      details: 'Added tags: bug, dashboard, urgent',
    },
    {
      id: 'evt-1847-4',
      ticket_id: 'TKT-1847',
      type: 'priority_change',
      actor: 'Sarah Chen',
      timestamp: '2026-03-18T09:30:15Z',
      details: 'Priority changed from High to Urgent',
    },
  ],
  'TKT-1846': [
    {
      id: 'evt-1846-1',
      ticket_id: 'TKT-1846',
      type: 'status_change',
      actor: 'System',
      timestamp: '2026-03-18T08:15:00Z',
      details: 'Ticket created with status: Open',
    },
    {
      id: 'evt-1846-2',
      ticket_id: 'TKT-1846',
      type: 'assignment',
      actor: 'Marcus Reid',
      timestamp: '2026-03-18T08:20:00Z',
      details: 'Assigned to Marcus Reid',
    },
    {
      id: 'evt-1846-3',
      ticket_id: 'TKT-1846',
      type: 'tag_added',
      actor: 'Marcus Reid',
      timestamp: '2026-03-18T08:20:30Z',
      details: 'Added tags: billing, invoice',
    },
    {
      id: 'evt-1846-4',
      ticket_id: 'TKT-1846',
      type: 'status_change',
      actor: 'Marcus Reid',
      timestamp: '2026-03-18T10:32:00Z',
      details: 'Status changed from Open to Pending',
    },
    {
      id: 'evt-1846-5',
      ticket_id: 'TKT-1846',
      type: 'note_added',
      actor: 'Marcus Reid',
      timestamp: '2026-03-18T11:05:00Z',
      details: 'Added internal note: Customer confirmed satisfaction with resolution via phone call',
    },
  ],
};

// Mock AI drafts
export const mockAIDrafts: Record<string, AIDraft> = {
  'TKT-1845': {
    id: 'draft-1845',
    ticket_id: 'TKT-1845',
    suggested_body: `Hi Alex,

Thank you for your feature request! CSV export is actually already available in your Pro plan.

To export your analytics data:
1. Go to Analytics > Reports
2. Select your date range and filters
3. Click the "Export" button in the top right
4. Choose "CSV" format

The export will include all metrics visible in your current view. Let me know if you have any questions!

Best regards,
Elena Rodriguez`,
    confidence: 0.92,
    generated_at: '2026-03-18T07:45:00Z',
  },
};

// Mock customer interactions
export const mockCustomerInteractions: Record<string, CustomerInteraction[]> = {
  'john.davidson@techcorp.com': [
    {
      id: 'int-1',
      ticket_id: 'TKT-1847',
      type: 'ticket_created',
      summary: 'Unable to access dashboard after latest update',
      timestamp: '2026-03-18T09:24:00Z',
    },
    {
      id: 'int-2',
      ticket_id: 'TKT-1723',
      type: 'ticket_resolved',
      summary: 'Question about API rate limits',
      timestamp: '2026-03-10T14:30:00Z',
    },
    {
      id: 'int-3',
      ticket_id: 'TKT-1654',
      type: 'ticket_resolved',
      summary: 'How to add team members?',
      timestamp: '2026-02-28T11:20:00Z',
    },
  ],
};