import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./ui/dialog";
import { Button } from "./ui/button";

type FeedbackTone = "success" | "error" | "info";

type ActionFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  tone?: FeedbackTone;
  autoCloseMs?: number;
  closeLabel?: string;
};

function iconForTone(tone: FeedbackTone) {
  if (tone === "success") {
    return <CheckCircle2 className="w-6 h-6 text-emerald-600" />;
  }
  if (tone === "error") {
    return <AlertTriangle className="w-6 h-6 text-red-600" />;
  }
  return <Info className="w-6 h-6 text-blue-600" />;
}

function iconWrapClass(tone: FeedbackTone) {
  if (tone === "success") return "bg-emerald-100";
  if (tone === "error") return "bg-red-100";
  return "bg-blue-100";
}

export function ActionFeedbackModal({
  open,
  onClose,
  title,
  message,
  tone = "info",
  autoCloseMs,
  closeLabel = "Close"
}: ActionFeedbackModalProps) {
  useEffect(() => {
    if (!open || !autoCloseMs) return;
    const timeout = window.setTimeout(() => onClose(), autoCloseMs);
    return () => window.clearTimeout(timeout);
  }, [autoCloseMs, onClose, open]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center ${iconWrapClass(tone)}`}>
              {iconForTone(tone)}
            </span>
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-neutral-600">
            {message}
          </DialogDescription>
        </DialogHeader>
        {!autoCloseMs ? (
          <DialogFooter>
            <Button onClick={onClose}>{closeLabel}</Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
