import { scheduleTimelineRoute } from "./schedule-timeline";
import { ScheduleGantt } from "@/features/schedule-timeline/schedule-gantt";

export default function ScheduleTimelinePage() {
  const { projectKey } = scheduleTimelineRoute.useParams();
  return <ScheduleGantt projectKey={projectKey} />;
}
