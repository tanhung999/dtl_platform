import { Search } from 'lucide-react';
import './collection-search.css';

export function CollectionSearch({ label, placeholder, value, onChange, className = '' }: {
  label: string; placeholder: string; value: string; onChange: (value: string) => void; className?: string;
}) {
  return <label className={`collection-search ${className}`}>
    <span className="collection-search-label"><Search size={15} aria-hidden="true" />{label}</span>
    <input type="search" className="form-input" placeholder={placeholder} maxLength={200} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}
