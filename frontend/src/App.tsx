import { ContentTooltip } from './components/ContentTooltip';
import { authApi } from './features/auth/api';
import { useState, useEffect } from 'react';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { getStoredToken, getStoredUser, clearSession } from './services/api';
import { User, AuthSession } from './types';
import { ThemeProvider } from './context/ThemeContext';

export function AppContent() {
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser());
  const [hasToken, setHasToken] = useState<boolean>(Boolean(getStoredToken()));

  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setHasToken(false);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  // Fetch full user profile on mount if token exists
  useEffect(() => {
    if (hasToken) {
      authApi.getMe()
        .then((user) => setCurrentUser(user))
        .catch(() => {
          // Token might be invalid or expired
        });
    }
  }, [hasToken]);

  const handleLoginSuccess = (session: AuthSession) => {
    setCurrentUser(session.user);
    setHasToken(true);
  };

  const handleLogout = () => {
    clearSession();
    setCurrentUser(null);
    setHasToken(false);
  };

  const handleUserUpdated = (updatedUser: User) => {
    setCurrentUser(updatedUser);
  };

  if (!hasToken || !currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <DashboardPage
      user={currentUser}
      onUserUpdated={handleUserUpdated}
      onLogout={handleLogout}
    />
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AppContent />
      <ContentTooltip />
    </ThemeProvider>
  );
}

export default App;
