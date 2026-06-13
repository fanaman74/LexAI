"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
);
const FolderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>
);
const BriefcaseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="7" width="20" height="14" rx="2"/>
    <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
  </svg>
);
const EyeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const ChatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
);

const navItems = [
  { label: "Home", href: "/dashboard", icon: HomeIcon },
  { label: "Library", href: "/documents", icon: FolderIcon },
  { label: "Cases", href: "/cases", icon: BriefcaseIcon },
  { label: "Review", href: "/review", icon: EyeIcon },
  { label: "Chat", href: "/chat", icon: ChatIcon },
];

export default function Nav({ indexedCount }: { indexedCount?: number }) {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: "56px",
        backgroundColor: "#0d0d0d",
        borderBottom: "1px solid #2a2a2a",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
      }}
    >
      {/* Logo */}
      <Link href="/dashboard" style={{ textDecoration: "none", marginRight: "40px" }}>
        <span style={{ fontWeight: 700, fontSize: "18px", color: "#ffffff" }}>Lex</span>
        <span style={{ fontWeight: 700, fontSize: "18px", color: "#f59e0b" }}>AI</span>
      </Link>

      {/* Nav items */}
      <div style={{ display: "flex", gap: "32px", alignItems: "center" }}>
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
                textDecoration: "none",
                color: active ? "#f59e0b" : "#9ca3af",
                fontSize: "11px",
                position: "relative",
              }}
            >
              <Icon />
              <span>{label}</span>
              {active && (
                <span
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    backgroundColor: "#f59e0b",
                    position: "absolute",
                    bottom: "-6px",
                  }}
                />
              )}
            </Link>
          );
        })}
      </div>

      {/* Right: indexed count */}
      <div style={{ marginLeft: "auto", color: "#9ca3af", fontSize: "13px" }}>
        {indexedCount !== undefined ? `${indexedCount} indexed` : ""}
      </div>
    </nav>
  );
}
