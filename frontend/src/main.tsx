import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { AppShell, navigate, useRoute } from './components/AppShell';
import { AppProvider } from './contexts/AppContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AgentSetup } from './pages/AgentSetup/AgentSetup';
import { Login } from './pages/Auth/Login';
import { Dashboard } from './pages/Dashboard/Dashboard';
import { Devices } from './pages/Devices/Devices';
import { DeviceBackups } from './pages/DeviceBackups/DeviceBackups';
import { Browse } from './pages/Browse/Browse';
import { Restore } from './pages/Restore/Restore';
import { Groups } from './pages/Groups/Groups';
import { Settings } from './pages/Settings/Settings';
import { Notifications } from './pages/Notifications/Notifications';
import './styles/index.css';

function App() {
  const route = useRoute();
  const { role } = useAuth();
  useEffect(() => {
    if (role === 'admin' && (route === 'login' || route === 'setup')) navigate('/');
  }, [role, route]);

  if (!role) return <Login />;
  if (role === 'user') return <AgentSetup />;
  if (route === 'login' || route === 'setup') return null;

  const page = {
    dashboard: <Dashboard />,
    devices: <Devices />,
    backups: <DeviceBackups />,
    browse: <Browse />,
    restore: <Restore />,
    groups: <Groups />,
    notifications: <Notifications />,
    settings: <Settings />,
  }[route];
  return <AppShell route={route}>{page}</AppShell>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider><AuthProvider><ToastProvider><App /></ToastProvider></AuthProvider></AppProvider>
  </React.StrictMode>,
);
