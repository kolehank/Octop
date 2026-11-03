/**
 * Inline linear icon set (Lucide/Feather style) for business-system entries.
 * Renders a 24×24 stroke icon for known names; falls back to `fallback` text
 * (usually the first character of the system name) otherwise.
 */
const PATHS: Record<string, React.ReactNode> = {
  "clipboard-check": (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  kanban: (
    <>
      <path d="M6 5v11" />
      <path d="M12 5v6" />
      <path d="M18 5v14" />
    </>
  ),
  "chart-line": (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="m7 14 4-4 4 3 5-6" />
    </>
  ),
  pulse: (
    <>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M9 6h4a2 2 0 0 1 2 2v3" />
      <path d="M15 18h-4a2 2 0 0 1-2-2v-3" />
    </>
  ),
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  map: (
    <>
      <path d="M14.1 6 9.9 4 4 6.2v13.6l5.9-2.2 4.2 2 5.9-2.2V3.8Z" />
      <path d="M9.9 4v13.6" />
      <path d="M14.1 6v13.6" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <path d="M6 6h.01M6 18h.01" />
    </>
  ),
};

interface SystemIconProps {
  name?: string;
  /** Fallback text (usually the first character of the system name). */
  fallback?: string;
}

export default function SystemIcon({ name, fallback }: SystemIconProps) {
  const icon = name ? PATHS[name] : undefined;
  if (!icon) {
    return <span aria-hidden>{fallback ?? ""}</span>;
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {icon}
    </svg>
  );
}
