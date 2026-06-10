import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus } from "../api";

const navItems = [
  {
    to: "/",
    label: "Home",
    end: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M3 12L12 3l9 9" />
        <path d="M9 21V12h6v9" />
        <path d="M3 12v9h18v-9" />
      </svg>
    ),
  },
  {
    to: "/library",
    label: "Library",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="11" rx="1" />
        <path d="M14 18l3 3 4-4" />
      </svg>
    ),
  },
  {
    to: "/cases",
    label: "Cases",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    to: "/review",
    label: "Review",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
  },
  {
    to: "/search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    to: "/chat",
    label: "Chat",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    api<IndexStatus>("/api/index/status").then(setStatus).catch(() => {});
  }, []);

  const activeClass = "text-amber-400 after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-amber-400";
  const inactiveClass = "text-zinc-500 hover:text-amber-400";

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-black/90 backdrop-blur-sm border-b border-zinc-900 z-30 flex items-center px-6">
      {/* Logo */}
      <span className="text-white font-bold text-base tracking-tight shrink-0 mr-8">
        Lex<span className="text-amber-400">AI</span>
      </span>

      {/* Nav centered */}
      <nav className="flex-1 flex justify-center">
        <ul className="flex items-center gap-1">
          {navItems.map(({ to, label, end, icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex flex-col items-center gap-0.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isActive ? activeClass : inactiveClass
                  }`
                }
              >
                {icon}
                <span className="hidden sm:block">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Status pill */}
      <div className="shrink-0 ml-8">
        {status ? (
          <span className="text-xs text-zinc-600">
            {status.status === "running"
              ? `indexing ${status.indexed}/${status.total}`
              : `${status.indexed} indexed`}
          </span>
        ) : null}
      </div>
    </header>
  );
}
