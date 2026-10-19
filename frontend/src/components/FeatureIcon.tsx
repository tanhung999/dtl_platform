import { featureIcons } from '../assets/featureIcons';

/** Decorative function artwork; the adjacent label supplies the accessible name. */
export function FeatureIcon({ name, size = 26 }: { name: keyof typeof featureIcons; size?: number }) {
  return <img src={featureIcons[name]} alt="" aria-hidden="true" width={size} height={size}
    style={{ display: 'inline-block', flexShrink: 0, objectFit: 'contain', verticalAlign: 'middle' }} />;
}
