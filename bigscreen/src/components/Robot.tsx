import styles from "@/styles/board.module.css";

/** The demo robot mark lifted from the approved prototype. */
export default function Robot() {
  return (
    <svg
      className={styles.robot}
      viewBox="0 0 90 110"
      role="img"
      aria-label="智能体机器人"
    >
      <defs>
        <linearGradient id="robotBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b9de4" />
          <stop offset=".55" stopColor="#1269b7" />
          <stop offset="1" stopColor="#074783" />
        </linearGradient>
        <linearGradient id="robotHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#27a9e8" />
          <stop offset="1" stopColor="#07528f" />
        </linearGradient>
      </defs>
      <path
        d="M45 9V3m-4 0h8"
        stroke="#1269b7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="45" cy="3" r="2.5" fill="#24b9ed" />
      <path
        d="M20 21 15 15m55 6 5-6"
        stroke="#0a5c9e"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="14" cy="14" r="3" fill="#18a5df" />
      <circle cx="76" cy="14" r="3" fill="#18a5df" />
      <rect
        x="14"
        y="12"
        width="62"
        height="43"
        rx="18"
        fill="url(#robotHead)"
        stroke="#064a84"
        strokeWidth="1.5"
      />
      <path
        d="M23 18c12-7 32-7 44 0"
        fill="none"
        stroke="#65d5f5"
        strokeWidth="2"
        opacity=".65"
      />
      <rect x="21" y="24" width="48" height="23" rx="11" fill="#062c54" />
      <ellipse cx="34" cy="35" rx="5" ry="4" fill="#6cecff" />
      <ellipse cx="56" cy="35" rx="5" ry="4" fill="#6cecff" />
      <circle cx="35" cy="34" r="1.5" fill="#fff" />
      <circle cx="57" cy="34" r="1.5" fill="#fff" />
      <path
        d="M39 43h12"
        stroke="#3ed6f4"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="8" y="27" width="8" height="16" rx="4" fill="#0d6aad" />
      <rect x="74" y="27" width="8" height="16" rx="4" fill="#0d6aad" />
      <path
        d="M28 55h34l7 34H21l7-34Z"
        fill="url(#robotBody)"
        stroke="#07518c"
        strokeWidth="1.5"
      />
      <rect x="31" y="59" width="28" height="17" rx="5" fill="#e9f6ff" />
      <text
        x="45"
        y="66"
        textAnchor="middle"
        fontSize="5.5"
        fontWeight="700"
        fill="#2276bb"
      >
        AI助手
      </text>
      <path d="M38 71h14" stroke="#70a4d1" strokeWidth="1" />
      <circle cx="45" cy="82" r="3" fill="#64d9f1" />
      <path
        d="m22 61-9 6-4 17 8 2 8-15m43-10 9 6 4 17-8 2-8-15"
        fill="url(#robotBody)"
        stroke="#07518c"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="86" r="5" fill="#1678b9" />
      <circle cx="78" cy="86" r="5" fill="#1678b9" />
      <path
        d="M28 88 25 102h14l4-14m19 0 3 14H51l-4-14"
        fill="url(#robotBody)"
        stroke="#07518c"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M22 103h18v4H20c0-2 1-3 2-4Zm28 0h18c1 1 2 2 2 4H50v-4Z"
        fill="#06467e"
      />
      <path
        d="m27 61 5-2m31 2-5-2"
        stroke="#76e1f4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
