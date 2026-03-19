import { Link, useLocation } from 'react-router';
import { Ticket, Mail, BarChart3, Settings } from 'lucide-react';
import { cn } from '../components/ui/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  
  const navigation = [
    { name: 'Support', href: '/support', icon: Ticket },
    { name: 'Mail', href: '/mail', icon: Mail },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Admin', href: '/admin', icon: Settings },
  ];

  return (
    <div className="h-screen flex bg-neutral-50">
      {/* Sidebar */}
      <div className="w-16 bg-white border-r border-neutral-200 flex flex-col items-center py-4 gap-2">
        {/* Logo */}
        <div className="mb-6 w-10 h-10 rounded-lg bg-neutral-900 flex items-center justify-center text-white font-semibold text-sm">
          6E
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1 w-full px-2">
          {navigation.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  'flex flex-col items-center justify-center h-12 rounded-lg transition-colors',
                  isActive
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                )}
                title={item.name}
              >
                <item.icon className="w-5 h-5" />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
