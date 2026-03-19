// Mock data for mail messages
export interface MailMessage {
  id: string;
  thread_id: string;
  direction: 'inbound' | 'outbound';
  from: {
    name: string;
    email: string;
  };
  to: {
    name: string;
    email: string;
  }[];
  cc?: {
    name: string;
    email: string;
  }[];
  subject: string;
  preview: string;
  body_text: string;
  body_html?: string;
  sent_at: string;
  received_at: string;
  read: boolean;
  starred: boolean;
  pinned: boolean;
  has_attachments: boolean;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  download_url: string;
}

export interface MailThread {
  id: string;
  subject: string;
  participants: string[];
  message_count: number;
  last_message_at: string;
  unread: boolean;
  starred: boolean;
  messages: MailMessage[];
}

export const mockMailThreads: MailThread[] = [
  {
    id: 'thread-1',
    subject: 'Q1 Support Metrics Review',
    participants: ['Sarah Chen', 'Marcus Reid'],
    message_count: 3,
    last_message_at: '2026-03-18T10:45:00Z',
    unread: true,
    starred: false,
    messages: [
      {
        id: 'msg-1',
        thread_id: 'thread-1',
        direction: 'inbound',
        from: { name: 'Marcus Reid', email: 'marcus@6esk.com' },
        to: [{ name: 'Sarah Chen', email: 'sarah@6esk.com' }],
        subject: 'Q1 Support Metrics Review',
        preview: 'Hey Sarah, I wanted to share the Q1 metrics with you before our meeting...',
        body_text: `Hey Sarah,

I wanted to share the Q1 metrics with you before our meeting tomorrow. Overall, we're seeing some really positive trends:

- First response time down 23% from Q4
- Customer satisfaction score up to 4.7/5
- Ticket resolution rate improved to 94%

The WhatsApp channel is really taking off - we're seeing 40% of new tickets come through there now. Voice support is still around 15% but growing steadily.

Let me know if you have any questions before tomorrow!

Marcus`,
        sent_at: '2026-03-18T09:30:00Z',
        received_at: '2026-03-18T09:30:00Z',
        read: false,
        starred: false,
        pinned: false,
        has_attachments: true,
        attachments: [
          {
            id: 'att-1',
            filename: 'Q1-Metrics-Report.pdf',
            content_type: 'application/pdf',
            size: 245678,
            download_url: '#',
          },
        ],
      },
      {
        id: 'msg-2',
        thread_id: 'thread-1',
        direction: 'outbound',
        from: { name: 'Sarah Chen', email: 'sarah@6esk.com' },
        to: [{ name: 'Marcus Reid', email: 'marcus@6esk.com' }],
        subject: 'Re: Q1 Support Metrics Review',
        preview: 'Thanks Marcus! These numbers look fantastic. The WhatsApp growth is impressive...',
        body_text: `Thanks Marcus!

These numbers look fantastic. The WhatsApp growth is impressive - we should definitely highlight that in the board presentation.

Can you also pull the breakdown by priority level? I want to see if we're handling urgent tickets faster.

Sarah`,
        sent_at: '2026-03-18T10:15:00Z',
        received_at: '2026-03-18T10:15:00Z',
        read: true,
        starred: false,
        pinned: false,
        has_attachments: false,
      },
      {
        id: 'msg-3',
        thread_id: 'thread-1',
        direction: 'inbound',
        from: { name: 'Marcus Reid', email: 'marcus@6esk.com' },
        to: [{ name: 'Sarah Chen', email: 'sarah@6esk.com' }],
        subject: 'Re: Q1 Support Metrics Review',
        preview: 'Absolutely! I\'ll add that breakdown to the report. Urgent tickets are averaging...',
        body_text: `Absolutely! I'll add that breakdown to the report.

Urgent tickets are averaging 12 minutes for first response (down from 18 minutes in Q4). High priority is at 45 minutes, and everything else is under 2 hours.

I'll have the updated report ready by end of day.

Marcus`,
        sent_at: '2026-03-18T10:45:00Z',
        received_at: '2026-03-18T10:45:00Z',
        read: false,
        starred: false,
        pinned: false,
        has_attachments: false,
      },
    ],
  },
  {
    id: 'thread-2',
    subject: 'Webhook Integration Documentation',
    participants: ['Elena Rodriguez', 'Dev Team'],
    message_count: 1,
    last_message_at: '2026-03-18T09:20:00Z',
    unread: true,
    starred: true,
    messages: [
      {
        id: 'msg-4',
        thread_id: 'thread-2',
        direction: 'inbound',
        from: { name: 'Elena Rodriguez', email: 'elena@6esk.com' },
        to: [{ name: 'Dev Team', email: 'dev@6esk.com' }],
        subject: 'Webhook Integration Documentation',
        preview: 'Hi team, I\'ve been getting questions from customers about webhook retry logic...',
        body_text: `Hi team,

I've been getting questions from customers about webhook retry logic. Can we add more detail to the docs about:

1. How many times we retry failed webhooks
2. The backoff strategy
3. How to manually trigger a retry

This would save a lot of back-and-forth with enterprise customers.

Thanks!
Elena`,
        sent_at: '2026-03-18T09:20:00Z',
        received_at: '2026-03-18T09:20:00Z',
        read: false,
        starred: true,
        pinned: false,
        has_attachments: false,
      },
    ],
  },
  {
    id: 'thread-3',
    subject: 'Team Lunch - Friday',
    participants: ['James Park', 'Team'],
    message_count: 2,
    last_message_at: '2026-03-17T15:30:00Z',
    unread: false,
    starred: false,
    messages: [
      {
        id: 'msg-5',
        thread_id: 'thread-3',
        direction: 'inbound',
        from: { name: 'James Park', email: 'james@6esk.com' },
        to: [{ name: 'Support Team', email: 'team@6esk.com' }],
        subject: 'Team Lunch - Friday',
        preview: 'Hey everyone! Let\'s do team lunch this Friday at 12:30. Any preferences?',
        body_text: `Hey everyone!

Let's do team lunch this Friday at 12:30. Any preferences for where we go?

Options:
- Italian place downtown
- New sushi spot
- BBQ food truck
- Thai restaurant

Vote in replies!

James`,
        sent_at: '2026-03-17T14:00:00Z',
        received_at: '2026-03-17T14:00:00Z',
        read: true,
        starred: false,
        pinned: false,
        has_attachments: false,
      },
      {
        id: 'msg-6',
        thread_id: 'thread-3',
        direction: 'outbound',
        from: { name: 'Sarah Chen', email: 'sarah@6esk.com' },
        to: [{ name: 'James Park', email: 'james@6esk.com' }],
        cc: [{ name: 'Support Team', email: 'team@6esk.com' }],
        subject: 'Re: Team Lunch - Friday',
        preview: 'Sushi sounds great! Count me in.',
        body_text: `Sushi sounds great! Count me in.

Sarah`,
        sent_at: '2026-03-17T15:30:00Z',
        received_at: '2026-03-17T15:30:00Z',
        read: true,
        starred: false,
        pinned: false,
        has_attachments: false,
      },
    ],
  },
  {
    id: 'thread-4',
    subject: 'SLA Target Updates for Q2',
    participants: ['Sarah Chen', 'Leadership'],
    message_count: 1,
    last_message_at: '2026-03-17T11:00:00Z',
    unread: false,
    starred: true,
    messages: [
      {
        id: 'msg-7',
        thread_id: 'thread-4',
        direction: 'outbound',
        from: { name: 'Sarah Chen', email: 'sarah@6esk.com' },
        to: [{ name: 'Leadership Team', email: 'leadership@6esk.com' }],
        subject: 'SLA Target Updates for Q2',
        preview: 'Team, based on Q1 performance, I\'d like to propose tighter SLA targets for Q2...',
        body_text: `Team,

Based on Q1 performance, I'd like to propose tighter SLA targets for Q2:

Current → Proposed
- First Response: 2 hours → 90 minutes
- Resolution Time: 24 hours → 20 hours
- Customer Satisfaction: 4.5/5 → 4.7/5

We're already hitting these numbers consistently, so formalizing them makes sense. This will also help us compete better in the enterprise segment.

Let me know your thoughts.

Sarah`,
        sent_at: '2026-03-17T11:00:00Z',
        received_at: '2026-03-17T11:00:00Z',
        read: true,
        starred: true,
        pinned: true,
        has_attachments: false,
      },
    ],
  },
  {
    id: 'thread-5',
    subject: 'Customer: TechCorp - Escalation',
    participants: ['Marcus Reid', 'Sarah Chen'],
    message_count: 1,
    last_message_at: '2026-03-16T16:45:00Z',
    unread: false,
    starred: false,
    messages: [
      {
        id: 'msg-8',
        thread_id: 'thread-5',
        direction: 'inbound',
        from: { name: 'Marcus Reid', email: 'marcus@6esk.com' },
        to: [{ name: 'Sarah Chen', email: 'sarah@6esk.com' }],
        subject: 'Customer: TechCorp - Escalation',
        preview: 'Sarah, TechCorp is threatening to churn. Dashboard access issue for 3 days...',
        body_text: `Sarah,

TechCorp is threatening to churn. Dashboard access issue has been ongoing for 3 days now. Their CTO called me directly this morning.

Here's what happened:
- Issue started Friday evening
- We diagnosed it as a caching problem
- Fix was deployed Saturday but didn't work
- Engineering is working on it but no ETA yet

They're a $50k/year account and this is really damaging the relationship. Can you get Engineering to prioritize this?

I've offered them a service credit but they want the problem fixed first.

Marcus`,
        sent_at: '2026-03-16T16:45:00Z',
        received_at: '2026-03-16T16:45:00Z',
        read: true,
        starred: false,
        pinned: false,
        has_attachments: false,
      },
    ],
  },
];
