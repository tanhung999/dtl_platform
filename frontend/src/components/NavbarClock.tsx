import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

function currentTime() {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}

export function NavbarClock() {
  const [time, setTime] = useState(currentTime);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(currentTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="nav-clock"><Clock size={15} /><span className="nav-clock-time">{time}</span></div>;
}
