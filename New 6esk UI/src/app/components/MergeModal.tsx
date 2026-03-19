import { useState } from 'react';
import { Search, AlertTriangle, X, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { cn } from './ui/utils';

type MergeType = 'ticket' | 'customer';

interface MergeCandidate {
  id: string;
  type: 'ticket' | 'customer';
  display: string;
  email?: string;
  phone?: string;
  metadata: string;
}

interface PreflightData {
  source: MergeCandidate;
  target: MergeCandidate;
  impacts: {
    label: string;
    count: number;
  }[];
  conflicts: string[];
  warnings: string[];
}

export function MergeModal({
  open,
  onClose,
  type,
}: {
  open: boolean;
  onClose: () => void;
  type: MergeType;
}) {
  const [step, setStep] = useState<'search' | 'select' | 'preflight' | 'success' | 'error'>(
    'search'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<MergeCandidate | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<MergeCandidate | null>(null);
  const [preflightData, setPreflightData] = useState<PreflightData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Mock search results
  const mockTicketCandidates: MergeCandidate[] = [
    {
      id: 'TKT-1847',
      type: 'ticket',
      display: 'TKT-1847',
      email: 'john.davidson@techcorp.com',
      metadata: 'Unable to access dashboard after latest update',
    },
    {
      id: 'TKT-1850',
      type: 'ticket',
      display: 'TKT-1850',
      email: 'john.davidson@techcorp.com',
      metadata: 'Dashboard login error - duplicate report',
    },
  ];

  const mockCustomerCandidates: MergeCandidate[] = [
    {
      id: 'cust-1',
      type: 'customer',
      display: 'John Davidson',
      email: 'john.davidson@techcorp.com',
      phone: '+1234567890',
      metadata: '3 tickets, registered user',
    },
    {
      id: 'cust-2',
      type: 'customer',
      display: 'John D.',
      email: 'j.davidson@techcorp.com',
      phone: '+1234567890',
      metadata: '1 ticket, unregistered',
    },
  ];

  const candidates = type === 'ticket' ? mockTicketCandidates : mockCustomerCandidates;
  const filteredCandidates = candidates.filter(
    (c) =>
      searchQuery === '' ||
      c.display.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.metadata.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setStep('select');
    }
  };

  const handleSelectSource = (candidate: MergeCandidate) => {
    setSelectedSource(candidate);
  };

  const handleSelectTarget = (candidate: MergeCandidate) => {
    setSelectedTarget(candidate);
  };

  const handleRunPreflight = () => {
    if (!selectedSource || !selectedTarget) return;

    // Mock preflight data
    const preflight: PreflightData = {
      source: selectedSource,
      target: selectedTarget,
      impacts:
        type === 'ticket'
          ? [
              { label: 'Messages', count: 4 },
              { label: 'Email replies', count: 2 },
              { label: 'WhatsApp messages', count: 2 },
              { label: 'Events', count: 6 },
              { label: 'Tags', count: 3 },
            ]
          : [
              { label: 'Tickets to re-link', count: 4 },
              { label: 'Active tickets', count: 1 },
              { label: 'Identities to move', count: 2 },
              { label: 'Email addresses', count: 2 },
            ],
      conflicts:
        type === 'customer'
          ? ['Both records have different phone numbers', 'Email domains differ (techcorp.com vs techcorp.io)']
          : [],
      warnings: ['This action is irreversible', 'All data from source will be moved to target'],
    };

    setPreflightData(preflight);
    setStep('preflight');
  };

  const handleConfirmMerge = () => {
    // Simulate merge operation
    setTimeout(() => {
      // Random success/failure for demo
      const success = Math.random() > 0.2;
      if (success) {
        setStep('success');
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        setErrorMessage(
          'Merge failed: Database constraint violation. Please contact support if this persists.'
        );
        setStep('error');
      }
    }, 1000);
  };

  const handleClose = () => {
    setStep('search');
    setSearchQuery('');
    setSelectedSource(null);
    setSelectedTarget(null);
    setPreflightData(null);
    setErrorMessage('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {step === 'search' && (
          <>
            <DialogHeader>
              <DialogTitle>
                Merge {type === 'ticket' ? 'Tickets' : 'Customers'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Search for {type === 'ticket' ? 'tickets' : 'customers'} to merge
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                    <Input
                      placeholder={
                        type === 'ticket'
                          ? 'Ticket ID, email, subject...'
                          : 'Email, phone, name...'
                      }
                      className="pl-9"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    />
                  </div>
                  <Button onClick={handleSearch}>Search</Button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  <strong>Tip:</strong> Search by email, phone, ticket number, or subject to find
                  duplicates quickly.
                </p>
              </div>
            </div>
          </>
        )}

        {step === 'select' && (
          <>
            <DialogHeader>
              <DialogTitle>Select {type === 'ticket' ? 'Tickets' : 'Customers'} to Merge</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Source (will be merged into target)
                </label>
                <div className="space-y-2">
                  {filteredCandidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className={cn(
                        'border rounded-lg p-3 cursor-pointer transition-colors',
                        selectedSource?.id === candidate.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-neutral-200 hover:border-neutral-300'
                      )}
                      onClick={() => handleSelectSource(candidate)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{candidate.display}</p>
                          {candidate.email && (
                            <p className="text-xs text-neutral-600">{candidate.email}</p>
                          )}
                          {candidate.phone && (
                            <p className="text-xs text-neutral-600">{candidate.phone}</p>
                          )}
                          <p className="text-xs text-neutral-500 mt-1">{candidate.metadata}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedSource && (
                <>
                  <Separator />
                  <div>
                    <label className="text-sm font-medium mb-2 block">
                      Target (will receive all data)
                    </label>
                    <div className="space-y-2">
                      {filteredCandidates
                        .filter((c) => c.id !== selectedSource.id)
                        .map((candidate) => (
                          <div
                            key={candidate.id}
                            className={cn(
                              'border rounded-lg p-3 cursor-pointer transition-colors',
                              selectedTarget?.id === candidate.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-neutral-200 hover:border-neutral-300'
                            )}
                            onClick={() => handleSelectTarget(candidate)}
                          >
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="font-medium text-sm">{candidate.display}</p>
                                {candidate.email && (
                                  <p className="text-xs text-neutral-600">{candidate.email}</p>
                                )}
                                {candidate.phone && (
                                  <p className="text-xs text-neutral-600">{candidate.phone}</p>
                                )}
                                <p className="text-xs text-neutral-500 mt-1">{candidate.metadata}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep('search')}>
                Back
              </Button>
              <Button onClick={handleRunPreflight} disabled={!selectedSource || !selectedTarget}>
                Continue to Preflight
              </Button>
            </div>
          </>
        )}

        {step === 'preflight' && preflightData && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Merge</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto space-y-4">
              {/* Merge Direction */}
              <div className="flex items-center justify-center gap-4 p-4 bg-neutral-50 rounded-lg">
                <div className="text-center">
                  <p className="text-xs text-neutral-600 mb-1">Source</p>
                  <p className="font-medium">{preflightData.source.display}</p>
                  <p className="text-xs text-neutral-500">{preflightData.source.email}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-neutral-400" />
                <div className="text-center">
                  <p className="text-xs text-neutral-600 mb-1">Target</p>
                  <p className="font-medium">{preflightData.target.display}</p>
                  <p className="text-xs text-neutral-500">{preflightData.target.email}</p>
                </div>
              </div>

              {/* Impact Summary */}
              <div>
                <h4 className="text-sm font-medium mb-2">Data to be moved</h4>
                <div className="grid grid-cols-2 gap-2">
                  {preflightData.impacts.map((impact, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-neutral-50 rounded">
                      <span className="text-sm text-neutral-700">{impact.label}</span>
                      <Badge variant="secondary">{impact.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Conflicts */}
              {preflightData.conflicts.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <div className="flex gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5" />
                    <h4 className="text-sm font-medium text-orange-900">Conflicts Detected</h4>
                  </div>
                  <ul className="space-y-1">
                    {preflightData.conflicts.map((conflict, i) => (
                      <li key={i} className="text-sm text-orange-800">
                        • {conflict}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5" />
                  <h4 className="text-sm font-medium text-red-900">Important Warnings</h4>
                </div>
                <ul className="space-y-1">
                  {preflightData.warnings.map((warning, i) => (
                    <li key={i} className="text-sm text-red-800">
                      • {warning}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t">
              <Button variant="outline" onClick={() => setStep('select')}>
                Back
              </Button>
              <Button variant="destructive" onClick={handleConfirmMerge}>
                Confirm Merge
              </Button>
            </div>
          </>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">Merge Successful</h3>
            <p className="text-sm text-neutral-600">
              {type === 'ticket' ? 'Tickets' : 'Customers'} have been merged successfully.
            </p>
          </div>
        )}

        {step === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle>Merge Failed</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
              <p className="text-sm text-neutral-600 text-center mb-4">{errorMessage}</p>
            </div>
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleClose}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
