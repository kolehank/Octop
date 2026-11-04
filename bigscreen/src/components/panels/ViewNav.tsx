import styles from "@/styles/board.module.css";
import type { TopicView } from "@/lib/types";

interface ViewNavProps {
  views: TopicView[];
  activeView: string;
  onChange: (view: string) => void;
}

/** In-screen view switcher (整屏数据联动，AI 对话区不切换). */
export default function ViewNav({ views, activeView, onChange }: ViewNavProps) {
  return (
    <nav className={styles.regionList} aria-label="视角">
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          className={`${styles.viewButton} ${
            view.id === activeView ? styles.viewButtonActive : ""
          }`}
          onClick={() => onChange(view.id)}
        >
          <span>{view.label}</span>
        </button>
      ))}
    </nav>
  );
}
