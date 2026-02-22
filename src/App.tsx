import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Pages
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import CaregiverDashboard from "./pages/caregiver/Dashboard";
import PatientsList from "./pages/caregiver/PatientsList";
import AddPatient from "./pages/caregiver/AddPatient";
import PatientDetails from "./pages/caregiver/PatientDetails";
import PatientDashboard from "./pages/patient/Dashboard";
import PatientStatus from "./pages/patient/Status";
import PatientGamePage from "./pages/patient/Game";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
