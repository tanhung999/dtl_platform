import { ContentTooltip } from './components/ContentTooltip';
import { authApi } from './features/auth/api';
import { lazy, Suspense, useState, useEffect } from 'react';
import { LoginPage } from './features/auth/LoginPage';
import { getStoredToken, getStoredUser, clearSession } from './services/api';
import { authStorageChanged } from './services/authStorage';
import { User, AuthSession } from './types';
import { ThemeProvider } from './context/ThemeContext';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { loginDestination } from './features/dashboard/navigation';
import { PageBranding } from './components/PageBranding';
import { PageLoading, PageLoadBoundary } from './components/PageLoading';
import { AccessDeniedPage, ApplicationConnectPage, SystemDevelopmentPage } from './features/apps/ApplicationStatusPages';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then(module => ({ default: module.DashboardPage })));

function CentralLogoutPage() {
  useEffect(() => {
    void authApi.logout().finally(() => {
      clearSession();
      window.location.replace('/login');
    });
  }, []);
  return <PageLoading startup />;
}

export function AppContent() {
  const location = useLocation(), navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(getStoredUser());
  const [hasToken, setHasToken] = useState<boolean>(Boolean(getStoredToken()));
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let reloading = false;
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setHasToken(false);
    };
    const handleOtherTab = (event: StorageEvent) => {
      if (!reloading && event.storageArea === localStorage && authStorageChanged(event)) {
        // The shared HttpOnly cookie may now belong to another user. Reload to
        // verify /me and discard the previous account's open forms and caches.
        reloading = true;
        window.location.reload();
      }
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    window.addEventListener('storage', handleOtherTab);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
      window.removeEventListener('storage', handleOtherTab);
    };
  }, []);

  // Bootstrap either the legacy bearer session or the new HttpOnly OIDC session.
  useEffect(() => {
    authApi.getMe()
      .then((user) => { setCurrentUser(user); setHasToken(true); })
      .catch(() => { if (!getStoredToken()) { setCurrentUser(null); setHasToken(false); } })
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLoginSuccess = (session: AuthSession) => {
    setCurrentUser(session.user);
    setHasToken(true);
  };

  const handleLogout = () => {
    void authApi.logout().then(() => {
      clearSession();
      setCurrentUser(null);
      setHasToken(false);
      navigate('/login', { replace: true, state: null });
    }).catch(() => {
      clearSession();
      setCurrentUser(null);
      setHasToken(false);
      navigate('/login', { replace: true, state: null });
    });
  };

  const handleUserUpdated = (updatedUser: User) => {
    setCurrentUser(updatedUser);
  };

  if (checkingSession) return <PageLoading startup />;

  if (!hasToken || !currentUser) {
    return <><PageBranding /><Routes>
      <Route path="/login" element={<LoginPage onLoginSuccess={handleLoginSuccess} />} />
      <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />} />
    </Routes></>;
  }

  return (
    <Routes><Route path="/login" element={<Navigate to={loginDestination(location.state?.from)} replace />} />
    <Route path="/logout" element={<CentralLogoutPage />} />
    <Route path="/applications/connect" element={<ApplicationConnectPage />} />
    <Route path="/access-denied" element={<AccessDeniedPage />} />
    <Route path="/system-development" element={<SystemDevelopmentPage />} />
    <Route path="/*" element={<PageLoadBoundary><Suspense fallback={<PageLoading startup />}><DashboardPage
      user={currentUser}
      onUserUpdated={handleUserUpdated}
      onLogout={handleLogout}
    /></Suspense></PageLoadBoundary>} /></Routes>
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
