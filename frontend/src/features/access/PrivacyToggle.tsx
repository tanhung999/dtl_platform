import { useId } from 'react';
import { EyeOff, Lock } from 'lucide-react';
import { useCanShareCalendar } from './SharingCapabilityContext';
import './privacy.css';

export function PrivacyToggle({ value, onChange, label, disabled = false, hideIndirect, onHideIndirect, readOnly = false, canAssign = false }: {
  value: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean;
  hideIndirect?: boolean; onHideIndirect?: (value: boolean) => void; readOnly?: boolean; canAssign?: boolean;
}) {
  const allowed = useCanShareCalendar();
  const descriptionId = useId();
  if (readOnly) return hideIndirect !== undefined && (value || hideIndirect) ? <div className="privacy-setting privacy-readonly" role="note"><Lock size={15} aria-hidden="true" />
    <p>Đã ẩn với những người xem lịch của bạn.</p></div> : null;
  if (!allowed && (hideIndirect === undefined || !onHideIndirect)) return null;
  return <div className="privacy-setting"><div className="privacy-setting-options">
    {allowed && <div className="privacy-option"><label className="privacy-setting-toggle"><input type="checkbox" role="switch" aria-label={label}
      aria-describedby={`${descriptionId}-private`} disabled={disabled} checked={value} onChange={event => onChange(event.target.checked)} /><Lock size={15} aria-hidden="true" /><span>Riêng tư</span></label>
      <p id={`${descriptionId}-private`}>Người đang xem lịch của bạn sẽ không thấy mục này.</p></div>}
    {hideIndirect !== undefined && onHideIndirect && <div className="privacy-option"><label className="privacy-setting-toggle"><input type="checkbox" role="switch" aria-label="Ẩn với người xem lịch của người nhận"
      aria-describedby={`${descriptionId}-indirect`} disabled={disabled || value} checked={value || hideIndirect} onChange={event => onHideIndirect(event.target.checked)} /><EyeOff size={15} aria-hidden="true" /><span>Ẩn với người xem lịch của người nhận</span></label>
      <p id={`${descriptionId}-indirect`}>{canAssign ? 'Người nhận hoặc theo dõi việc này vẫn thấy.' : 'Người theo dõi việc này vẫn thấy.'} Những người xem lịch của họ sẽ không thấy.</p></div>}
    </div>
  </div>;
}
