import { Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import DocMgmt from "./pages/DocMgmt";
import DocumentView from "./pages/Document";
import Analyze from "./pages/Analyze";
import ChatPage from "./pages/Chat";
import CaseReview from "./pages/CaseReview";
import Cases from "./pages/Cases";
import FolderUpload from "./pages/FolderUpload";
import Search from "./pages/Search";
import Analytics from "./pages/Analytics";
import GraphRAG from "./pages/GraphRAG";

export default function App() {
  return (
    <div className="msoit-shell flex min-h-screen">
      <Sidebar />
      <main className="msoit-main flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/docmgmt" element={<DocMgmt />} />
          <Route path="/library" element={<DocMgmt />} />
          <Route path="/files/:id" element={<DocumentView />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/review" element={<CaseReview />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/folder-upload" element={<FolderUpload />} />
          <Route path="/search" element={<Search />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/graph" element={<GraphRAG />} />
        </Routes>
      </main>
    </div>
  );
}
