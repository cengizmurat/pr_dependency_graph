import { Routes, Route } from "react-router-dom";
import LandingPage from "./components/LandingPage";
import GraphPage from "./components/GraphPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/:owner/:repo" element={<GraphPage />} />
    </Routes>
  );
}
