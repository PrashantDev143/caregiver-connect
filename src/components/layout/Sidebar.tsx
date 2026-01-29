import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  MapPin,
  Bell,
  LogOut,
  Shield,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export function Sidebar() {
  const { role, signOut, user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const caregiverNavItems: NavItem[] = [
    { label: 'Dashboard', href: '/caregiver/dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
    { label: 'Patients', href: '/caregiver/patients', icon: <Users className="h-5 w-5" /> },
    { label: 'Add Patient', href: '/caregiver/patients/add', icon: <UserPlus className="h-5 w-5" /> },
  ];

  const patientNavItems: NavItem[] = [
    { label: 'Dashboard', href: '/patient/dashboard', icon: <LayoutDashboard className="h-5 w-5" /> },
    { label: 'My Status', href: '/patient/status', icon: <MapPin className="h-5 w-5" /> },
  ];

  const navItems = role === 'caregiver' ? caregiverNavItems : patientNavItems;

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-4 top-4 z-50 rounded-lg bg-card p-2 shadow-md lg:hidden"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r bg-card transition-transform lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <Shield className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold">SafeZone</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setIsOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                location.pathname === item.href
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User info & logout */}
        <div className="border-t p-4">
          <div className="mb-3 rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate text-sm font-medium">{user?.email}</p>
            <p className="text-xs capitalize text-muted-foreground">{role}</p>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  );
}
