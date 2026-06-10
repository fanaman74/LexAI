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
  const bottomRef = useRef<HTMLDivElement>(null);

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
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    if (!activeChat && contextIds.length === 0) {
      setError("Select at least one file (open Chat from the Library or a search result).");
      return;
    }
    setBusy(true); setError("");
    // optimistic render of the user message
    setMessages((m) => [...m, {
      id: -1, role: "user", content: message, created_at: "" }]);
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
        setChats((c) => [{ id: res.id, file_ids: res.file_ids,
          title: res.title, created_at: "" }, ...c]);
      }
      setInput("");
    } catch (e) {
      setMessages((m) => m.filter((msg) => msg.id !== -1));
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto flex gap-4" style={{ height: "calc(100vh - 7rem)" }}>
      <aside className="w-64 shrink-0 bg-white rounded-xl shadow-sm border border-slate-200 p-3 overflow-y-auto">
        <button onClick={newChat}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium mb-3">
          + New chat
        </button>
        <h3 className="text-xs font-semibold text-slate-400 mb-1">RECENT</h3>
        {chats.length === 0 && <p className="text-xs text-slate-400">No chats yet.</p>}
        {chats.map((c) => (
          <button key={c.id} onClick={() => openChat(c.id)}
            className={`block w-full text-left text-sm rounded-lg px-2 py-1.5 mb-1 truncate ${
              activeChat?.id === c.id ? "bg-indigo-50 text-indigo-700 font-medium"
                : "text-slate-600 hover:bg-slate-50"}`}>
            {c.title}
          </button>
        ))}
      </aside>

      <section className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200">
        <header className="border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">Chatting with:</span>
            {contextNames.length === 0 ? (
              <span className="text-sm text-slate-400">
                no files — <Link to="/library" className="text-indigo-600 underline">pick some in the Library</Link>
              </span>
            ) : contextNames.map((n, i) => (
              <span key={i} className="bg-slate-100 rounded-full px-3 py-0.5 text-xs">{n}</span>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-slate-400 text-sm text-center mt-10">
              Ask anything about the selected documents — answers cite the source text.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex"}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                m.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-800 rounded-bl-sm prose prose-sm max-w-[80%]"}`}>
                {m.role === "user" ? m.content : <ReactMarkdown>{m.content}</ReactMarkdown>}
              </div>
            </div>
          ))}
          {busy && <p className="text-slate-400 text-sm">Thinking…</p>}
          <div ref={bottomRef} />
        </div>

        {error && (
          <p className="text-red-700 text-sm px-4 pb-1">{error}</p>
        )}
        <footer className="border-t border-slate-100 p-3 flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about these documents… (Enter to send)"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button onClick={send} disabled={busy || !input.trim()}
            className="bg-indigo-600 disabled:bg-slate-300 text-white rounded-lg px-4 text-sm font-medium">
            Send
          </button>
        </footer>
      </section>
    </div>
  );
}
