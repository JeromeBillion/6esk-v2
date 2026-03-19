import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './components/AppShell';
import { SupportWorkspace } from './pages/SupportWorkspace';
import { MailWorkspace } from './pages/MailWorkspace';
import { AnalyticsWorkspace } from './pages/AnalyticsWorkspace';

const Root = () => (
  <AppShell>
    <SupportWorkspace />
  </AppShell>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/support" replace />,
  },
  {
    path: '/support',
    element: <Root />,
  },
  {
    path: '/mail',
    element: (
      <AppShell>
        <MailWorkspace />
      </AppShell>
    ),
  },
  {
    path: '/analytics',
    element: (
      <AppShell>
        <AnalyticsWorkspace />
      </AppShell>
    ),
  },
  {
    path: '/admin',
    element: (
      <AppShell>
        <div className="flex items-center justify-center h-full">
          <p className="text-neutral-600">Admin module coming soon...</p>
        </div>
      </AppShell>
    ),
  },
]);