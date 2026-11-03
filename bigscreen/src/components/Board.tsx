import { useEffect, useState, type ReactNode } from "react";
import styles from "@/styles/board.module.css";
import { fitScale } from "@/lib/scale";

/** Fixed 1920×1080 canvas scaled to fit the viewport (big-screen standard). */
export default function Board({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(fitScale);

  useEffect(() => {
    const update = () => setScale(fitScale());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className={styles.viewport}>
      <div
        className={styles.board}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
