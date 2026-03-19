import { useState } from 'react';
import {
  Search,
  Star,
  Paperclip,
  Send,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  Forward,
  MoreHorizontal,
  ChevronLeft,
  X,
} from 'lucide-react';
import { mockMailThreads, type MailThread, type MailMessage } from '../data/mockMail';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../components/ui/utils';

type MailView = 'inbox' | 'starred' | 'sent';

export function MailWorkspace() {
  const [currentView, setCurrentView] = useState<MailView>('inbox');
  const [selectedThread, setSelectedThread] = useState<MailThread | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<MailMessage | null>(null);

  // Filter threads based on view
  const filteredThreads = mockMailThreads.filter((thread) => {
    const matchesView =
      currentView === 'inbox' ||
      (currentView === 'starred' && thread.starred) ||
      (currentView === 'sent' && thread.messages.some((m) => m.direction === 'outbound'));

    const matchesSearch =
      searchQuery === '' ||
      thread.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      thread.participants.some((p) => p.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesView && matchesSearch;
  });

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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const toggleStar = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // In real app, this would update the backend
    console.log('Toggle star for thread:', threadId);
  };

  return (
    <div className="h-full flex">
      {/* Sidebar Navigation */}
      <div className="w-56 border-r border-neutral-200 bg-white flex flex-col p-3">
        <Button
          className="w-full mb-4 gap-2"
          onClick={() => {
            setComposing(true);
            setSelectedThread(null);
          }}
        >
          <Send className="w-4 h-4" />
          Compose
        </Button>

        <nav className="space-y-1">
          <button
            onClick={() => setCurrentView('inbox')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              currentView === 'inbox'
                ? 'bg-neutral-100 text-neutral-900 font-medium'
                : 'text-neutral-600 hover:bg-neutral-50'
            )}
          >
            <Inbox className="w-4 h-4" />
            <span>Inbox</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              {mockMailThreads.filter((t) => t.unread).length}
            </Badge>
          </button>

          <button
            onClick={() => setCurrentView('starred')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              currentView === 'starred'
                ? 'bg-neutral-100 text-neutral-900 font-medium'
                : 'text-neutral-600 hover:bg-neutral-50'
            )}
          >
            <Star className="w-4 h-4" />
            <span>Starred</span>
          </button>

          <button
            onClick={() => setCurrentView('sent')}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              currentView === 'sent'
                ? 'bg-neutral-100 text-neutral-900 font-medium'
                : 'text-neutral-600 hover:bg-neutral-50'
            )}
          >
            <Send className="w-4 h-4" />
            <span>Sent</span>
          </button>
        </nav>
      </div>

      {/* Thread List */}
      <div className="w-[420px] border-r border-neutral-200 bg-white flex flex-col">
        {/* Header */}
        <div className="border-b border-neutral-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold capitalize">{currentView}</h1>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <Input
              placeholder="Search mail..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto">
          {filteredThreads.map((thread) => {
            const lastMessage = thread.messages[thread.messages.length - 1];
            return (
              <div
                key={thread.id}
                className={cn(
                  'border-b border-neutral-200 p-4 cursor-pointer hover:bg-neutral-50 transition-colors',
                  selectedThread?.id === thread.id && 'bg-blue-50 hover:bg-blue-50',
                  thread.unread && 'bg-blue-50/30'
                )}
                onClick={() => {
                  setSelectedThread(thread);
                  setComposing(false);
                  setReplyingTo(null);
                }}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={(e) => toggleStar(thread.id, e)}
                    className="mt-1 text-neutral-400 hover:text-yellow-500 transition-colors"
                  >
                    <Star
                      className={cn('w-4 h-4', thread.starred && 'fill-yellow-500 text-yellow-500')}
                    />
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{lastMessage.from.name}</span>
                        {thread.unread && <div className="w-2 h-2 rounded-full bg-blue-500"></div>}
                      </div>
                      <span className="text-xs text-neutral-500 whitespace-nowrap">
                        {formatDate(thread.last_message_at)}
                      </span>
                    </div>

                    {/* Subject */}
                    <h3 className="font-medium text-sm mb-1 truncate">{thread.subject}</h3>

                    {/* Preview */}
                    <p className="text-xs text-neutral-600 line-clamp-2 mb-2">
                      {lastMessage.preview}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center gap-2">
                      {lastMessage.has_attachments && (
                        <Paperclip className="w-3 h-3 text-neutral-400" />
                      )}
                      {thread.message_count > 1 && (
                        <span className="text-xs text-neutral-500">
                          {thread.message_count} messages
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredThreads.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <p className="text-neutral-600 mb-1">No messages found</p>
              <p className="text-xs text-neutral-500">Try adjusting your search</p>
            </div>
          )}
        </div>
      </div>

      {/* Message Detail / Compose */}
      <div className="flex-1 bg-neutral-50 flex flex-col">
        {composing ? (
          <ComposeView onClose={() => setComposing(false)} />
        ) : selectedThread ? (
          <ThreadView
            thread={selectedThread}
            onReply={(message) => setReplyingTo(message)}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            formatDate={formatDate}
            formatFileSize={formatFileSize}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Mail className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-600 mb-1">Select a message to read</p>
              <p className="text-xs text-neutral-500">Choose from your {currentView}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadView({
  thread,
  onReply,
  replyingTo,
  onCancelReply,
  formatDate,
  formatFileSize,
}: {
  thread: MailThread;
  onReply: (message: MailMessage) => void;
  replyingTo: MailMessage | null;
  onCancelReply: () => void;
  formatDate: (date: string) => string;
  formatFileSize: (bytes: number) => string;
}) {
  const [replyText, setReplyText] = useState('');

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-neutral-200 p-6">
        <h2 className="text-xl font-semibold mb-2">{thread.subject}</h2>
        <p className="text-sm text-neutral-600">
          {thread.message_count} {thread.message_count === 1 ? 'message' : 'messages'} •{' '}
          {thread.participants.join(', ')}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {thread.messages.map((message, index) => (
          <div key={message.id} className="bg-white border border-neutral-200 rounded-lg p-5">
            {/* Message Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-medium">
                  {message.from.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm">{message.from.name}</span>
                    <span className="text-xs text-neutral-500">{message.from.email}</span>
                  </div>
                  <div className="text-xs text-neutral-600">
                    <span className="font-medium">To:</span>{' '}
                    {message.to.map((t) => t.email).join(', ')}
                  </div>
                  {message.cc && message.cc.length > 0 && (
                    <div className="text-xs text-neutral-600">
                      <span className="font-medium">Cc:</span>{' '}
                      {message.cc.map((c) => c.email).join(', ')}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">
                  {new Date(message.sent_at).toLocaleString()}
                </span>
                <Button variant="ghost" size="sm" onClick={() => onReply(message)}>
                  <Reply className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Message Body */}
            <div className="text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed mb-4">
              {message.body_text}
            </div>

            {/* Attachments */}
            {message.has_attachments && message.attachments && (
              <div className="space-y-2">
                <Separator />
                <div className="pt-2">
                  <p className="text-xs font-medium text-neutral-600 mb-2">Attachments</p>
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-3 p-2 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors cursor-pointer"
                    >
                      <Paperclip className="w-4 h-4 text-neutral-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{attachment.filename}</p>
                        <p className="text-xs text-neutral-500">
                          {formatFileSize(attachment.size)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm">
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Reply Box */}
        {replyingTo && (
          <div className="border border-neutral-200 rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Reply className="w-4 h-4 text-neutral-600" />
                <span className="text-sm font-medium">
                  Replying to {replyingTo.from.name}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={onCancelReply}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <Textarea
              placeholder="Type your reply..."
              className="mb-3 resize-none"
              rows={6}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm">
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm">
                  Macro
                </Button>
              </div>
              <Button size="sm" className="gap-2">
                <Send className="w-4 h-4" />
                Send
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      {!replyingTo && (
        <div className="border-t border-neutral-200 p-4 bg-neutral-50">
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => onReply(thread.messages[thread.messages.length - 1])}>
              <Reply className="w-4 h-4" />
              Reply
            </Button>
            <Button variant="outline" size="sm" className="gap-2">
              <Forward className="w-4 h-4" />
              Forward
            </Button>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ComposeView({ onClose }: { onClose: () => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b border-neutral-200 p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">New Message</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">To</label>
            <Input
              placeholder="recipient@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">Subject</label>
            <Input
              placeholder="Message subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-600 mb-1 block">Message</label>
            <Textarea
              placeholder="Type your message..."
              className="resize-none"
              rows={16}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-neutral-200 p-4 bg-neutral-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              <Paperclip className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm">
              Macro
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="gap-2">
              <Send className="w-4 h-4" />
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
