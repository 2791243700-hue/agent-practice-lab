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
// Keep unsaved SPA navigation text in tab memory. Restoring never resumes writes.
const pendingDrafts = new Map<string, ReflectionDraftData>();
export function useReflectionDraft(
  attempt: Attempt,
  onRefresh?: () => Promise<void>,
) {
  const [draft, setDraft] = useState(emptyReflectionDraft);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(emptyReflectionDraft));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const writer = useRef<DraftWriter<ReflectionDraftData> | null>(null);
  const attemptRevision = useRef(attempt.revision);
  attemptRevision.current = attempt.revision;
  const endpoint = `/attempts/${pathId(attempt.id)}/reflection-draft`;
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void api<Schema["ReflectionDraft"]>(endpoint)
      .then((value) => {
        if (cancelled) return;
        const serverDraft = value.draft ?? emptyReflectionDraft;
        const restored = pendingDrafts.get(attempt.id) ?? serverDraft;
        setDraft(restored);
        setSaved(JSON.stringify(serverDraft));
        setError(
          JSON.stringify(restored) === JSON.stringify(serverDraft)
            ? ""
            : "已恢复离开前尚未保存的本页填写。自动保存已暂停，请先下载备份，再重新读取服务端草稿。",
        );
        setConflict(false);
        writer.current = new DraftWriter(
          value.revision,
          async (revision, snapshot) => {
            const result = await api<Schema["ReflectionDraft"]>(endpoint, {
              method: "PUT",
              body: {
                expected_revision: revision,
                expected_attempt_revision: attemptRevision.current,
                draft: snapshot,
              } satisfies Schema["PutReflectionDraftRequest"],
            });
            if (!cancelled) setSaved(JSON.stringify(snapshot));
            return result.revision;
          },
        );
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled) setError(`草稿读取失败：${errorText(reason)}`);
      });
    return () => {
      cancelled = true;
      writer.current = null;
    };
  }, [endpoint, retry]);
  const dirty = JSON.stringify(draft) !== saved;
  useLayoutEffect(() => {
    if (!loaded) return;
    if (dirty) pendingDrafts.set(attempt.id, structuredClone(draft));
    else pendingDrafts.delete(attempt.id);
  }, [attempt.id, draft, dirty, loaded]);
  useEffect(() => {
    if (!dirty || error || attempt.status !== "active") return;
    const timer = setTimeout(() => {
      setSaving(true);
      void writer.current
        ?.save(structuredClone(draft))
        .catch((reason) => {
          setConflict(
            reason instanceof ApiError &&
              reason.detail.code === "REVISION_CONFLICT",
          );
          setError(
            `草稿未保存：${errorText(reason)} 当前填写仍保留在本页，请先下载备份。`,
          );
        })
        .finally(() => setSaving(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, dirty, error, attempt.status]);
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
      if (!confirm("复盘草稿尚未保存，离开可能丢失本页修改。确定离开？")) {
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
    dirty,
    saving,
    error,
    conflict,
    reload: async () => {
      try {
        await onRefresh?.();
        pendingDrafts.delete(attempt.id);
        setRetry((value) => value + 1);
      } catch (reason) {
        setError(`重新读取失败：${errorText(reason)} 当前填写仍保留在本页。`);
      }
    },
  };
}
