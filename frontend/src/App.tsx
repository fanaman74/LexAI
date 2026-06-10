import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import Library from "./pages/Library";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";
import ChatPage from "./pages/Chat";
import CaseReview from "./pages/CaseReview";
import Cases from "./pages/Cases";
import FolderUpload from "./pages/FolderUpload";
import Search from "./pages/Search";

export default function App() {
  return (
    <div className="flex min-h-screen bg-black">
      <Sidebar />
      <main className="mt-14 flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/review" element={<CaseReview />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/folder-upload" element={<FolderUpload />} />
          <Route path="/search" element={<Search />} />
        </Routes>
      </main>
    </div>
  );
}
