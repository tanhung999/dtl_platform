import { closestCenter, CollisionDetection, pointerWithin } from '@dnd-kit/core';

// Only cards in the source section may displace each other.
export const partitionedCollision: CollisionDetection = args => {
  const group = args.active.data.current?.group;
  const cards = args.droppableContainers.filter(item => item.data.current?.type === 'sortable' && item.data.current?.group === group);
  const hits = pointerWithin(args);
  const pin = hits.find(hit => hit.id === 'notes-pin-zone');
  if (pin) return [pin];
  const section = hits.find(hit => hit.id === group);
  if (section) return closestCenter({ ...args, droppableContainers: cards });
  const ownCard = hits.find(hit => cards.some(card => card.id === hit.id));
  if (ownCard) return [ownCard];
  const reset = hits.find(hit => hit.id === 'notes-reset-zone');
  if (args.pointerCoordinates) return reset ? [reset] : [];
  // Keyboard coordinates may target a card without a pointer.
  return closestCenter({ ...args, droppableContainers: cards });
};
