import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ScrollArea } from "./ui/scroll-area";
import type { SupportMacro } from "@/app/lib/api/support";

type MacroPickerModalProps = {
  open: boolean;
  onClose: () => void;
  macros: SupportMacro[];
  query: string;
  onQueryChange: (value: string) => void;
  onInsert: (macro: SupportMacro) => void;
};

export function MacroPickerModal({
  open,
  onClose,
  macros,
  query,
  onQueryChange,
  onInsert
}: MacroPickerModalProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredMacros = normalizedQuery
    ? macros.filter((macro) =>
        `${macro.title} ${macro.body} ${macro.category ?? ""}`.toLowerCase().includes(normalizedQuery)
      )
    : macros;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insert Macro</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search macros..."
              className="pl-9"
            />
          </div>

          <ScrollArea className="h-[420px] pr-4">
            <div className="space-y-3">
              {filteredMacros.map((macro) => (
                <div key={macro.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{macro.title}</p>
                      {macro.category ? (
                        <Badge variant="outline" className="mt-2 text-[11px]">
                          {macro.category}
                        </Badge>
                      ) : null}
                    </div>
                    <Button size="sm" onClick={() => onInsert(macro)}>
                      Insert
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">
                    {macro.body}
                  </p>
                </div>
              ))}

              {filteredMacros.length === 0 ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 text-center">
                  <div>
                    <p className="text-sm font-medium text-neutral-900">No macros found</p>
                    <p className="mt-1 text-xs text-neutral-500">Try a different keyword.</p>
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
