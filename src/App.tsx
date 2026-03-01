import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

import LoginPage from './pages/LoginPage';
import RoleSelectPage from './pages/RoleSelectPage';

import SalesLayout from './pages/sales/SalesLayout';
import SalesHome from './pages/sales/SalesHome';
import NewOrderPage from './pages/sales/NewOrderPage';
import CartPage from './pages/sales/CartPage';
import MyOrdersPage from './pages/sales/MyOrdersPage';

import BillingLayout from './pages/billing/BillingLayout';
import DashboardPage from './pages/billing/DashboardPage';
import ReviewPage from './pages/billing/ReviewPage';
import HistoryPage from './pages/billing/HistoryPage';

import PickingLayout from './pages/picking/PickingLayout';
import QueuePage from './pages/picking/QueuePage';
import PickPage from './pages/picking/PickPage';

import AdminPage from './pages/admin/AdminPage';
import AdminPasscodePage from './pages/admin/AdminPasscodePage';
import UploadPage from './pages/admin/UploadPage';

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing',
  picking: '/picking',
  admin: '/admin',
};

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!role) return <Navigate to="/select-role" replace />;
  return <>{children}</>;
}

function RequireAdminUnlock({ children }: { children: React.ReactNode }) {
  const { role, adminUnlocked } = useAuth();
  if (role === 'admin' && !adminUnlocked) return <Navigate to="/admin-passcode" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role && ROLE_HOME[role]) return <Navigate to={ROLE_HOME[role]} replace />;
  return <Navigate to="/select-role" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/select-role"
        element={
          <RequireAuth>
            <RoleSelectPage />
          </RequireAuth>
        }
      />

      {/* Sales */}
      <Route
        path="/sales"
        element={
          <RequireRole>
            <SalesLayout />
          </RequireRole>
        }
      >
        <Route index element={<SalesHome />} />
        <Route path="new" element={<NewOrderPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="orders" element={<MyOrdersPage />} />
      </Route>

      {/* Billing */}
      <Route
        path="/billing"
        element={
          <RequireRole>
            <BillingLayout />
          </RequireRole>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>

      {/* Picking */}
      <Route
        path="/picking"
        element={
          <RequireRole>
            <PickingLayout />
          </RequireRole>
        }
      >
        <Route index element={<QueuePage />} />
        <Route path="pick" element={<PickPage />} />
      </Route>

      <Route
        path="/admin-passcode"
        element={
          <RequireAuth>
            <AdminPasscodePage />
          </RequireAuth>
        }
      />

      {/* Admin */}
      <Route
        path="/admin"
        element={
          <RequireRole>
            <RequireAdminUnlock>
              <AdminPage />
            </RequireAdminUnlock>
          </RequireRole>
        }
      />
      <Route
        path="/admin/upload"
        element={
          <RequireRole>
            <RequireAdminUnlock>
              <UploadPage />
            </RequireAdminUnlock>
          </RequireRole>
        }
      />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
