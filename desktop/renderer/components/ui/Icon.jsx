import React from 'react';

const PATHS = {
  agent: (
    <>
      <path d="M8 7h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
      <path d="M12 4v3" />
      <path d="M9 12h.01" />
      <path d="M15 12h.01" />
      <path d="M10 15h4" />
    </>
  ),
  tools: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z" />
    </>
  ),
  settings: (
    <>
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
      <path d="M4 12h2" />
      <path d="M18 12h2" />
      <path d="M12 4v2" />
      <path d="M12 18v2" />
      <path d="m6.3 6.3 1.4 1.4" />
      <path d="m16.3 16.3 1.4 1.4" />
      <path d="m17.7 6.3-1.4 1.4" />
      <path d="m7.7 16.3-1.4 1.4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 20h14" />
    </>
  ),
  preview: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8" />
      <path d="M8 13h4" />
    </>
  ),
  sidebar: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M9 5v14" />
    </>
  ),
  terminal: (
    <>
      <path d="m6 8 4 4-4 4" />
      <path d="M12 16h6" />
    </>
  ),
  inspector: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M15 5v14" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </>
  ),
  list: (
    <>
      <path d="M8 7h12" />
      <path d="M8 12h12" />
      <path d="M8 17h12" />
      <path d="M4 7h.01" />
      <path d="M4 12h.01" />
      <path d="M4 17h.01" />
    </>
  ),
  timeline: (
    <>
      <path d="M7 4v16" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M11 7h8" />
      <path d="M11 17h8" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v4" />
      <path d="M8 4h8" />
      <path d="m9 4 1 8-3 3h10l-3-3 1-8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  expand: (
    <>
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M4 16v4h4" />
    </>
  ),
  restore: (
    <>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M20 15h-5v5" />
      <path d="M4 15h5v5" />
    </>
  ),
  // Message type icons
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  warning: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  debug: (
    <>
      <path d="m12 3 7 4v6l-7 4-7-4V7l7-4Z" />
      <path d="M12 9v6" />
      <path d="M8 6l8 4" />
      <path d="M16 6-8 4" />
    </>
  ),
  tool: (
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z" />
      <circle cx="6" cy="17" r="1" fill="currentColor" />
    </>
  ),
  tool_result: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  event: (
    <>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </>
  ),
  result: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 17 4-8 4 5 6-6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 1 0-16 0" />
    </>
  ),
  assistant: (
    <>
      <path d="M12 8V4H8" />
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M8 14h.01" />
      <path d="M16 14h.01" />
      <path d="M10 18h4" />
    </>
  ),
  thinking: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
      <path d="M8 12h.01" />
      <path d="M16 12h.01" />
    </>
  ),
  plan: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  message: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <path d="M14 2v6h6" />
    </>
  ),
  // Additional tool icons
  write: (
    <>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 16.5 2 18l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </>
  ),
  read: (
    <>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
    </>
  ),
  shell: (
    <>
      <path d="m6 8 4 4-4 4" />
      <path d="M12 16h6" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  subagent: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M7 14v-3a1 1 0 0 1 1-1h5" />
    </>
  ),
};

export default function Icon({ name, size = 16, strokeWidth = 2, style }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {PATHS[name] || PATHS.preview}
    </svg>
  );
}
