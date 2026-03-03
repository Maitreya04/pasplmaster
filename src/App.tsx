import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RoleSelectPage = lazy(() => import('./pages/RoleSelectPage'));

const SalesLayout = lazy(() => import('./pages/sales/SalesLayout'));
const SalesHome = lazy(() => import('./pages/sales/SalesHome'));
const NewOrderPage = lazy(() => import('./pages/sales/NewOrderPage'));
const CartPage = lazy(() => import('./pages/sales/CartPage'));
const MyOrdersPage = lazy(() => import('./pages/sales/MyOrdersPage'));

const BillingLayout = lazy(() => import('./pages/billing/BillingLayout'));
const DashboardPage = lazy(() => import('./pages/billing/DashboardPage'));
const NeedsReviewPage = lazy(() => import('./pages/billing/NeedsReviewPage'));
const ReviewPage = lazy(() => import('./pages/billing/ReviewPage'));
const HistoryPage = lazy(() => import('./pages/billing/HistoryPage'));
const PendingPage = lazy(() => import('./pages/billing/PendingPage'));

const PickingLayout = lazy(() => import('./pages/picking/PickingLayout'));
const QueuePage = lazy(() => import('./pages/picking/QueuePage'));
const PickPage = lazy(() => import('./pages/picking/PickPage'));

const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const AdminPasscodePage = lazy(() => import('./pages/admin/AdminPasscodePage'));
const UploadPage = lazy(() => import('./pages/admin/UploadPage'));

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
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--content-secondary)]">
          Loading…
        </div>
      }
    >
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
          <Route path="needs-review" element={<NeedsReviewPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="review/:id" element={<ReviewPage />} />
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
          <Route path="pick/:id" element={<PickPage />} />
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
    </Suspense>
  );
}
