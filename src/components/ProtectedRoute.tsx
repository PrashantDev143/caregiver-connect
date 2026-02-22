import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRole?: 'caregiver' | 'patient';
}

export function ProtectedRoute({ children, allowedRole }: ProtectedRouteProps) {
  const { user, role, loading, initializing } = useAuth();
  const location = useLocation();

  if (initializing || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-muted-foreground">Checking your session...</p>
        </div>
      </div>
    );
  }

  if (!user || !role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRole && role !== allowedRole) {
    if (role === 'caregiver') {
      return <Navigate to="/caregiver/dashboard" replace />;
    }
    return <Navigate to="/patient/dashboard" replace />;
  }

  return <>{children}</>;
}
