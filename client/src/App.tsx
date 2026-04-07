import { Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import LandingPage from "./components/LandingPage";
import GraphPage from "./components/GraphPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/:owner/:repo" element={<GraphPage />} />
      </Routes>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
