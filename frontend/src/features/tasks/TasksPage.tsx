import { FeatureIcon } from '../../components/FeatureIcon';
import { ArrowLeft } from 'lucide-react';
import { TasksWidget } from './TasksWidget';

export function TasksPage({ onBack }: { onBack: () => void }) {
  return <section className="tasks-page" aria-label="Tất cả công việc">
    <header className="tasks-page-heading"><button type="button" className="btn btn-outline btn-sm" onClick={onBack}><ArrowLeft size={16} /> Về trang chủ</button><h1><FeatureIcon name="tasks" size={30} /> Tất cả công việc</h1></header>
    <TasksWidget fullPage />
  </section>;
}
