import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import DemoScreen from "./screens/demo";

/**
 * Big-screen shell. Every screen lives under /screen/<name>/ — the FastAPI
 * static mount serves this SPA for the whole /screen prefix.
 */
export default function App() {
  return (
    <BrowserRouter basename="/screen">
      <Routes>
        <Route path="/" element={<Navigate to="/demo/" replace />} />
        <Route path="/demo/*" element={<DemoScreen />} />
        <Route path="*" element={<Navigate to="/demo/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}