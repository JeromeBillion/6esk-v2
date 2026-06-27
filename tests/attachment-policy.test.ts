import { describe, expect, it } from "vitest";
import {
  DEFAULT_ATTACHMENT_LIMITS,
  estimateBase64DecodedBytes,
  validateAttachmentList
} from "@/server/attachments/policy";

describe("attachment policy", () => {
  it("estimates decoded bytes before allocating buffers", () => {
    expect(estimateBase64DecodedBytes(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(estimateBase64DecodedBytes("not-base64!")).toBeNull();
  });

  it("rejects too many attachments", () => {
    const attachments = Array.from({ length: DEFAULT_ATTACHMENT_LIMITS.maxCount + 1 }, (_, index) => ({
      filename: `file-${index}.txt`,
      contentType: "text/plain",
      contentBase64: Buffer.from("ok").toString("base64")
    }));

    expect(validateAttachmentList(attachments)).toMatchObject({
      ok: false,
      message: `At most ${DEFAULT_ATTACHMENT_LIMITS.maxCount} attachments are allowed.`
    });
  });

  it("rejects oversized attachment payloads", () => {
    const encoded = Buffer.alloc(DEFAULT_ATTACHMENT_LIMITS.maxBytesPerAttachment + 1).toString("base64");

    expect(
      validateAttachmentList([
        {
          filename: "large.txt",
          contentType: "text/plain",
          contentBase64: encoded
        }
      ])
    ).toMatchObject({
      ok: false,
      message: "Attachment exceeds the per-file size limit."
    });
  });
});
