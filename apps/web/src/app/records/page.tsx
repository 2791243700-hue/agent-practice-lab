"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { allPages, api, pathId } from "@/lib/api";
import type { Attempt, Schema } from "@/lib/types";
import { LearningStatus } from "@/components/learning-status";
import { ErrorBox, Heading, Loading, useAction } from "@/components/ui";
export default function Records() {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const action = useAction();
  function load() {
    void action.act(async () => {
      const [a, l] = await Promise.all([
        allPages<Attempt>("/attempts"),
        api<Schema["LessonList"]>("/lessons"),
      ]);
      setAttempts(a);
      setTitles(Object.fromEntries(l.items.map((i) => [i.id, i.title])));
    });
  }
  useEffect(load, []);
  return (
    <>
      <Heading
        eyebrow="YOUR JOURNEY"
        title="每一次尝试，都留下了足迹。"
        description="继续实训、回看历史提交，或导出一份属于自己的学习记录。"
      />
      <ErrorBox error={action.error} retry={load} />
      {!attempts ? (
        <Loading />
      ) : !attempts.length ? (
        <div className="panel empty">
          <h2>第一段学习记录，等你开启</h2>
          <p>开始一关实训后，进度和提交记录会出现在这里。</p>
          <Link className="button" href="/">
            去探索课程 <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <div className="panel records-list">
          {attempts.map((a) => (
            <article key={a.id}>
              <div>
                <span
                  className={`badge ${a.mode === "demo" ? "demo" : "subtle"}`}
                >
                  {a.mode === "demo" ? "演示练习" : "正式实训"}
                </span>
                <h2>{titles[a.lesson_id] ?? a.lesson_id}</h2>
              </div>
              <Link
                className="button secondary"
                href={`/practice/${pathId(a.id)}`}
              >
                {a.status === "superseded" ? "回看记录" : "继续实训"}
                <ArrowRight size={15} />
              </Link>
              <LearningStatus
                mode={a.mode}
                completed={a.progress === "completed"}
                date={a.created_at}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
