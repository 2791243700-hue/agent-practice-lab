import type { components } from "../../../../contracts/types";
export type Schema = components["schemas"];
export type Attempt = Schema["Attempt"];
export type Run = Schema["Run"];
export type Profile = Schema["ModelProfile"];
export type Approval = Schema["Approval"];
export type Submission = Schema["Submission"];
export type AnswerForm = Schema["AnswerForm"];
export type Lesson = Schema["LessonDetail"];
export type ToolCall = Schema["ToolCall"];
export type Event = Schema["StoredEvent"];
export type EventPage = Schema["EventPage"];
export const terminal = (status: Run["status"]) =>
  ["completed", "failed", "cancelled", "interrupted"].includes(status);
export const runLabels: Record<Run["status"], string> = {
  queued: "准备中",
  running: "正在执行",
  awaiting_approval: "等待你的批准",
  completed: "本轮已完成",
  failed: "本轮失败",
  cancelled: "已停止",
  interrupted: "因服务重启中断",
};
export const toolLabels = {
  list_materials: "查看可用材料",
  read_material: "读取课程材料",
  lookup_course: "查询课程安排",
  save_todos: "保存待办清单",
};
