import { CheckCircle2, CircleX } from "lucide-react";
import type { Attempt } from "@/lib/types";

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
  const passed = mode === "live" && completed;
  const Icon = passed ? CheckCircle2 : CircleX;
  const formattedDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
  return (
    <div className="learning-status" aria-label="日期与通关状态">
      <span className="learning-date-label">{dateLabel}</span>
      <time dateTime={date}>{formattedDate}</time>
      <span
        className={`completion-pill ${passed ? "is-passed" : "is-pending"}`}
      >
        <Icon size={16} aria-hidden="true" />
        {passed ? "已通关" : "未通关"}
      </span>
    </div>
  );
}
