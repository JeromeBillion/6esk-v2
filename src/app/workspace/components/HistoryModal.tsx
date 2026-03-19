import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";

export type HistoryTicketEvent = {
  id: string;
  type: "status_change" | "assignment" | "tag_added" | "tag_removed" | "priority_change" | "note_added";
  actor: string;
  timestamp: string;
  details: string;
  metadata?: Record<string, unknown>;
};

export type HistoryAuditEvent = {
  id: string;
  action: string;
  actor: string;
  entity: string;
  timestamp: string;
};

type HistoryModalProps = {
  open: boolean;
  onClose: () => void;
  ticketEvents: HistoryTicketEvent[];
  auditEvents?: HistoryAuditEvent[];
};

export function HistoryModal({
  open,
  onClose,
  ticketEvents,
  auditEvents = [],
}: HistoryModalProps) {
  const sortedEvents = [...ticketEvents].sort(
    (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
  const sortedAuditEvents = [...auditEvents].sort(
    (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getEventIcon = (type: HistoryTicketEvent["type"]) => {
    switch (type) {
      case "status_change":
        return "S";
      case "assignment":
        return "A";
      case "tag_added":
        return "T+";
      case "tag_removed":
        return "T-";
      case "priority_change":
        return "P";
      case "note_added":
        return "N";
      default:
        return "•";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            History
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="activity" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="activity">Ticket Activity ({sortedEvents.length})</TabsTrigger>
            <TabsTrigger value="audit">Audit Log ({sortedAuditEvents.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {sortedEvents.length === 0 ? (
                <div className="h-[360px] flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm font-medium text-neutral-900 mb-1">No ticket activity yet</p>
                    <p className="text-xs text-neutral-500">
                      Status changes, assignments, and system updates will appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedEvents.map((event, index) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-[11px] font-medium">
                        {getEventIcon(event.type)}
                      </div>
                      {index < sortedEvents.length - 1 ? (
                        <div className="w-0.5 flex-1 bg-neutral-200 my-1" style={{ minHeight: "20px" }} />
                      ) : null}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-sm font-medium">{event.details}</p>
                        <span className="text-xs text-neutral-500 whitespace-nowrap ml-2">
                          {formatTimestamp(event.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600">by {event.actor}</p>
                      {event.metadata ? (
                        <div className="mt-2 text-xs text-neutral-500">
                          {Object.entries(event.metadata).map(([key, value]) => (
                            <div key={key}>
                              {key}: {String(value)}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {sortedAuditEvents.length === 0 ? (
                <div className="h-[360px] flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm font-medium text-neutral-900 mb-1">No audit entries yet</p>
                    <p className="text-xs text-neutral-500">
                      Administrative and ticket-level write actions will appear here.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedAuditEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border border-neutral-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">{event.action}</p>
                          <p className="text-xs text-neutral-600 mt-1">
                            {event.actor} • {event.entity}
                          </p>
                        </div>
                        <span className="text-xs text-neutral-500 whitespace-nowrap">
                          {formatTimestamp(event.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
