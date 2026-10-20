import { createContext, useContext } from 'react';

export const SharingCapabilityContext = createContext(false);
export const useCanShareCalendar = () => useContext(SharingCapabilityContext);
