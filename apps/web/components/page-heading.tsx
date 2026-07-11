import type { ReactNode } from "react";

export function PageHeading({
  actions,
  eyebrow,
  lead,
  title,
}: {
  actions?: ReactNode;
  eyebrow: string;
  lead: string;
  title: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="page-heading__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-heading__lead">{lead}</p>
      </div>
      {actions ? <div className="page-heading__actions">{actions}</div> : null}
    </header>
  );
}
