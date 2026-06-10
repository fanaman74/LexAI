import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import Library from "./pages/Library";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";
import ChatPage from "./pages/Chat";
import CaseReview from "./pages/CaseReview";

export default function App() {
  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar />
      <main className="ml-60 flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/review" element={<CaseReview />} />
        </Routes>
      </main>
    </div>
  );
}
