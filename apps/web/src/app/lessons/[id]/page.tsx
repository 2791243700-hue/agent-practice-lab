"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2 } from "lucide-react";
import { api, allPages, pathId } from "@/lib/api";
import type { Attempt, Lesson, Schema } from "@/lib/types";
import {
  ErrorBox,
  Heading,
  Loading,
  Markdown,
  useAction,
} from "@/components/ui";
export default function LessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const query = useSearchParams();
  const version = query.get("version");
  return <LessonContent key={`${id}/${version}`} id={id} version={version} />;
}
function LessonContent({
  id,
  version,
}: {
  id: string;
  version: string | null;
}) {
  const router = useRouter();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [demo, setDemo] = useState(false);
  const action = useAction();
  useEffect(() => {
    void action.act(async () => {
      const [l, a, m] = await Promise.all([
        api<Lesson>(
          `/lessons/${pathId(id)}${version ? `?version=${encodeURIComponent(version)}` : ""}`,
        ),
        allPages<Attempt>(`/attempts?lesson_id=${pathId(id)}`),
        api<Schema["Me"]>("/me"),
      ]);
      setLesson(l);
      setAttempts(a);
      setDemo(m.capabilities.demo_enabled);
    }); /* route-scoped load */
  }, [id, version]);
  function start(mode: "live" | "demo") {
    void action.act(async () => {
      if (!lesson) return;
      const a = await api<Attempt>("/attempts", {
        method: "POST",
        idempotent: true,
        body: {
          lesson_id: lesson.id,
          lesson_version: lesson.version,
          mode,
        } satisfies Schema["AttemptCreate"],
      });
      router.push(`/practice/${pathId(a.id)}`);
    });
  }
  const recent = attempts.find(
    (a) => a.status === "active" && a.lesson_version === lesson?.version,
  );
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        全部课程
      </Link>
      <ErrorBox error={action.error} />
      {!lesson ? (
        !action.error && <Loading />
      ) : (
        <>
          <Heading
            eyebrow={`EXPERIMENT ${String(lesson.order).padStart(2, "0")} / 阅读导读`}
            title={lesson.title}
            description={`课程版本 ${lesson.version} · 无需配置模型即可阅读`}
          />
          <div className="intro-layout">
            <article className="panel intro-content">
              <span className="reading-tag">
                <BookOpen size={16} /> 花一点时间，先认识这件事
              </span>
              <Markdown text={lesson.intro_markdown} />
            </article>
            <aside className="intro-aside">
              <section className="panel">
                <div className="eyebrow">你将完成</div>
                <h2>本关的实践目标</h2>
                <ul className="criteria">
                  {lesson.completion_criteria.map((c) => (
                    <li key={c}>
                      <CheckCircle2 size={17} />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted small">
                  正式完成以实训提交后的后端验收为准。
                </p>
                {recent ? (
                  <Link
                    className="button full"
                    href={`/practice/${pathId(recent.id)}`}
                  >
                    继续{recent.mode === "demo" ? "演示" : ""}实训{" "}
                    <ArrowRight size={16} />
                  </Link>
                ) : (
                  <button
                    className="button full"
                    disabled={action.busy}
                    onClick={() => start("live")}
                  >
                    开始实训 <ArrowRight size={16} />
                  </button>
                )}
                {recent?.mode === "demo" && (
                  <button
                    className="button secondary full"
                    disabled={action.busy}
                    onClick={() => start("live")}
                  >
                    开始正式实训 <ArrowRight size={16} />
                  </button>
                )}
                <p className="small muted">
                  开始不会调用模型。进入后可随时回看导读。
                </p>
                {demo && (
                  <button
                    className="text-button"
                    disabled={action.busy}
                    onClick={() => start("demo")}
                  >
                    先试试无 Key 演示（不计正式通过）
                  </button>
                )}
              </section>
              <div className="intro-tip">
                <strong>还没有 API Key？</strong>
                <p>
                  可以先开始实训、查看任务，再前往模型设置。无需把 Key
                  发给任何人。
                </p>
                <Link href="/settings">查看模型设置 →</Link>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
