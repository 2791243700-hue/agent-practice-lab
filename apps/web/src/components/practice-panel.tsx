"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function PracticePanel({
  id,
  title,
  eyebrow,
  className,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  eyebrow: string;
  className: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`panel practice-collapsible ${className}`}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
    >
      <div className="eyebrow" hidden={!open}>
        {eyebrow}
      </div>
      <h2 className="practice-panel-heading" id={`${id}-title`}>
        <button
          className="practice-panel-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-content`}
          onClick={onToggle}
        >
          <span>{title}</span>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </h2>
      <div
        className="practice-panel-content"
        id={`${id}-content`}
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}
