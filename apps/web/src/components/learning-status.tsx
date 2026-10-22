import { CheckCircle2, CircleX } from "lucide-react";
import type { Attempt } from "@/lib/types";

export const formatLearningDate = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));

export function CompletionStatus({
  mode,
  completed,
}: {
  mode: Attempt["mode"];
  completed: boolean;
}) {
  const passed = mode === "live" && completed;
  const Icon = passed ? CheckCircle2 : CircleX;
  return (
    <span className={`completion-pill ${passed ? "is-passed" : "is-pending"}`}>
      <Icon size={16} aria-hidden="true" />
      {passed ? "已通关" : "未通关"}
    </span>
  );
}

export function LearningStatus({
  mode,
  completed,
  date,
  dateLabel = "开始日期",
}: {
  mode: Attempt["mode"];
  completed: boolean;
  date: string;
  dateLabel?: string;
}) {
  return (
    <div className="learning-status" aria-label="日期与通关状态">
      <span className="learning-date-label">{dateLabel}</span>
      <time dateTime={date}>{formatLearningDate(date)}</time>
      <CompletionStatus mode={mode} completed={completed} />
    </div>
  );
}
