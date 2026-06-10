import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../api";
import type { IndexStatus } from "../api";

export default function Sidebar() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<IndexStatus>("/api/index/status").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "bg-amber-500 text-black" : "text-zinc-300 hover:text-white hover:bg-zinc-800"
    }`;

  const navLinks = (
    <>
      <NavLink to="/" className={link} end onClick={() => setOpen(false)}>
        <span>🏠</span> Home
      </NavLink>
      <NavLink to="/library" className={link} onClick={() => setOpen(false)}>
        <span>📚</span> Library
      </NavLink>
      <NavLink to="/cases" className={link} onClick={() => setOpen(false)}>
        <span>📁</span> Cases
      </NavLink>
      <NavLink to="/review" className={link} onClick={() => setOpen(false)}>
        <span>⚖️</span> Case Review
      </NavLink>
      <NavLink to="/chat" className={link} onClick={() => setOpen(false)}>
        <span>💬</span> Chat
      </NavLink>
    </>
  );

  const statusPill = (
    <div className="px-4 py-3 border-t border-zinc-800">
      {status ? (
        <span className="text-xs text-zinc-400">
          {status.status === "running"
            ? `⚡ Indexing ${status.indexed}/${status.total}`
            : `● ${status.indexed} docs indexed`}
        </span>
      ) : (
        <span className="text-xs text-zinc-400">● Idle</span>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden md:flex fixed top-0 left-0 h-screen w-60 bg-zinc-950 flex-col z-20 shadow-xl">
        <div className="px-5 py-5 border-b border-zinc-800">
          <span className="text-white font-bold text-lg tracking-tight">
            ⚖️ LexAI <span className="text-amber-400">v2</span>
          </span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">{navLinks}</nav>
        {statusPill}
      </div>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-zinc-950 border-b border-zinc-800 flex items-center px-4 z-30">
        <button
          onClick={() => setOpen(true)}
          className="text-zinc-300 hover:text-white p-1 mr-3"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-white font-bold text-base tracking-tight">
          ⚖️ LexAI <span className="text-amber-400">v2</span>
        </span>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setOpen(false)} />
      )}
      <div
        ref={drawerRef}
        className={`md:hidden fixed top-0 left-0 h-screen w-64 bg-zinc-950 flex flex-col z-50 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-5 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-white font-bold text-lg tracking-tight">
            ⚖️ LexAI <span className="text-amber-400">v2</span>
          </span>
          <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">{navLinks}</nav>
        {statusPill}
      </div>
    </>
  );
}
