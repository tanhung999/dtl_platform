import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle-btn ${className}`}
      title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
      aria-label="Toggle dark/light theme"
    >
      <div className="theme-toggle-icon-wrap">
        {theme === 'dark' ? (
          <Sun size={16} className="sun-icon" />
        ) : (
          <Moon size={16} className="moon-icon" />
        )}
      </div>
      {showLabel && (
        <span className="theme-toggle-label">
          {theme === 'dark' ? 'Giao diện Tối' : 'Giao diện Sáng'}
        </span>
      )}
    </button>
  );
};
