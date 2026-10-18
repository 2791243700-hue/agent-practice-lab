import type { components } from "../../../../contracts/types";
export type Schema = components["schemas"];
export type Attempt = Schema["Attempt"];
export type Run = Schema["Run"];
export type Profile = Schema["ModelProfile"];
export type Approval = Schema["Approval"];
export type Submission = Schema["Submission"];
// v0.1 generated discriminator names differ from the JSON wire constants.
// Keep every payload from contracts; correct only discriminators at this boundary.
type Tagged<T, K extends string> = Omit<T, "kind"> & { kind: K };
export type AnswerForm =
  | Tagged<Schema["ChoiceForm"], "choice">
  | Tagged<Schema["FactsForm"], "facts">
  | Tagged<Schema["CourseForm"], "course">
  | Tagged<Schema["ArtifactForm"], "artifact">;
export type Lesson = Omit<Schema["LessonDetail"], "answer_form"> & {
  answer_form: AnswerForm;
};
export type ToolCall =
  | (Omit<Schema["ListMaterialsCall"], "name"> & { name: "list_materials" })
  | (Omit<Schema["ReadMaterialCall"], "name"> & { name: "read_material" })
  | (Omit<Schema["LookupCourseCall"], "name"> & { name: "lookup_course" })
  | (Omit<Schema["SaveTodosCall"], "name"> & { name: "save_todos" });
export type Event =
  | Tagged<Schema["RunStartedEvent"], "run.started">
  | Tagged<Schema["MessageDeltaEvent"], "message.delta">
  | Tagged<Schema["MessageCompletedEvent"], "message.completed">
  | (Omit<Schema["ToolRequestedEvent"], "kind" | "payload"> & {
      kind: "tool.requested";
      payload: { call: ToolCall };
    })
  | Tagged<Schema["ApprovalRequestedEvent"], "approval.requested">
  | Tagged<Schema["ApprovalDecidedEvent"], "approval.decided">
  | Tagged<Schema["ToolCompletedEvent"], "tool.completed">
  | Tagged<Schema["RunCompletedEvent"], "run.completed">
  | Tagged<Schema["RunFailedEvent"], "run.failed">
  | Tagged<Schema["RunCancelledEvent"], "run.cancelled">
  | Tagged<Schema["RunInterruptedEvent"], "run.interrupted">;
export type EventPage = Omit<Schema["EventPage"], "items"> & { items: Event[] };
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
