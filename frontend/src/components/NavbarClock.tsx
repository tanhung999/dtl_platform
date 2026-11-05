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
  const [hours, minutes, seconds] = time.split(':');
  return <div className="nav-clock"><Clock size={20} aria-hidden="true" />
    <time className="nav-clock-time" dateTime={time} aria-label={`Giờ hiện tại: ${hours}:${minutes}:${seconds}`}>
      <span className="nav-clock-main">{hours}:{minutes}</span><span className="nav-clock-seconds">:{seconds}</span>
    </time>
  </div>;
}
