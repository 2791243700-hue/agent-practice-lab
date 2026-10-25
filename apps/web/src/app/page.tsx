"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  FileText,
  KeyRound,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { api, allPages, pathId } from "@/lib/api";
import type { Attempt, Schema } from "@/lib/types";
import { ErrorBox, Heading, Loading } from "@/components/ui";
const descriptions = [
  "把模糊的想法，变成清楚的任务。练习说出目标、约束和你想要的结果。",
  "为回答提供依据。选择资料，观察读取过程，再回到原文核对信息。",
  "从“它说查到了”到“我看到了”。观察一次真实查询，理解工具如何帮助 Agent。",
  "由你决定是否执行。练习拒绝与批准，并亲自检查生成的待办清单。",
];
const icons = [MessageSquareText, FileText, Wrench, ShieldCheck];
export default function Home() {
  const [lessons, setLessons] = useState<Schema["LessonSummary"][] | null>(
    null,
  );
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [hasConfiguredKey, setHasConfiguredKey] = useState<boolean | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  async function load() {
    setError(null);
    try {
      const [list, history] = await Promise.all([
        api<Schema["LessonList"]>("/lessons"),
        allPages<Attempt>("/attempts"),
      ]);
      setLessons(list.items.sort((a, b) => a.order - b.order));
      setAttempts(history);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    let active = true;
    let latestRequest = 0;
    async function refreshKeyStatus() {
      const request = ++latestRequest;
      try {
        const profiles = await api<Schema["ProfileList"]>("/model-profiles");
        if (active && request === latestRequest) {
          setHasConfiguredKey(
            profiles.items.some((p) => p.credential_status === "configured"),
          );
        }
      } catch {
        // Keep course browsing available if the credential status is unavailable.
      }
    }
    function refreshOnReturn() {
      if (document.visibilityState === "visible") void refreshKeyStatus();
    }
    void refreshKeyStatus();
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);
  const completed = lessons?.filter((l) => l.completed).length ?? 0;
  return (
    <>
      <Heading
        eyebrow="LEARN BY DOING"
        title="第一次使用 Agent，从这里开始。"
        description="不用写代码，也不用先懂所有术语。四个小实验，带你从说清任务到检查成果。"
      />
      <section className="hero">
        <div className="hero-content">
          <span className="hero-tag">
            <Sparkles size={14} /> 零基础 · 亲手实践
          </span>
          <h2>
            让 AI 助手行动，
            <br />
            让每一步都有依据。
          </h2>
          <p>
            读懂一个概念，完成一次操作。
            <br />
            在看得见的过程里，建立自己的判断。
          </p>
          <Link className="button light" href="/lessons/01-task">
            从第一关开始 <ArrowRight size={17} />
          </Link>
          <span className="hero-foot">无需 Key 即可阅读全部导读</span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="art-core">
            <Compass size={65} strokeWidth={1.2} />
          </div>
          <span className="art-chip chip-one">
            <MessageSquareText size={17} /> 说明目标
          </span>
          <span className="art-chip chip-two">
            <Wrench size={17} /> 观察过程
          </span>
          <span className="art-chip chip-three">
            <CheckCircle2 size={17} /> 核对成果
          </span>
          <span className="art-cross cross-one">+</span>
          <span className="art-cross cross-two">+</span>
        </div>
      </section>
      <div className="journey-strip">
        <div>
          <span className="tiny-icon">
            <Compass size={19} />
          </span>
          <span>
            <strong>你的入门路径</strong>
            <small>按顺序学习，也可以随时回看</small>
          </span>
        </div>
        <div className="progress-summary">
          <span>
            {completed}
            <em> / 4 关正式完成</em>
          </span>
          <div className="progress-track">
            <i style={{ width: `${completed * 25}%` }} />
          </div>
        </div>
      </div>
      <ErrorBox error={error} retry={load} />
      {!lessons && !error ? (
        <Loading />
      ) : (
        <>
          <div className="section-title">
            <h2>
              四个实验，逐步上手 <span>THE LEARNING PATH</span>
            </h2>
            <span>阅读 → 实践 → 反馈</span>
          </div>
          <div className="lesson-grid">
            {lessons?.map((lesson, index) => {
              const Icon = icons[index] ?? Compass;
              const recent = attempts.find(
                (a) =>
                  a.lesson_id === lesson.id &&
                  a.lesson_version === lesson.version &&
                  a.status === "active",
              );
              return (
                <article
                  className={`lesson-card tone-${index}`}
                  key={lesson.id}
                >
                  <div className="card-top">
                    <span className="lesson-icon">
                      <Icon size={25} />
                    </span>
                    <span
                      className={`badge ${lesson.completed ? "success" : "subtle"}`}
                    >
                      {lesson.completed ? (
                        <>
                          <Check size={12} /> 已正式通过
                        </>
                      ) : recent ? (
                        recent.mode === "demo" ? (
                          "演示进行中"
                        ) : (
                          "学习中"
                        )
                      ) : (
                        "等待探索"
                      )}
                    </span>
                  </div>
                  <div className="lesson-number">
                    EXPERIMENT {String(lesson.order).padStart(2, "0")}
                  </div>
                  <h3>{lesson.title}</h3>
                  <p>{descriptions[index] ?? lesson.description}</p>
                  <div className="card-bottom">
                    <span>
                      {
                        [
                          "任务与提示词",
                          "上下文与来源",
                          "工具输入与结果",
                          "授权与产物",
                        ][index]
                      }
                    </span>
                    <Link
                      href={
                        recent
                          ? `/practice/${pathId(recent.id)}`
                          : `/lessons/${pathId(lesson.id)}`
                      }
                    >
                      {recent ? "继续实训" : "阅读导读"}
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {hasConfiguredKey === false && (
        <section className="prepare-card">
          <span className="prepare-icon">
            <KeyRound size={23} />
          </span>
          <div>
            <h3>准备好你的第一把“钥匙”</h3>
            <p>
              实训需要你自己的模型 API
              Key。先阅读导读，再跟着设置页完成连接检查。
            </p>
          </div>
          <Link className="button secondary" href="/settings">
            配置模型 <ArrowRight size={16} />
          </Link>
        </section>
      )}
      <div className="quiet-note">
        <ShieldCheck size={15} /> Key
        仅保存在本地后端内存；演示练习与正式学习分别记录。
      </div>
    </>
  );
}
