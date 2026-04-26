import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";

export const NO_MATCH_VALUE = "__no_match__";

export type StatementTrackMatchDialogTask = {
  id: string;
  trackTitle: string;
  artistName: string;
  isrc: string | null;
  candidates: Array<{
    trackKey: string;
    trackTitle: string;
    artistName: string;
    isrc: string | null;
  }>;
};

type StatementTrackMatchDialogProps = {
  open: boolean;
  pending: boolean;
  unansweredCount: number;
  tasks: StatementTrackMatchDialogTask[];
  selections: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onSelect: (taskId: string, value: string) => void;
  onSubmit: () => void;
};

export function StatementTrackMatchDialog({
  open,
  pending,
  unansweredCount,
  tasks,
  selections,
  onOpenChange,
  onSelect,
  onSubmit,
}: StatementTrackMatchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(92vw,980px)] gap-0 overflow-hidden border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.98)] p-0">
        <DialogHeader className="border-b border-[hsl(var(--border)/0.1)] px-6 pb-5 pt-6">
          <DialogTitle className="text-xl">Match similar tracks</DialogTitle>
          <DialogDescription className="max-w-3xl pt-1 leading-6">
            Review every uploaded track that looks close to something already in your workspace. Choose one candidate or mark No match to continue processing.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 px-6 py-5">
            {tasks.map((task, index) => (
              <section
                key={task.id}
                className="surface-elevated forensic-frame rounded-[calc(var(--radius)-2px)] p-4"
              >
                <div className="flex flex-col gap-3 border-b border-[hsl(var(--border)/0.08)] pb-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
                      Track {index + 1}
                    </p>
                    <p className="text-base font-semibold text-foreground">{task.trackTitle}</p>
                    <p className="text-sm text-muted-foreground">{task.artistName}</p>
                    {task.isrc ? (
                      <p className="font-mono text-xs text-muted-foreground">ISRC {task.isrc}</p>
                    ) : null}
                  </div>

                  <span className="inline-flex w-fit items-center rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.82)] px-2.5 py-1 text-xs text-muted-foreground">
                    {task.candidates.length} possible match{task.candidates.length === 1 ? "" : "es"}
                  </span>
                </div>

                <RadioGroup
                  className="mt-4 gap-3"
                  value={selections[task.id] ?? ""}
                  onValueChange={(value) => onSelect(task.id, value)}
                >
                  {task.candidates.map((candidate) => {
                    const radioId = `track-match-${task.id}-${candidate.trackKey}`;
                    return (
                      <label
                        key={candidate.trackKey}
                        htmlFor={radioId}
                        className="flex cursor-pointer items-start gap-3 rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.74)] px-3 py-3"
                      >
                        <RadioGroupItem id={radioId} value={candidate.trackKey} className="mt-1" />
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-foreground">{candidate.trackTitle}</p>
                          <p className="text-sm text-muted-foreground">{candidate.artistName}</p>
                          {candidate.isrc ? (
                            <p className="font-mono text-xs text-muted-foreground">ISRC {candidate.isrc}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">No ISRC on record</p>
                          )}
                        </div>
                      </label>
                    );
                  })}

                  <label
                    htmlFor={`track-match-${task.id}-${NO_MATCH_VALUE}`}
                    className="flex cursor-pointer items-start gap-3 rounded-[calc(var(--radius-sm))] border border-dashed border-[hsl(var(--border)/0.14)] bg-[hsl(var(--surface-panel)/0.58)] px-3 py-3"
                  >
                    <RadioGroupItem
                      id={`track-match-${task.id}-${NO_MATCH_VALUE}`}
                      value={NO_MATCH_VALUE}
                      className="mt-1"
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">No match</p>
                      <p className="text-sm text-muted-foreground">
                        Keep the uploaded track as-is and continue with final processing.
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </section>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-[hsl(var(--border)/0.1)] px-6 py-4">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {unansweredCount > 0
                ? `${unansweredCount} track${unansweredCount === 1 ? "" : "s"} still need a decision.`
                : "All track decisions are ready to submit."}
            </p>
            <Button type="button" onClick={onSubmit} disabled={pending || unansweredCount > 0}>
              Continue processing
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
