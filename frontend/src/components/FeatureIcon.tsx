import { featureIcons, type FeatureIconName } from '../assets/featureIcons';
import './feature-icon.css';

/** Decorative function artwork; the adjacent label supplies the accessible name. */
export function FeatureIcon({ name, size = 26 }: { name: FeatureIconName; size?: number }) {
  return <img className={`feature-icon${name === 'tasks' ? ' feature-icon--tasks' : ''}`} src={featureIcons[name]} alt="" aria-hidden="true" width={size} height={size}
    style={{ display: 'inline-block', flexShrink: 0, objectFit: 'contain', verticalAlign: 'middle', ...(name === 'tasks' ? { padding: size * 0.06 } : {}) }} />;
}
