import { useState } from 'react';
import {
  Search,
  Filter,
  Plus,
  ChevronDown,
  MoreHorizontal,
  Clock,
  Phone,
  PhoneCall,
  Play,
  Check,
  CheckCheck,
  XCircle,
  Sparkles,
  GitMerge,
} from 'lucide-react';
import { mockTickets, type Ticket } from '../data/mockTickets';
import {
  mockConversationMessages,
  mockTicketEvents,
  mockCustomerInteractions,
  mockAIDrafts,
  type ConversationMessage,
} from '../data/mockConversations';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../components/ui/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Checkbox } from '../components/ui/checkbox';
import { HistoryModal } from '../components/HistoryModal';
import { MergeModal } from '../components/MergeModal';

export function SupportWorkspace() {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeType, setMergeType] = useState<'ticket' | 'customer'>('ticket');

  // Filter tickets
  const filteredTickets = mockTickets.filter((ticket) => {
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesSearch =
      searchQuery === '' ||
      ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.requester_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const toggleTicketSelection = (ticketId: string) => {
    const newSelection = new Set(selectedTickets);
    if (newSelection.has(ticketId)) {
      newSelection.delete(ticketId);
    } else {
      newSelection.add(ticketId);
    }
    setSelectedTickets(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedTickets.size === filteredTickets.length) {
      setSelectedTickets(new Set());
    } else {
      setSelectedTickets(new Set(filteredTickets.map((t) => t.id)));
    }
  };

  const getPriorityColor = (priority: Ticket['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'high':
        return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'medium':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'low':
        return 'bg-neutral-100 text-neutral-700 border-neutral-200';
    }
  };

  const getStatusColor = (status: Ticket['status']) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'resolved':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'closed':
        return 'bg-neutral-100 text-neutral-700 border-neutral-200';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleOpenMerge = (type: 'ticket' | 'customer') => {
    setMergeType(type);
    setShowMergeModal(true);
  };

  return (
    <>
      <div className="h-full flex">
        {/* Ticket Queue */}
        <div className="w-[480px] border-r border-neutral-200 bg-white flex flex-col">
          {/* Header */}
          <div className="border-b border-neutral-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold">Support</h1>
              <Button size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                New Ticket
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                placeholder="Search tickets..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Filter className="w-4 h-4" />
                    Status: {statusFilter === 'all' ? 'All' : statusFilter}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setStatusFilter('all')}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('open')}>Open</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('pending')}>
                    Pending
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('resolved')}>
                    Resolved
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStatusFilter('closed')}>
                    Closed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <GitMerge className="w-4 h-4" />
                    Merge
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleOpenMerge('ticket')}>
                    Merge Tickets
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenMerge('customer')}>
                    Merge Customers
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {selectedTickets.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-sm text-neutral-600">{selectedTickets.size} selected</span>
                  <Button variant="outline" size="sm">
                    Bulk Actions
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Ticket List */}
          <div className="flex-1 overflow-y-auto">
            {/* Select All */}
            {filteredTickets.length > 0 && (
              <div className="border-b border-neutral-200 px-4 py-2 flex items-center gap-3 bg-neutral-50">
                <Checkbox
                  checked={
                    selectedTickets.size === filteredTickets.length && filteredTickets.length > 0
                  }
                  onCheckedChange={toggleSelectAll}
                />
                <span className="text-xs text-neutral-600">
                  {filteredTickets.length} {filteredTickets.length === 1 ? 'ticket' : 'tickets'}
                </span>
              </div>
            )}

            {/* Tickets */}
            {filteredTickets.map((ticket) => (
              <div
                key={ticket.id}
                className={cn(
                  'border-b border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition-colors',
                  selectedTicket?.id === ticket.id && 'bg-blue-50 hover:bg-blue-50',
                  ticket.unread && 'bg-blue-50/30'
                )}
                onClick={() => setSelectedTicket(ticket)}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={selectedTickets.has(ticket.id)}
                    onCheckedChange={() => toggleTicketSelection(ticket.id)}
                    onClick={(e) => e.stopPropagation()}
                  />

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-neutral-600">{ticket.id}</span>
                          {ticket.unread && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                        </div>
                        <h3 className="font-medium text-sm leading-tight truncate">{ticket.subject}</h3>
                      </div>
                      <span className="text-xs text-neutral-500 whitespace-nowrap">
                        {formatDate(ticket.created_at)}
                      </span>
                    </div>

                    {/* Requester */}
                    <p className="text-xs text-neutral-600 mb-2">{ticket.requester_name}</p>

                    {/* Preview */}
                    <p className="text-xs text-neutral-500 line-clamp-2 mb-3">{ticket.preview}</p>

                    {/* Meta */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn('text-xs', getPriorityColor(ticket.priority))}
                      >
                        {ticket.priority}
                      </Badge>
                      <Badge variant="outline" className={cn('text-xs', getStatusColor(ticket.status))}>
                        {ticket.status}
                      </Badge>
                      {ticket.assigned_user_name && (
                        <span className="text-xs text-neutral-600">→ {ticket.assigned_user_name}</span>
                      )}
                      {ticket.has_whatsapp && (
                        <Badge variant="outline" className="text-xs">
                          WhatsApp
                        </Badge>
                      )}
                      {ticket.has_voice && (
                        <Badge variant="outline" className="text-xs">
                          Voice
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {filteredTickets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <p className="text-neutral-600 mb-1">No tickets found</p>
                <p className="text-xs text-neutral-500">Try adjusting your filters</p>
              </div>
            )}
          </div>
        </div>

        {/* Ticket Detail */}
        <div className="flex-1 bg-neutral-50 flex items-center justify-center">
          {selectedTicket ? (
            <TicketDetail ticket={selectedTicket} formatDate={formatDate} />
          ) : (
            <div className="text-center">
              <p className="text-neutral-600 mb-1">Select a ticket to view details</p>
              <p className="text-xs text-neutral-500">Choose from the list on the left</p>
            </div>
          )}
        </div>
      </div>

      {/* Merge Modal */}
      <MergeModal open={showMergeModal} onClose={() => setShowMergeModal(false)} type={mergeType} />
    </>
  );
}

function TicketDetail({ ticket, formatDate }: { ticket: Ticket; formatDate: (date: string) => string }) {
  const [showHistory, setShowHistory] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showAIDraft, setShowAIDraft] = useState(true);

  const messages = mockConversationMessages[ticket.id] || [];
  const events = mockTicketEvents[ticket.id] || [];
  const interactions = mockCustomerInteractions[ticket.requester_email] || [];
  const aiDraft = mockAIDrafts[ticket.id];

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getWhatsAppStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <Check className="w-3 h-3 text-neutral-400" />;
      case 'delivered':
        return <CheckCheck className="w-3 h-3 text-neutral-400" />;
      case 'read':
        return <CheckCheck className="w-3 h-3 text-blue-500" />;
      case 'failed':
        return <XCircle className="w-3 h-3 text-red-500" />;
      default:
        return null;
    }
  };

  const useAIDraft = () => {
    if (aiDraft) {
      setReplyText(aiDraft.suggested_body);
      setShowAIDraft(false);
    }
  };

  return (
    <>
      <div className="w-full h-full flex">
        {/* Main Content */}
        <div className="flex-1 bg-white border-r border-neutral-200 flex flex-col">
          {/* Header */}
          <div className="border-b border-neutral-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 -ml-2"
                    onClick={() => setShowHistory(true)}
                  >
                    <Clock className="w-4 h-4" />
                  </Button>
                  <span className="text-sm font-medium text-neutral-600">{ticket.id}</span>
                  {ticket.unread && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                </div>
                <h2 className="text-xl font-semibold mb-2">{ticket.subject}</h2>
                <p className="text-sm text-neutral-600">
                  {ticket.requester_name} • {ticket.requester_email}
                </p>
              </div>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Status: {ticket.status}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Open</DropdownMenuItem>
                  <DropdownMenuItem>Pending</DropdownMenuItem>
                  <DropdownMenuItem>Resolved</DropdownMenuItem>
                  <DropdownMenuItem>Closed</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Priority: {ticket.priority}
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Low</DropdownMenuItem>
                  <DropdownMenuItem>Medium</DropdownMenuItem>
                  <DropdownMenuItem>High</DropdownMenuItem>
                  <DropdownMenuItem>Urgent</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    Assign
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem>Sarah Chen</DropdownMenuItem>
                  <DropdownMenuItem>Marcus Reid</DropdownMenuItem>
                  <DropdownMenuItem>Elena Rodriguez</DropdownMenuItem>
                  <DropdownMenuItem>James Park</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Conversation */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((message) => (
                <ConversationMessageItem
                  key={message.id}
                  message={message}
                  formatDate={formatDate}
                  formatDuration={formatDuration}
                  getWhatsAppStatusIcon={getWhatsAppStatusIcon}
                />
              ))}

              {messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-xs text-neutral-500">No messages yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Reply Box */}
          <div className="border-t border-neutral-200 p-4">
            <div className="max-w-3xl mx-auto">
              {/* AI Draft Suggestion */}
              {aiDraft && showAIDraft && (
                <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-purple-600 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-purple-900">AI Suggested Reply</h4>
                        <Badge variant="secondary" className="text-xs">
                          {Math.round(aiDraft.confidence * 100)}% confident
                        </Badge>
                      </div>
                      <p className="text-sm text-purple-800 whitespace-pre-wrap mb-3">
                        {aiDraft.suggested_body}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={useAIDraft}>
                          Use Draft
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowAIDraft(false)}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 mb-3">
                <Button variant="outline" size="sm">
                  Reply
                </Button>
                {ticket.has_whatsapp && (
                  <Button variant="outline" size="sm">
                    WhatsApp
                  </Button>
                )}
                {ticket.has_voice && (
                  <Button variant="outline" size="sm" className="gap-2">
                    <Phone className="w-4 h-4" />
                    Voice Call
                  </Button>
                )}
              </div>
              <Textarea
                placeholder="Type your reply..."
                className="resize-none"
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm">
                    Attach
                  </Button>
                  <Button variant="ghost" size="sm">
                    Macro
                  </Button>
                </div>
                <Button size="sm">Send</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Customer Context */}
        <div className="w-80 bg-white overflow-y-auto p-6">
          <h3 className="font-semibold mb-4">Customer Details</h3>

          {/* Profile */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium">
                {ticket.requester_name.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">{ticket.requester_name}</p>
                <p className="text-xs text-neutral-600">{ticket.requester_email}</p>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-neutral-600 mb-2">Tags</h4>
            <div className="flex flex-wrap gap-2">
              {ticket.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          {/* Metadata */}
          <div className="mb-6">
            <h4 className="text-xs font-medium text-neutral-600 mb-2">Metadata</h4>
            <div className="space-y-2">
              {Object.entries(ticket.metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-neutral-600">{key}:</span>
                  <span className="text-neutral-900">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <h4 className="text-xs font-medium text-neutral-600 mb-2">Recent Activity</h4>
            <div className="space-y-3">
              <div className="text-xs">
                <p className="text-neutral-600 mb-1">Ticket created</p>
                <p className="text-neutral-500">{new Date(ticket.created_at).toLocaleString()}</p>
              </div>
              {ticket.assigned_user_name && (
                <div className="text-xs">
                  <p className="text-neutral-600 mb-1">Assigned to {ticket.assigned_user_name}</p>
                  <p className="text-neutral-500">{new Date(ticket.updated_at).toLocaleString()}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* History Modal */}
      <HistoryModal
        open={showHistory}
        onClose={() => setShowHistory(false)}
        ticketEvents={events}
        customerInteractions={interactions}
      />
    </>
  );
}

function ConversationMessageItem({
  message,
  formatDate,
  formatDuration,
  getWhatsAppStatusIcon,
}: {
  message: ConversationMessage;
  formatDate: (date: string) => string;
  formatDuration: (seconds: number) => string;
  getWhatsAppStatusIcon: (status: string) => React.ReactNode;
}) {
  const [showTranscript, setShowTranscript] = useState(false);

  if (message.channel === 'email') {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium">
            {message.from.name.charAt(0)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{message.from.name}</span>
              <span className="text-xs text-neutral-500">{message.from.email}</span>
              <Badge variant="outline" className="text-xs">
                Email
              </Badge>
            </div>
            <p className="text-xs text-neutral-500">{formatDate(message.timestamp)}</p>
          </div>
        </div>
        <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed">
          {message.body}
        </div>
      </div>
    );
  }

  if (message.channel === 'whatsapp') {
    return (
      <div
        className={cn(
          'flex',
          message.direction === 'outbound' ? 'justify-end' : 'justify-start'
        )}
      >
        <div
          className={cn(
            'max-w-[70%] rounded-lg p-3',
            message.direction === 'outbound'
              ? 'bg-blue-500 text-white'
              : 'bg-white border border-neutral-200'
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium">{message.from.name}</span>
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                message.direction === 'outbound'
                  ? 'border-blue-300 text-blue-100'
                  : 'border-neutral-300'
              )}
            >
              WhatsApp
            </Badge>
            {message.is_template && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  message.direction === 'outbound'
                    ? 'border-blue-300 text-blue-100'
                    : 'border-neutral-300'
                )}
              >
                Template
              </Badge>
            )}
          </div>
          <p className="text-sm mb-2">{message.body}</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs opacity-70">{formatDate(message.timestamp)}</span>
            {message.whatsapp_status && (
              <div className="flex items-center gap-1">
                {getWhatsAppStatusIcon(message.whatsapp_status)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (message.channel === 'voice') {
    return (
      <div className="bg-white border border-neutral-200 rounded-lg p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
            <PhoneCall className="w-4 h-4 text-green-700" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">
                {message.direction === 'outbound' ? 'Outbound Call' : 'Inbound Call'}
              </span>
              <Badge variant="outline" className="text-xs">
                Voice
              </Badge>
              {message.call_status === 'completed' && (
                <Badge variant="outline" className="text-xs bg-green-50">
                  Completed
                </Badge>
              )}
            </div>
            <p className="text-xs text-neutral-600">
              {message.from.name} → {message.to.name}
            </p>
            <p className="text-xs text-neutral-500">{formatDate(message.timestamp)}</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-neutral-400" />
              <span className="text-neutral-700">
                Duration: {formatDuration(message.call_duration || 0)}
              </span>
            </div>
          </div>

          {message.call_outcome && (
            <div className="p-3 bg-neutral-50 rounded text-sm text-neutral-700">
              <strong>Outcome:</strong> {message.call_outcome}
            </div>
          )}

          {message.transcript && (
            <>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 w-full"
                onClick={() => setShowTranscript(!showTranscript)}
              >
                {showTranscript ? 'Hide' : 'Show'} Transcript
                <ChevronDown
                  className={cn('w-4 h-4 transition-transform', showTranscript && 'rotate-180')}
                />
              </Button>
              {showTranscript && (
                <div className="p-3 bg-neutral-50 rounded text-xs text-neutral-700 whitespace-pre-wrap">
                  {message.transcript}
                </div>
              )}
            </>
          )}

          {message.recording_url && (
            <Button variant="outline" size="sm" className="gap-2 w-full">
              <Play className="w-4 h-4" />
              Play Recording
            </Button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
