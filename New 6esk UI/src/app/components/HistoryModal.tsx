import { Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import type { TicketEvent, CustomerInteraction } from '../data/mockConversations';

export function HistoryModal({
  open,
  onClose,
  ticketEvents,
  customerInteractions,
}: {
  open: boolean;
  onClose: () => void;
  ticketEvents: TicketEvent[];
  customerInteractions: CustomerInteraction[];
}) {
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getEventIcon = (type: TicketEvent['type']) => {
    switch (type) {
      case 'status_change':
        return '🔄';
      case 'assignment':
        return '👤';
      case 'tag_added':
        return '🏷️';
      case 'tag_removed':
        return '🏷️';
      case 'priority_change':
        return '⚡';
      case 'note_added':
        return '📝';
      default:
        return '•';
    }
  };

  const getInteractionIcon = (type: CustomerInteraction['type']) => {
    switch (type) {
      case 'ticket_created':
        return '🎫';
      case 'message_sent':
        return '💬';
      case 'call_completed':
        return '📞';
      case 'ticket_resolved':
        return '✅';
      default:
        return '•';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            History
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="activity" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="activity">Ticket Activity</TabsTrigger>
            <TabsTrigger value="customer">Customer History</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {ticketEvents.map((event, index) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center text-sm">
                        {getEventIcon(event.type)}
                      </div>
                      {index < ticketEvents.length - 1 && (
                        <div className="w-0.5 flex-1 bg-neutral-200 my-1" style={{ minHeight: '20px' }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-sm font-medium">{event.details}</p>
                        <span className="text-xs text-neutral-500 whitespace-nowrap ml-2">
                          {formatTimestamp(event.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600">by {event.actor}</p>
                      {event.metadata && (
                        <div className="mt-2 text-xs text-neutral-500">
                          {Object.entries(event.metadata).map(([key, value]) => (
                            <div key={key}>
                              {key}: {String(value)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="customer" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {customerInteractions.map((interaction, index) => (
                  <div key={interaction.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm">
                        {getInteractionIcon(interaction.type)}
                      </div>
                      {index < customerInteractions.length - 1 && (
                        <div className="w-0.5 flex-1 bg-neutral-200 my-1" style={{ minHeight: '20px' }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-sm font-medium">{interaction.summary}</p>
                        <span className="text-xs text-neutral-500 whitespace-nowrap ml-2">
                          {formatTimestamp(interaction.timestamp)}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-xs mt-1">
                        {interaction.ticket_id}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
