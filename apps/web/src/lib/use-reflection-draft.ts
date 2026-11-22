"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, errorText, pathId } from "./api";
import { DraftWriter } from "./reflection";
import type { Attempt, Schema } from "./types";
export type ReflectionDraftData = Schema["ReflectionDraftData"];
export const emptyReflectionDraft: ReflectionDraftData = {
  step: 0,
  beforeStartOffset: 0,
  afterStartOffset: 0,
  beforeEventSeq: 0,
  afterEventSeq: 0,
  beforeId: "",
  afterId: "",
  beforeMessageId: "",
  afterMessageId: "",
  changeKind: "",
  requirement: "",
  beforeQuote: "",
  afterQuote: "",
  judgment: "",
  explanation: "",
  nextInstruction: "",
  facts: {},
  instruction: "",
};
type Snapshot = Schema["AttemptDraftData"];
type PracticeDraft = Exclude<Snapshot, ReflectionDraftData>;
const emptyPracticeDrafts: Record<PracticeDraft["kind"], PracticeDraft> = {
  facts: { kind: "facts", facts: {}, learning_reflection: "" },
  course: {
    kind: "course",
    session_date: "",
    room: "",
    learning_reflection: "",
  },
  artifact: { kind: "artifact", learning_reflection: "" },
};

// Preserve unsaved SPA edits per attempt. Only an explicit reload discards them.
const pendingDrafts = new Map<string, Snapshot>();
function matchesForm<T extends Snapshot>(
  draft: Snapshot,
  initial: T,
): draft is T {
  return "kind" in initial
    ? "kind" in draft && initial.kind === draft.kind
    : !("kind" in draft) && "step" in draft;
}

export function usePracticeDraft(
  attempt: Attempt,
  form: Schema["AnswerForm"]["kind"],
  onRefresh?: () => Promise<void>,
) {
  const enabled = form === "facts" || form === "course" || form === "artifact";
  const initial = enabled
    ? emptyPracticeDrafts[form]
    : emptyPracticeDrafts.artifact;
  return useAttemptDraft(attempt, initial, enabled, onRefresh);
}

export function useReflectionDraft(
  attempt: Attempt,
  onRefresh?: () => Promise<void>,
) {
  return useAttemptDraft(attempt, emptyReflectionDraft, true, onRefresh);
}

function useAttemptDraft<T extends Snapshot>(
  attempt: Attempt,
  initial: T,
  enabled: boolean,
  onRefresh?: () => Promise<void>,
) {
  const [draft, setDraft] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const writer = useRef<DraftWriter<T> | null>(null);
  const attemptRevision = useRef(attempt.revision);
  attemptRevision.current = attempt.revision;
  const endpoint = `/attempts/${pathId(attempt.id)}/reflection-draft`;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const local = pendingDrafts.get(attempt.id);
    const editable = attempt.status === "active";
    setLoaded(false);
    setSaving(false);
    setConflict(false);
    setError("");
    if (editable && local && matchesForm(local, initial)) setDraft(local);
    void api<Schema["ReflectionDraft"]>(endpoint)
      .then((value) => {
        if (cancelled) return;
        if (
          value.attempt_id !== attempt.id ||
          (value.draft !== null && !matchesForm(value.draft, initial))
        ) {
          throw new Error("draft-form-mismatch");
        }
        const serverDraft = value.draft ?? initial;
        const restored =
          !retry && editable && local && matchesForm(local, initial)
            ? local
            : serverDraft;
        setDraft(restored);
        setSaved(JSON.stringify(serverDraft));
        setHasSaved(value.revision > 0);
        setError(
          JSON.stringify(restored) === JSON.stringify(serverDraft)
            ? ""
            : "已恢复离开前尚未保存的本页填写。自动保存已暂停，请先下载备份，再重新读取服务端草稿。",
        );
        if (editable)
          writer.current = new DraftWriter(
            value.revision,
            async (revision, snapshot) => {
              if (cancelled) return revision;
              const result = await api<Schema["ReflectionDraft"]>(endpoint, {
                method: "PUT",
                body: {
                  expected_revision: revision,
                  expected_attempt_revision: attemptRevision.current,
                  draft: snapshot,
                } satisfies Schema["PutReflectionDraftRequest"],
              });
              if (!cancelled) {
                setHasSaved(true);
                setSaved(JSON.stringify(snapshot));
              }
              return result.revision;
            },
          );
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error && reason.message === "draft-form-mismatch"
              ? "服务端草稿与本次实训不匹配，已暂停填写。"
              : `草稿读取失败：${errorText(reason)}`,
          );
      });
    return () => {
      cancelled = true;
      writer.current = null;
    };
  }, [attempt.id, attempt.status, enabled, endpoint, initial, retry]);
  const dirty = enabled && JSON.stringify(draft) !== saved;
  useLayoutEffect(() => {
    if (!loaded || !enabled || attempt.status !== "active") return;
    if (dirty) pendingDrafts.set(attempt.id, structuredClone(draft));
    else pendingDrafts.delete(attempt.id);
  }, [attempt.id, attempt.status, draft, dirty, loaded, enabled]);
  useEffect(() => {
    const currentWriter = writer.current;
    if (
      !loaded ||
      !dirty ||
      error ||
      !currentWriter ||
      attempt.status !== "active"
    )
      return;
    const timer = setTimeout(() => {
      setSaving(true);
      void currentWriter
        .save(structuredClone(draft))
        .catch((reason) => {
          if (writer.current !== currentWriter) return;
          setConflict(
            reason instanceof ApiError &&
              reason.detail.code === "REVISION_CONFLICT",
          );
          setError(
            `草稿未保存：${errorText(reason)} 当前填写仍保留在本页，请先下载备份。`,
          );
        })
        .finally(() => {
          if (writer.current === currentWriter) setSaving(false);
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [loaded, draft, dirty, error, attempt.status]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const element = event.target as Element;
      const link = element.closest?.("a[href]");
      if (!link && !element.closest?.("[data-discard-unsaved-reflection]"))
        return;
      if (link) {
        const target = new URL(link.getAttribute("href")!, location.href);
        if (
          link.hasAttribute("download") ||
          target.protocol === "blob:" ||
          (target.origin === location.origin &&
            target.pathname.startsWith("/api/v1/") &&
            target.pathname.endsWith("/download"))
        )
          return;
        if (
          target.pathname === location.pathname &&
          target.search === location.search
        )
          return;
      }
      if (!confirm("作答草稿尚未保存，离开可能丢失本页修改。确定离开？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  return {
    draft,
    setDraft,
    loaded,
    hasSaved,
    dirty,
    saving,
    error,
    conflict,
    reload: async () => {
      try {
        await onRefresh?.();
        setRetry((value) => value + 1);
      } catch (reason) {
        setError(`重新读取失败：${errorText(reason)} 当前填写仍保留在本页。`);
      }
    },
  };
}
