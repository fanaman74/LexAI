import { NavLink, Route, Routes } from "react-router-dom";
import Library from "./pages/Library";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";
import ChatPage from "./pages/Chat";

export default function App() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white hover:bg-slate-800"}`;
  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="bg-slate-900 px-6 py-3 flex items-center gap-4 sticky top-0 z-10 shadow">
        <span className="text-white font-bold text-lg tracking-tight">
          ⚖️ LexAI <span className="text-indigo-400">v2</span>
        </span>
        <NavLink to="/" className={link} end>Library</NavLink>
        <NavLink to="/chat" className={link}>Chat</NavLink>
        <NavLink to="/analyze" className={link}>AI Analysis</NavLink>
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analyze" element={<Analyze />} />
        </Routes>
      </main>
    </div>
  );
}
