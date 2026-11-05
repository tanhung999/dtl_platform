import { featureIcons, type FeatureIconName } from '../assets/featureIcons';

/** Decorative function artwork; the adjacent label supplies the accessible name. */
export function FeatureIcon({ name, size = 26 }: { name: FeatureIconName; size?: number }) {
  return <img className="feature-icon" src={featureIcons[name]} alt="" aria-hidden="true" width={size} height={size}
    style={{ display: 'inline-block', flexShrink: 0, objectFit: 'contain', verticalAlign: 'middle' }} />;
}
