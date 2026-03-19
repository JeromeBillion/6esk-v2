export type EncodedAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  size: number;
  contentBase64: string;
};

export function formatFileSize(bytes: number | null | undefined) {
  const safe = Number(bytes ?? 0);
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  return `${(safe / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64] = result.split(",");
      resolve(base64 ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function encodeAttachments(files: File[]) {
  return Promise.all(
    files.map(async (file) => ({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      filename: file.name,
      contentType: file.type || null,
      size: file.size,
      contentBase64: await fileToBase64(file)
    }))
  );
}
