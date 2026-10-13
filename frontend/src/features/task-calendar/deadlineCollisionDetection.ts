import { closestCenter, CollisionDetection, pointerWithin, UniqueIdentifier } from '@dnd-kit/core';

// Sticky all-day rows cover part of the scrolled timeline. Prefer the visible
// all-day target and exclude hour cells hidden underneath it or outside the scroller.
export function deadlineCollisionDetection(args: Parameters<CollisionDetection>[0], keyboardTarget?: UniqueIdentifier): ReturnType<CollisionDetection> {
  if (!args.pointerCoordinates && keyboardTarget !== undefined) {
    const chosen = args.droppableContainers.filter(container => container.id === keyboardTarget);
    if (chosen.length) return closestCenter({ ...args, droppableContainers: chosen });
  }
  const point = args.pointerCoordinates || { x: args.collisionRect.left + args.collisionRect.width / 2, y: args.collisionRect.top + args.collisionRect.height / 2 };
  // Manual edge scrolling can precede dnd-kit's next measurement. Hit-test
  // the actual visible cells so the selected hour matches the pointer.
  const liveRects = new Map(args.droppableRects);
  if (args.pointerCoordinates) args.droppableContainers.forEach(container => {
    const node = container.node.current;
    if (node) liveRects.set(container.id, node.getBoundingClientRect());
  });
  const regions = new Map<Element, { top: number; bottom: number; left: number; right: number }>();
  const visible = args.droppableContainers.filter(container => {
    if (container.data.current?.type !== 'calendar-slot') return true;
    const scroller = container.node.current?.closest('.calendar-week-scroll');
    if (!scroller) return false;
    let region = regions.get(scroller);
    if (!region) {
      const bounds = scroller.getBoundingClientRect();
      region = { top: scroller.querySelector('.calendar-week-all-day')?.getBoundingClientRect().bottom ?? bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      regions.set(scroller, region);
    }
    return point.y >= region.top && point.y <= region.bottom && point.x >= region.left && point.x <= region.right;
  });
  const allDay = visible.filter(container => {
    if (container.data.current?.type !== 'calendar-all-day') return false;
    const rect = liveRects.get(container.id);
    return rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  });
  const candidates = allDay.length ? allDay : visible;
  return args.pointerCoordinates ? pointerWithin({ ...args, droppableRects: liveRects, droppableContainers: candidates }) : closestCenter({ ...args, droppableContainers: candidates });
};
