import { Route, Routes } from "react-router-dom";
import TopicScreen from "./TopicScreen";
import DrilldownScreen from "./DrilldownScreen";

/** Demo screen: topic routes + drill-down. */
export default function DemoScreen() {
  return (
    <Routes>
      <Route index element={<TopicScreen topicId="overview" />} />
      <Route path=":topicId" element={<TopicScreen />} />
      <Route path=":topicId/:dimension/:itemId" element={<DrilldownScreen />} />
      <Route path="*" element={<TopicScreen topicId="overview" />} />
    </Routes>
  );
}
