import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { api } from "../api";
import type { Chat, ChatMsg, FileRow, GraphContextItem } from "../api";

function graphContextTarget(item: GraphContextItem): string | null {
  if (item.id != null && item.label === "Document") return `/files/${item.id}`;
  if (item.id != null && item.label === "Case") return `/search?case_id=${item.id}`;
  if (item.label === "Keyword") return `/search?q=${encodeURIComponent(item.name)}`;
  return null;
}

function GraphContextCard({ item, index }: { item: GraphContextItem; index: number }) {
  const target = graphContextTarget(item);
  const key = `${item.type}-${item.id ?? index}-${index}`;
  const content = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[11px] bg-amber-500/10 text-amber-400 rounded px-1.5 py-0.5">
          {item.type.replaceAll("_", " ").toLowerCase()}
        </span>
        <span className="text-[11px] text-zinc-600">{item.label}</span>
      </div>
      <p className="text-sm text-zinc-200 mt-2 break-words">{item.name}</p>
      {item.file_type && (
        <p className="text-xs text-zinc-500 mt-1">{item.file_type}</p>
      )}
    </>
  );

  if (!target) {
    return (
      <div key={key} className="border border-zinc-800 rounded-lg p-3">
        {content}
      </div>
    );
  }

  return (
    <Link
      key={key}
      to={target}
      className="block border border-zinc-800 rounded-lg p-3 hover:border-amber-500/30 hover:bg-zinc-900 transition-colors"
    >
      {content}
    </Link>
  );
}

function GroundingBlock({
  files,
  graphItems,
}: {
  files: FileRow[];
  graphItems: GraphContextItem[];
}) {
  return (
    <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Grounded in</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {files.slice(0, 3).map((file) => (
          <Link
            key={file.id}
            to={`/files/${file.id}`}
            className="rounded-full bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 hover:text-amber-300 transition-colors"
          >
            {file.original_name}
          </Link>
        ))}
      </div>
      {graphItems.length > 0 && (
        <div className="mt-2 space-y-1">
          {graphItems.slice(0, 3).map((item, index) => {
            const target = graphContextTarget(item);
            const label = (
              <span className="text-[11px] text-zinc-500">
                {item.type.replaceAll("_", " ").toLowerCase()}: <span className="text-zinc-400">{item.name}</span>
              </span>
            );

            if (!target) return <div key={`${item.type}-${item.id ?? index}-${index}`}>{label}</div>;

            return (
              <Link
                key={`${item.type}-${item.id ?? index}-${index}`}
                to={target}
                className="block text-[11px] text-zinc-500 hover:text-amber-300 transition-colors"
              >
                {item.type.replaceAll("_", " ").toLowerCase()}: <span className="text-zinc-400">{item.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [params] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).map(Number);
  const source = params.get("source") ?? "";
  const [files, setFiles] = useState<FileRow[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [graphContext, setGraphContext] = useState<GraphContextItem[]>([]);
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
  const contextFiles = contextIds.map((id) => files.find((f) => f.id === id)).filter(Boolean) as FileRow[];
  const contextNames = activeChat
    ? activeChat.file_ids.map((id) =>
        files.find((f) => f.id === id)?.original_name ?? `file #${id}`)
    : files.map((f) => f.original_name);
  const chatSource = activeChat?.source ?? (source === "graph" ? "graph" : "manual");
  const isGraphGroupedChat = chatSource === "graph" && contextIds.length > 1;

  async function openChat(id: number) {
    setError("");
    setShowSidebar(false);
    const detail = await api<Chat>(`/api/chats/${id}`);
    setActiveChat(detail);
    setMessages(detail.messages ?? []);
    setGraphContext(detail.graph_context ?? []);
    const allFiles = await api<{ files: FileRow[] }>("/api/files");
    setFiles(allFiles.files.filter((f) => detail.file_ids.includes(f.id)));
  }

  function newChat() {
    setActiveChat(null);
    setMessages([]);
    setGraphContext([]);
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
        const res = await api<{ messages: ChatMsg[]; graph_context?: GraphContextItem[] }>(
          `/api/chats/${activeChat.id}/messages`, {
            method: "POST", body: JSON.stringify({ message }) });
        setMessages(res.messages);
        setGraphContext(res.graph_context ?? []);
      } else {
        const res = await api<Chat & { messages: ChatMsg[] }>("/api/chats", {
          method: "POST",
          body: JSON.stringify({ file_ids: contextIds, message, source: chatSource }) });
        setActiveChat(res);
        setMessages(res.messages);
        setGraphContext(res.graph_context ?? []);
        setChats((c) => [{ id: res.id, file_ids: res.file_ids, title: res.title, created_at: "", source: res.source }, ...c]);
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
            <span className="block truncate">{c.title}</span>
            {c.source === "graph" && (
              <span className="mt-1 inline-flex text-[11px] text-emerald-400">Graph</span>
            )}
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
      <div className="flex-1 flex min-w-0 bg-zinc-900">
        <div className="flex-1 flex flex-col min-w-0">
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
                no files — <Link to="/docmgmt" className="text-amber-400 underline">pick from DocMgmt</Link>
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

        {isGraphGroupedChat && (
          <div className="shrink-0 border-b border-emerald-900/50 bg-emerald-950/30 px-4 py-3">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-emerald-300">
                Opened from graph relationships with {contextIds.length} linked documents.
              </p>
              <div className="flex flex-wrap gap-2">
                {contextFiles.map((file) => (
                  <Link
                    key={file.id}
                    to={`/files/${file.id}`}
                    className="bg-zinc-800 text-zinc-200 rounded-full px-2.5 py-1 text-xs hover:text-amber-300 transition-colors"
                  >
                    {file.original_name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Messages — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-zinc-600 text-sm text-center mt-16">
              Ask anything about the selected documents — answers cite the source text.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className="max-w-[85%] sm:max-w-[75%]">
                <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                  m.role === "user"
                    ? "bg-amber-500 text-black rounded-br-sm"
                    : "bg-zinc-800 text-zinc-100 rounded-bl-sm prose prose-sm prose-invert"}`}>
                  {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
                </div>
                {m.role === "assistant" && contextFiles.length > 0 && (
                  <GroundingBlock files={contextFiles} graphItems={graphContext} />
                )}
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

        <aside className="hidden xl:flex w-72 shrink-0 border-l border-zinc-800 bg-zinc-950/70">
          <div className="w-full p-4 space-y-3 overflow-y-auto">
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Graph context</p>
              <p className="text-xs text-zinc-600 mt-1">
                Visible case, attachment, and keyword links used to ground this chat.
              </p>
            </div>

            {graphContext.length === 0 ? (
              <div className="border border-dashed border-zinc-800 rounded-lg p-4 text-xs text-zinc-600">
                No graph relationships available for the current document set.
              </div>
            ) : (
              <div className="space-y-2">
                {graphContext.slice(0, 12).map((item, index) => (
                  <GraphContextCard key={`${item.type}-${item.id ?? index}-${index}`} item={item} index={index} />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
