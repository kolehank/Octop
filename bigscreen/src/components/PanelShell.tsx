import type { ReactNode } from "react";
import styles from "@/styles/board.module.css";

/** Titled card wrapper shared by every panel type. */
export default function PanelShell({
  title,
  tabs,
  children,
}: {
  title?: string;
  /** Switch buttons that replace the title text (区块/部门, system groups). */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      {title || tabs ? (
        <div className={styles.panelHeader}>
          {tabs ??
            (title ? <h2 className={styles.panelTitle}>{title}</h2> : null)}
        </div>
      ) : null}
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}
