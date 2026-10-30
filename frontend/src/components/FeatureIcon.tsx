import { brandIconAtlas, brandIconCells, taskIcon, FeatureIconName, ATLAS_COLS, ATLAS_ROWS } from '../assets/featureIcons';

/** Decorative function artwork; the adjacent label supplies the accessible name. */
export function FeatureIcon({ name, size = 26 }: { name: FeatureIconName; size?: number }) {
  if (name !== 'tasks') {
    const [column, row] = brandIconCells[name];
    const xPercent = (column / (ATLAS_COLS - 1)) * 100;
    const yPercent = (row / (ATLAS_ROWS - 1)) * 100;
    return <span className="feature-icon" aria-hidden="true" style={{ display: 'inline-block', flexShrink: 0, width: size, height: size, verticalAlign: 'middle', backgroundImage: `url(${brandIconAtlas})`, backgroundSize: `${ATLAS_COLS * 100}% ${ATLAS_ROWS * 100}%`, backgroundPosition: `${xPercent}% ${yPercent}%`, clipPath: 'circle(45% at 50% 50%)' }} />;
  }
  return <img className="feature-icon" src={taskIcon} alt="" aria-hidden="true" width={size} height={size}
    style={{ display: 'inline-block', flexShrink: 0, objectFit: 'contain', verticalAlign: 'middle' }} />;
}
