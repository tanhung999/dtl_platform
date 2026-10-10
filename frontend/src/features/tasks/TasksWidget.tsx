import React, { useEffect, useState } from 'react';
import { CheckSquare, Plus, Trash2, Calendar } from 'lucide-react';
import { api } from '../../services/api';
import { Task, TaskPriority } from '../../types';

export const TasksWidget: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('MEDIUM');
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'DONE'>('ALL');
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await api.getTasks();
      setTasks(data);
    } catch (err) {
      console.error('Lỗi tải công việc:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    try {
      const created = await api.createTask({
        title,
        priority: newPriority,
        due_date: 'Hôm nay',
      });
      setTasks((prev) => [created, ...prev]);
      setNewTitle('');
    } catch (err) {
      console.error('Lỗi tạo công việc:', err);
    }
  };

  const handleToggleComplete = async (task: Task) => {
    const nextCompleted = !task.is_completed;
    // Optimistic UI update
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_completed: nextCompleted } : t))
    );
    try {
      await api.updateTask(task.id, { is_completed: nextCompleted });
    } catch (err) {
      console.error('Lỗi cập nhật công việc:', err);
      fetchTasks();
    }
  };

  const handleDeleteTask = async (id: string) => {
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Lỗi xóa công việc:', err);
    }
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === 'PENDING') return !t.is_completed;
    if (filter === 'DONE') return t.is_completed;
    return true;
  });

  const pendingCount = tasks.filter((t) => !t.is_completed).length;

  return (
    <div className="glass-panel widget-box">
      <div className="widget-header">
        <div className="widget-title">
          <CheckSquare size={18} className="widget-title-icon" />
          <span>Việc Cần Làm (To-Do List)</span>
        </div>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            background: pendingCount > 0 ? 'var(--primary-light)' : 'var(--bg-subtle)',
            color: pendingCount > 0 ? 'var(--accent)' : 'var(--text-muted)',
            padding: '2px 8px',
            borderRadius: '12px',
          }}
        >
          {pendingCount} việc chưa xong
        </span>
      </div>

      {/* Quick Add Bar */}
      <form onSubmit={handleCreateTask} className="quick-input-bar">
        <input
          type="text"
          placeholder="Thêm việc cần làm mới... (Enter để tạo)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <select
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
          style={{
            padding: '0.4rem 0.6rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontWeight: 600,
            background: 'var(--input-bg)',
            color: 'var(--text-main)',
          }}
        >
          <option value="LOW">Thấp</option>
          <option value="MEDIUM">Vừa</option>
          <option value="HIGH">Cao</option>
          <option value="URGENT">Gấp</option>
        </select>
        <button type="submit" className="btn btn-primary btn-sm" title="Tạo công việc">
          <Plus size={16} />
        </button>
      </form>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
        <button
          type="button"
          className={`btn btn-sm ${filter === 'ALL' ? 'btn-secondary' : 'btn-outline'}`}
          onClick={() => setFilter('ALL')}
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
        >
          Tất cả ({tasks.length})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${filter === 'PENDING' ? 'btn-secondary' : 'btn-outline'}`}
          onClick={() => setFilter('PENDING')}
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
        >
          Chưa làm ({pendingCount})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${filter === 'DONE' ? 'btn-secondary' : 'btn-outline'}`}
          onClick={() => setFilter('DONE')}
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
        >
          Đã xong ({tasks.length - pendingCount})
        </button>
      </div>

      {/* Task Items */}
      {loading && tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
          Đang tải danh sách công việc...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '1.5rem 1rem',
            color: '#94a3b8',
            fontSize: '0.85rem',
            border: '2px dashed #e2e8f0',
            borderRadius: '10px',
          }}
        >
          {filter === 'DONE'
            ? 'Chưa có công việc nào hoàn thành.'
            : 'Tuyệt vời! Bạn không còn việc nào đang chờ giải quyết.'}
        </div>
      ) : (
        <div className="tasks-list">
          {filteredTasks.map((task) => (
            <div key={task.id} className={`task-item ${task.is_completed ? 'completed' : ''}`}>
              <input
                type="checkbox"
                className="task-checkbox"
                checked={task.is_completed}
                onChange={() => handleToggleComplete(task)}
                title={task.is_completed ? 'Đánh dấu chưa xong' : 'Đánh dấu hoàn thành'}
              />
              <div className="task-info">
                <span className="task-title">{task.title}</span>
                <div className="task-meta">
                  <span className={`priority-tag priority-${task.priority}`}>
                    {task.priority === 'URGENT' && 'Gấp'}
                    {task.priority === 'HIGH' && 'Ưu tiên cao'}
                    {task.priority === 'MEDIUM' && 'Trung bình'}
                    {task.priority === 'LOW' && 'Thấp'}
                  </span>
                  {task.due_date && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Calendar size={11} />
                      {task.due_date}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  padding: '4px',
                }}
                onClick={() => handleDeleteTask(task.id)}
                title="Xóa công việc"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
