import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { Chat, ChatMsg, FileRow } from "../api";

export default function ChatPage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).map(Number);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSidebar, setShowSidebar] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<{ files: FileRow[] }>("/api/files").then(({ files }) =>
      setFiles(files.filter((f) => ids.includes(f.id))));
    api<{ chats: Chat[] }>("/api/chats").then((r) => setChats(r.chats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const contextIds = activeChat ? activeChat.file_ids : ids;
  const contextNames = activeChat
    ? activeChat.file_ids.map((id) =>
        files.find((f) => f.id === id)?.original_name ?? `file #${id}`)
    : files.map((f) => f.original_name);

  async function openChat(id: number) {
    setError("");
    setShowSidebar(false);
    const detail = await api<Chat>(`/api/chats/${id}`);
    setActiveChat(detail);
    setMessages(detail.messages ?? []);
    const allFiles = await api<{ files: FileRow[] }>("/api/files");
    setFiles(allFiles.files.filter((f) => detail.file_ids.includes(f.id)));
  }

  function newChat() {
    setActiveChat(null);
    setMessages([]);
    setError("");
    setShowSidebar(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    if (!activeChat && contextIds.length === 0) {
      setError("Select at least one file (open Chat from the Library or a search result).");
      return;
    }
    setBusy(true); setError("");
    setMessages((m) => [...m, { id: -1, role: "user", content: message, created_at: "" }]);
    try {
      if (activeChat) {
        const res = await api<{ messages: ChatMsg[] }>(
          `/api/chats/${activeChat.id}/messages`, {
            method: "POST", body: JSON.stringify({ message }) });
        setMessages(res.messages);
      } else {
        const res = await api<Chat & { messages: ChatMsg[] }>("/api/chats", {
          method: "POST",
          body: JSON.stringify({ file_ids: contextIds, message }) });
        setActiveChat(res);
        setMessages(res.messages);
        setChats((c) => [{ id: res.id, file_ids: res.file_ids, title: res.title, created_at: "" }, ...c]);
      }
      setInput("");
    } catch (e) {
      setMessages((m) => m.filter((msg) => msg.id !== -1));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sidebarContent = (
    <div className="flex flex-col h-full p-3">
      <button onClick={newChat}
        className="w-full bg-amber-500 hover:bg-amber-400 text-black rounded-lg py-2 text-sm font-semibold mb-3">
        + New chat
      </button>
      <p className="text-xs font-semibold text-zinc-500 mb-1 px-1">RECENT</p>
      {chats.length === 0 && <p className="text-xs text-zinc-600 px-1">No chats yet.</p>}
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {chats.map((c) => (
          <button key={c.id} onClick={() => openChat(c.id)}
            className={`block w-full text-left text-sm rounded-lg px-2 py-2 truncate transition-colors ${
              activeChat?.id === c.id
                ? "bg-amber-500/10 text-amber-400 font-medium"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}>
            {c.title}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 bg-zinc-950 border-r border-zinc-800">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSidebar(false)} />
          <aside className="relative z-50 w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-zinc-900">
        {/* Header */}
        <header className="shrink-0 border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setShowSidebar(true)}
            className="md:hidden text-zinc-400 hover:text-white p-1 -ml-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-semibold text-zinc-300 shrink-0">Chatting with:</span>
            {contextNames.length === 0 ? (
              <span className="text-sm text-zinc-500">
                no files — <Link to="/library" className="text-amber-400 underline">pick from Library</Link>
              </span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {contextNames.map((n, i) => (
                  <span key={i} className="bg-zinc-800 text-zinc-300 rounded-full px-2.5 py-0.5 text-xs truncate max-w-[200px]">{n}</span>
                ))}
              </div>
            )}
          </div>
        </header>

        {/* Messages — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm text-center mt-16">
              Ask anything about the selected documents — answers cite the source text.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-amber-500 text-black rounded-br-sm"
                  : "bg-zinc-800 text-zinc-100 rounded-bl-sm prose prose-sm prose-invert"}`}>
                {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex">
              <div className="bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-2.5">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input — always pinned at bottom */}
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 p-3">
          {error && <p className="text-red-400 text-xs mb-2 px-1">{error}</p>}
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about these documents… (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="flex-1 border border-zinc-700 bg-zinc-800 text-white placeholder-zinc-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500 resize-none overflow-hidden leading-relaxed"
              style={{ minHeight: "42px" }}
            />
            <button onClick={send} disabled={busy || !input.trim()}
              className="shrink-0 bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
