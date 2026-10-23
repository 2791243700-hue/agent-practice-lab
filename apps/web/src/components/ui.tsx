"use client";
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  FlaskConical,
  History,
  Settings2,
  Sprout,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { errorText } from "@/lib/api";

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const practicePage = path.startsWith("/practice/");
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        跳到正文
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <FlaskConical size={23} />
          </span>
          <span>
            Agent Practice<span className="brand-sub">LAB / 入门实训室</span>
          </span>
        </Link>
        <div className="nav-caption">你的学习空间</div>
        <nav aria-label="主导航">
          {[
            {
              href: "/",
              icon: BookOpen,
              label: "探索课程",
              active:
                path === "/" ||
                path.startsWith("/lessons") ||
                path.startsWith("/practice"),
            },
            {
              href: "/records",
              icon: History,
              label: "学习记录",
              active: path === "/records",
            },
            {
              href: "/settings",
              icon: Settings2,
              label: "模型设置",
              active: path === "/settings",
            },
          ].map(({ href, icon: Icon, label, active }) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`nav-item ${active ? "active" : ""}`}
            >
              <Icon size={19} />
              {label}
              {active && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <Sprout size={25} />
          <strong>从第一次尝试开始</strong>
          <p>不需要编程基础。读一小段，动手做一遍，慢慢理解 Agent。</p>
          <Link href="/help">
            新手使用指南 <ArrowUpRight size={14} />
          </Link>
        </div>
      </aside>
      <div className="app-body">
        {!practicePage && (
          <header className="topbar">
            <span className="topbar-label">学习 / 实践 / 理解</span>
            <div>
              <Link href="/help" aria-label="使用帮助">
                <CircleHelp size={19} aria-hidden="true" />
                <span>帮助</span>
              </Link>
            </div>
          </header>
        )}
        <main id="main" className={practicePage ? "practice-page" : undefined}>
          {children}
        </main>
        <footer className="footer">
          Agent Practice Lab <span>每一步操作，都值得理解。</span>
        </footer>
      </div>
    </div>
  );
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div
              className="table-scroll"
              role="region"
              aria-label="表格（可横向滚动）"
              tabIndex={0}
            >
              <table>{children}</table>
            </div>
          ),
          img: () => null,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return error ? (
    <div className="notice error" role="alert">
      {errorText(error)}
      {retry && (
        <button className="text-button" onClick={retry}>
          重新加载
        </button>
      )}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      正在读取学习空间…
    </div>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<unknown>(null);
  async function act(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, act, setError };
}
export const dateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
