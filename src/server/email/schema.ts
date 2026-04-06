import { z } from "zod";

export const inboundAttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional().nullable(),
  size: z.number().int().nonnegative().optional().nullable(),
  contentBase64: z.string().optional().nullable()
});

export const inboundEmailSchema = z.object({
  from: z.string().min(1),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  bcc: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  subject: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  raw: z.string().optional().nullable(),
  messageId: z.string().optional().nullable(),
  inReplyTo: z.string().optional().nullable(),
  references: z.array(z.string()).optional().nullable(),
  date: z.string().optional().nullable(),
  attachments: z.array(inboundAttachmentSchema).optional().nullable()
});

export const outboundAttachmentSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional().nullable(),
  contentBase64: z.string().min(1)
});

export const outboundEmailSchema = z.object({
  from: z.string().min(1),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  bcc: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  subject: z.string().min(1),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  replyTo: z.string().optional().nullable(),
  draftId: z.string().uuid().optional().nullable(),
  threadId: z.string().optional().nullable(),
  inReplyTo: z.string().optional().nullable(),
  references: z.array(z.string()).optional().nullable(),
  attachments: z.array(outboundAttachmentSchema).optional().nullable()
});
