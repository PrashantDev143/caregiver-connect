import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { stopAllAudioPlayback } from "@/lib/audioManager";

// Pages
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Login = lazy(() => import("./pages/auth/Login"));
const Signup = lazy(() => import("./pages/auth/Signup"));
const CaregiverDashboard = lazy(() => import("./pages/caregiver/Dashboard"));
const PatientsList = lazy(() => import("./pages/caregiver/PatientsList"));
const AddPatient = lazy(() => import("./pages/caregiver/AddPatient"));
const PatientDetails = lazy(() => import("./pages/caregiver/PatientDetails"));
const PatientDashboard = lazy(() => import("./pages/patient/Dashboard"));
const PatientStatus = lazy(() => import("./pages/patient/Status"));
const PatientGamePage = lazy(() => import("./pages/patient/Game"));

const queryClient = new QueryClient();

function RouteAudioCleanup() {
  const location = useLocation();

  useEffect(() => {
    stopAllAudioPlayback();
  }, [location.pathname]);

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RouteAudioCleanup />
          <Suspense fallback={null}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Caregiver routes */}
              <Route
                path="/caregiver/dashboard"
                element={
                  <ProtectedRoute allowedRole="caregiver">
                    <CaregiverDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/caregiver/patients"
                element={
                  <ProtectedRoute allowedRole="caregiver">
                    <PatientsList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/caregiver/patients/add"
                element={
                  <ProtectedRoute allowedRole="caregiver">
                    <AddPatient />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/caregiver/patient/:id"
                element={
                  <ProtectedRoute allowedRole="caregiver">
                    <PatientDetails />
                  </ProtectedRoute>
                }
              />

              {/* Patient routes */}
              <Route
                path="/patient/dashboard"
                element={
                  <ProtectedRoute allowedRole="patient">
                    <PatientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/patient/status"
                element={
                  <ProtectedRoute allowedRole="patient">
                    <PatientStatus />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/patient/game"
                element={
                  <ProtectedRoute allowedRole="patient">
                    <PatientGamePage />
                  </ProtectedRoute>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
