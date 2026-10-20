import { Lock } from 'lucide-react';
import { useCanShareCalendar } from './SharingCapabilityContext';
import './privacy.css';

export function PrivacyToggle({ value, onChange, label, disabled = false }: { value: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  const allowed = useCanShareCalendar();
  if (!allowed) return null;
  return <div className="privacy-setting"><label className="privacy-setting-toggle"><input type="checkbox" role="switch" aria-label={label} disabled={disabled} checked={value} onChange={event => onChange(event.target.checked)} /><Lock size={15} aria-hidden="true" /><span>Riêng tư</span></label>
    <p>{value ? 'Chỉ bạn nhìn thấy. Người được chia sẻ lịch không nhìn thấy mục này.' : 'Bật riêng tư để ẩn mục này với người được chia sẻ lịch.'}</p>
  </div>;
}
