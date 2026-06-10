import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus } from "../api";

export default function Sidebar() {
  const [status, setStatus] = useState<IndexStatus | null>(null);

  useEffect(() => {
    api<IndexStatus>("/api/index/status").then(setStatus).catch(() => {});
  }, []);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-indigo-600 text-white"
        : "text-slate-300 hover:text-white hover:bg-slate-800"
    }`;

  return (
    <div className="fixed top-0 left-0 h-screen w-60 bg-slate-900 flex flex-col z-20 shadow-xl">
      <div className="px-5 py-5 border-b border-slate-800">
        <span className="text-white font-bold text-lg tracking-tight">
          ⚖️ LexAI <span className="text-indigo-400">v2</span>
        </span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        <NavLink to="/" className={link} end>
          <span>🏠</span> Home
        </NavLink>
        <NavLink to="/library" className={link}>
          <span>📚</span> Library
        </NavLink>
        <NavLink to="/review" className={link}>
          <span>⚖️</span> Case Review
        </NavLink>
        <NavLink to="/chat" className={link}>
          <span>💬</span> Chat
        </NavLink>
      </nav>
      <div className="px-4 py-3 border-t border-slate-800">
        {status ? (
          <span className="text-xs text-slate-400">
            {status.status === "running"
              ? `⚡ Indexing ${status.indexed}/${status.total}`
              : `● ${status.indexed} docs indexed`}
          </span>
        ) : (
          <span className="text-xs text-slate-400">● Idle</span>
        )}
      </div>
    </div>
  );
}
