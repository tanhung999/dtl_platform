import { FeatureIcon } from '../../components/FeatureIcon';
import { TasksWidget } from './TasksWidget';

export function TasksPage() {
  return <section className="tasks-page" aria-label="Tất cả công việc">
    <header className="tasks-page-heading"><h1><FeatureIcon name="tasks" size={30} /> DT Task</h1></header>
    <TasksWidget fullPage />
  </section>;
}
