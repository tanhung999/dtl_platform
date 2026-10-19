import { useMutationChecking } from './useMutationChecking';
import './mutations.css';
export function MutationStatus() {
  const checking = useMutationChecking();
  return checking ? <div className="mutation-checking-status" role="status">Đang kiểm tra lại kết quả…</div> : null;
}
