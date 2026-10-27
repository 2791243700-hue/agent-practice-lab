"use client";

export type ValidationIssue = { id: string; message: string };

export function focusValidationField(id: string) {
  const field = document.getElementById(id);
  if (!field) return;
  const target = field.matches("input, select, textarea, button, a")
    ? field
    : (field.querySelector<HTMLElement>(
        "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      ) ?? field);
  field.scrollIntoView({ block: "center", behavior: "instant" });
  target.focus({ preventScroll: true });
}

export function validationAttributes(id: string, issues: ValidationIssue[]) {
  const issue = issues.find((item) => item.id === id);
  return {
    id,
    "aria-invalid": issue ? true : undefined,
    "aria-describedby": issue ? `${id}-error` : undefined,
  } as const;
}

export function ValidationSummary({
  issues,
  onSelect = focusValidationField,
}: {
  issues: ValidationIssue[];
  onSelect?: (id: string) => void;
}) {
  if (!issues.length) return null;
  return (
    <div className="notice warning validation-summary" role="alert">
      <strong>还需补充 {issues.length} 项，已标出需要核对的位置</strong>
      <ul>
        {issues.map((issue) => (
          <li key={issue.id} id={`${issue.id}-error`}>
            <button
              type="button"
              className="text-button"
              onClick={() => onSelect(issue.id)}
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
