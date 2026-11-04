import { useState, type FormEvent } from "react";
import { login } from "@/lib/auth";
import styles from "@/styles/board.module.css";

/** Lightweight in-page login for big screens that were opened before Octop. */
export default function LoginOverlay({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onSuccess();
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : String(loginError),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.loginOverlay}>
      <form className={styles.loginCard} onSubmit={submit}>
        <h3 className={styles.loginTitle}>登录大屏</h3>
        <p className={styles.loginHint}>使用 Octop 账号登录后即可对话</p>
        <label className={styles.loginField}>
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label className={styles.loginField}>
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <div className={styles.loginError}>{error}</div> : null}
        <button className={styles.loginSubmit} type="submit" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </div>
  );
}
