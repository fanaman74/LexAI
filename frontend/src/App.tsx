import { NavLink, Route, Routes } from "react-router-dom";
import Library from "./pages/Library";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";

export default function App() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium ${
      isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:text-white"}`;
  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-slate-900 px-6 py-3 flex items-center gap-4">
        <span className="text-white font-bold text-lg">LexAI v2</span>
        <NavLink to="/" className={link} end>Library</NavLink>
        <NavLink to="/analyze" className={link}>AI Analysis</NavLink>
      </nav>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/analyze" element={<Analyze />} />
        </Routes>
      </main>
    </div>
  );
}
