import type { Attempt, Event, Run } from "./types";

export function briefCandidates(
  attempt: Attempt,
  runs: Run[],
  events: Record<string, Event[]>,
): Run[] {
  return runs
    .filter(
      (run) =>
        run.attempt_id === attempt.id &&
        run.mode === attempt.mode &&
        run.status === "completed" &&
        (events[run.id] ?? []).some(
          (event) =>
            event.kind === "message.completed" &&
            event.payload.role === "assistant" &&
            !!event.payload.content.trim(),
        ),
    )
    .sort((a, b) =>
      a.creation_index !== undefined && b.creation_index !== undefined
        ? a.creation_index - b.creation_index
        : a.created_at.localeCompare(b.created_at),
    );
}

export function initialBriefPair(
  draft: { beforeId: string; afterId: string },
  candidates: Run[],
) {
  if (draft.beforeId || draft.afterId || candidates.length < 2) return null;
  return {
    beforeId: candidates[candidates.length - 2].id,
    afterId: candidates[candidates.length - 1].id,
  };
}
