
# Caregiver-Patient Geofencing Safety System

## Project Overview
A full-stack web application enabling caregivers to monitor patient locations in real-time, set up geofenced safe zones, and receive automatic alerts when patients leave designated areas.

---

## 🔐 Phase 1: Authentication & Security Foundation

### Supabase Setup
- Configure Supabase backend with Lovable Cloud
- Create secure database schema with proper Row-Level Security (RLS)
- Use a **separate user_roles table** (security best practice)

### Database Tables
- **users** - Core user info (id, email, name, timestamps)
- **user_roles** - Role assignments (caregiver/patient) with secure lookup function
- **caregivers** - Caregiver profiles linked to auth users
- **patients** - Patient profiles with caregiver assignment
- **geofences** - Safe zone definitions (lat, lng, radius)
- **location_logs** - Patient location history
- **alerts** - Geofence breach notifications

### Auth Features
- **Signup page**: Email, password, name, role selection
- **Login page**: Email/password with role-based redirect
- **Protected routes**: Automatic redirect for unauthorized access
- **Session management**: Persistent auth state across refreshes

---

## 👨‍⚕️ Phase 2: Caregiver Dashboard

### Routes & Pages
- `/caregiver/dashboard` - Overview with patient summary cards
- `/caregiver/patients` - Full patient list with search
- `/caregiver/patients/add` - Add new patients by email
- `/caregiver/patient/:id` - Individual patient details

### Features
- **Patient Management**: Add patients to care list, view all assigned patients
- **Geofence Configuration**: 
  - Interactive map to set home location
  - Adjustable radius (meters) with visual preview
  - Save/update geofence settings
- **Real-time Monitoring**:
  - Live patient location on map (Leaflet/OpenStreetMap)
  - Alert status indicators (safe/warning)
  - Location history timeline
- **Notifications**: Visual alerts when patients leave safe zones

---

## 🧑 Phase 3: Patient Dashboard

### Routes & Pages
- `/patient/dashboard` - Main status view
- `/patient/status` - Detailed geofence status

### Features
- **Location Sharing**:
  - Simulated location updates (with manual controls for demo)
  - Automatic logging to database
- **Safety Status Display**:
  - Map showing current position vs. geofence
  - Clear "SAFE" / "WARNING" indicator
  - Distance from home display
- **Alert History**: View past geofence breaches

---

## 🗺️ Phase 4: Geofencing Logic

### Core Functionality
- **Haversine Distance Formula**: Accurate distance calculation between coordinates
- **Geofence Breach Detection**: 
  - Compare patient distance vs. allowed radius
  - Trigger alerts only on state change (inside → outside)
- **Alert Management**:
  - Create alert record on breach
  - Auto-resolve when patient returns to safe zone

---

## 🔄 Phase 5: Real-time Updates

### Supabase Realtime Integration
- **Live Location Channel**: Stream patient positions to caregiver map
- **Alert Notifications**: Instant breach notifications
- **Connection Status**: Visual indicator for real-time connection health

---

## 🎨 Design & UX

### Visual Style
- Clean & professional healthcare aesthetic
- Blue/teal color palette with green for "safe" and red for warnings
- Card-based layouts with clear information hierarchy
- Consistent navigation sidebar

### Responsive Design
- Fully responsive layout for desktop and mobile
- Touch-friendly controls for mobile users
- Adaptive map sizing

---

## 📁 Project Structure
```
/src
  /auth          → Login, Signup, Protected Route
  /caregiver     → Caregiver-specific pages
  /patient       → Patient-specific pages
  /components    → Shared UI components
  /services      → Supabase client & API functions
  /utils         → Distance calculations, helpers
  /context       → Auth context provider
  /hooks         → Custom React hooks
```

---

## 🚀 Extensibility (Placeholder Routes)
Ready-to-expand structure for:
- Emergency SOS button
- Medical history
- Reports & analytics
- Caregiver messaging

---

## ✅ Quality Assurance
- Proper error handling with user-friendly messages
- Loading states for all async operations
- Clean, commented code
- End-to-end testable functionality
