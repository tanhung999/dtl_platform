import { useEffect } from 'react';
import companyIcon from '../assets/logo-source.png';
import { brandIconAtlas, brandIconCells, taskIcon, type FeatureIconName } from '../assets/featureIcons';
import { workspaceRoutes, type RoutedPage } from '../features/dashboard/navigation';

const icons = new Map<FeatureIconName, Promise<string>>();
const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(source: string) {
  let image = images.get(source);
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('Không tải được icon trang.'));
      node.src = source;
    });
    images.set(source, image);
    image.catch(() => images.delete(source));
  }
  return image;
}

/** Render the same artwork as FeatureIcon into the browser's square icon slot. */
function featureFavicon(name: FeatureIconName) {
  let icon = icons.get(name);
  if (!icon) {
    icon = loadImage(name === 'tasks' ? taskIcon : brandIconAtlas).then(image => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Không thể hiển thị icon trang.');
      context.imageSmoothingQuality = 'high';
      if (name === 'tasks') {
        const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
      } else {
        const [column, row] = brandIconCells[name];
        const width = image.naturalWidth / 3, height = image.naturalHeight / 3;
        context.beginPath();
        context.arc(32, 32, 64 * .45, 0, Math.PI * 2);
        context.clip();
        context.drawImage(image, column * width, row * height, width, height, 0, 0, 64, 64);
      }
      return canvas.toDataURL('image/png');
    });
    icons.set(name, icon);
    icon.catch(() => icons.delete(name));
  }
  return icon;
}

export function PageBranding({ page = 'dashboard', notFound = false, unreadCount = 0 }: { page?: RoutedPage; notFound?: boolean; unreadCount?: number }) {
  const brand = workspaceRoutes[page];
  useEffect(() => {
    const title = notFound ? 'Không tìm thấy trang · Đông Tây One' : brand.title;
    document.title = unreadCount > 0 ? `${title} (${unreadCount})` : title;
  }, [brand.title, notFound, unreadCount]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
    link.rel = 'icon'; link.type = 'image/png';
    link.href = companyIcon;
    link.dataset.brand = 'dt1';
    if (!link.isConnected) document.head.appendChild(link);
    let active = true;
    if (brand.icon && !notFound) {
      void featureFavicon(brand.icon).then(url => {
        if (active) { link.href = url; link.dataset.brand = brand.icon; }
      }).catch(() => { /* Retain the company icon when image loading fails. */ });
    }
    return () => { active = false; };
  }, [brand, notFound]);
  return null;
}
