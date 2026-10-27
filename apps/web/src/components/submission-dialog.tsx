"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, X } from "lucide-react";
import { api, pathId } from "@/lib/api";
import type { Lesson, Schema, Submission } from "@/lib/types";
import { SubmissionFeedback } from "./feedback";

type NextLessonState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; lesson: Schema["LessonSummary"] | null };

export function SubmissionDialog({
  submission,
  lesson,
  onClose,
  profileId,
  onViewEvent,
  returnFocusTo,
}: {
  submission: Submission;
  lesson: Lesson;
  onClose: () => void;
  profileId?: string;
  onViewEvent?: (runId: string, seq: number) => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [next, setNext] = useState<NextLessonState>({ status: "loading" });
  const passed =
    submission.mode === "demo"
      ? submission.evaluation_passed
      : submission.passed;
  const failedRequired = submission.rules.filter(
    (rule) => rule.required && !rule.passed,
  );
  const title =
    submission.model_assessment?.status === "unavailable"
      ? "模型验收未完成"
      : submission.mode === "demo"
        ? submission.evaluation_passed
          ? "演示检查通过 · 不计正式完成"
          : "演示检查未通过 · 不计正式完成"
        : submission.passed
          ? "本关已通关"
          : "本次尚未通过";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = returnFocusTo ?? document.activeElement;
    if (!dialog.open) dialog.showModal();
    stayRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setNext({ status: "loading" });
    void api<Schema["LessonList"]>("/lessons", {
      signal: controller.signal,
    })
      .then(({ items }) => {
        if (controller.signal.aborted) return;
        const currentOrder =
          items.find((item) => item.id === lesson.id)?.order ?? lesson.order;
        const following = [...items]
          .sort((a, b) => a.order - b.order)
          .find((item) => item.id !== lesson.id && item.order > currentOrder);
        setNext({ status: "ready", lesson: following ?? null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setNext({ status: "error" });
      });
    return () => controller.abort();
  }, [lesson.id, lesson.order, retry]);

  const nextHref =
    next.status === "ready" && next.lesson
      ? `/lessons/${pathId(next.lesson.id)}${profileId ? `?profile=${pathId(profileId)}` : ""}`
      : "/";

  return (
    <dialog
      ref={dialogRef}
      className="submission-dialog"
      data-testid="submission-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="submission-dialog-heading">
        <span
          className={`submission-dialog-icon ${passed ? "passed" : "pending"}`}
        >
          {passed ? (
            <CheckCircle2 size={26} aria-hidden="true" />
          ) : (
            <CircleAlert size={26} aria-hidden="true" />
          )}
        </span>
        <div>
          <p className="eyebrow">本次验收结果</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="submission-dialog-close"
          aria-label="关闭验收结果"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="submission-dialog-content">
        <p id={descriptionId} className="muted">
          {passed
            ? "可以继续挑战下一关，也可以留在这里回顾本次实训。"
            : "可以留在当前关卡，按反馈补充后再次提交；也可以先探索下一关。"}
        </p>
        {!passed && failedRequired.length > 0 && (
          <div className="submission-dialog-improvements">
            <h3>还需要补充</h3>
            <ul>
              {failedRequired.map((rule) => (
                <li key={rule.rule_id}>{rule.message}</li>
              ))}
            </ul>
          </div>
        )}
        <details
          className="submission-dialog-details"
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>查看详细验收记录</summary>
          {detailsOpen && (
            <SubmissionFeedback
              submission={submission}
              onViewEvent={onViewEvent}
            />
          )}
        </details>
        <div className="submission-dialog-next" aria-live="polite">
          {next.status === "loading" && (
            <p className="small muted" role="status">
              正在查找下一关…
            </p>
          )}
          {next.status === "error" && (
            <p className="small muted">
              暂时无法读取课程列表。
              <button
                type="button"
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                重试
              </button>
            </p>
          )}
          {next.status === "ready" && (
            <p className="small muted">
              {next.lesson
                ? `下一关：${next.lesson.title}`
                : "已经是最后一关，可以返回课程列表回顾学习进度。"}
            </p>
          )}
        </div>
      </div>
      <div className="submission-dialog-actions">
        <button
          ref={stayRef}
          type="button"
          className="button secondary"
          autoFocus
          onClick={onClose}
        >
          留在当前关卡
        </button>
        {next.status === "ready" ? (
          <Link className="button" href={nextHref}>
            {next.lesson ? "下一关" : "返回课程列表"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className="button" disabled>
            下一关
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </dialog>
  );
}
