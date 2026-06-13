import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ImpersonationBanner } from './components/layout/ImpersonationBanner';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const ActivatePage = lazy(() => import('./pages/auth/ActivatePage'));
const GetStartedPage = lazy(() => import('./pages/auth/GetStartedPage'));
const RoleSelectPage = lazy(() => import('./pages/RoleSelectPage'));

const SalesLayout = lazy(() => import('./pages/sales/SalesLayout'));
const SalesHome = lazy(() => import('./pages/sales/SalesHome'));
const NewOrderPage = lazy(() => import('./pages/sales/NewOrderPage'));
const CartPage = lazy(() => import('./pages/sales/CartPage'));
const MyOrdersPage = lazy(() => import('./pages/sales/MyOrdersPage'));
const PendingRecoveryPage = lazy(() => import('./pages/sales/PendingRecoveryPage'));

const BillingLayout = lazy(() => import('./pages/billing/BillingLayout'));
const DashboardPage = lazy(() => import('./pages/billing/DashboardPage'));
const NeedsReviewPage = lazy(() => import('./pages/billing/NeedsReviewPage'));
const ReviewPage = lazy(() => import('./pages/billing/ReviewPage'));
const HistoryPage = lazy(() => import('./pages/billing/HistoryPage'));
const RejectedPage = lazy(() => import('./pages/billing/RejectedPage'));
const PendingPage = lazy(() => import('./pages/billing/PendingPage'));
const LiveQueuePage = lazy(() => import('./pages/billing/LiveQueuePage'));
const BillingDeskPage = lazy(() => import('./pages/billing/BillingDeskPage'));
const CompactQueuePage = lazy(() => import('./pages/billing/CompactQueuePage'));
const BillingNewOrderLayout = lazy(() => import('./pages/billing/BillingNewOrderLayout'));
const OfflinePickConflictsPage = lazy(() => import('./pages/billing/OfflinePickConflictsPage'));

const PickingLayout = lazy(() =>
  import('./pages/picking/PickingLayout').then((module) => {
    // Start QueuePage chunk in parallel so /picking doesn't wait on two serial lazy loads.
    void import('./pages/picking/QueuePage');
    return module;
  }),
);
const QueuePage = lazy(() => import('./pages/picking/QueuePage'));
const PickPage = lazy(() => import('./pages/picking/PickPage'));
const PickPreviewPage = lazy(() => import('./pages/picking/PickPreviewPage'));
const PickFinalisePage = lazy(() => import('./pages/picking/PickFinalisePage'));
const ActivePicksPage = lazy(() => import('./pages/picking/ActivePicksPage'));

const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'));
const AdminPasscodePage = lazy(() => import('./pages/admin/AdminPasscodePage'));
const UploadPage = lazy(() => import('./pages/admin/UploadPage'));
const LabelStudioPage = lazy(() => import('./pages/admin/LabelStudioPage'));
const PackCatalogPage = lazy(() => import('./pages/admin/PackCatalogPage'));
const ParetoLabelPrintPage = lazy(() => import('./pages/admin/ParetoLabelPrintPage'));
const StockAuditLabelPrintPage = lazy(() => import('./pages/admin/StockAuditLabelPrintPage'));
const CycleCountPage = lazy(() => import('./pages/admin/CycleCountPage'));
const PickScanLabPage = lazy(() => import('./pages/admin/PickScanLabPage'));
const PickerUxLabPage = lazy(() => import('./pages/admin/PickerUxLabPage'));
const OcrOrderLabPage = lazy(() => import('./pages/admin/OcrOrderLabPage'));
const SupplyDemandPage = lazy(() => import('./pages/admin/SupplyDemandPage'));
const SupplyDemandSkuDetailPage = lazy(() => import('./pages/admin/SupplyDemandSkuDetailPage'));
const BarcodeMappingPage = lazy(() => import('./pages/admin/BarcodeMappingPage'));
const UomOnboardingPage = lazy(() => import('./pages/admin/UomOnboardingPage'));
const BinOnboardingPage = lazy(() => import('./pages/admin/BinOnboardingPage'));
const ProcessChallanPage = lazy(() => import('./pages/admin/ProcessChallanPage'));
const ReceivingJobsPage = lazy(() => import('./pages/admin/receiving/ReceivingJobsPage'));
const ReceivingJobDetailPage = lazy(() => import('./pages/admin/receiving/ReceivingJobDetailPage'));
const PurchaseHomePage = lazy(() => import('./pages/purchase/PurchaseHomePage'));
const PurchaseNewPoPage = lazy(() => import('./pages/purchase/PurchaseNewPoPage'));
const PurchasePoDetailPage = lazy(() => import('./pages/purchase/PurchasePoDetailPage'));
const PurchaseInvoiceReviewPage = lazy(() => import('./pages/purchase/PurchaseInvoiceReviewPage'));
const PurchaseInvoiceNewPage = lazy(() => import('./pages/purchase/PurchaseInvoiceNewPage'));
const PartnerLayout = lazy(() => import('./pages/partner/PartnerLayout'));
const PartnerSupplyPage = lazy(() => import('./pages/partner/PartnerSupplyPage'));
const PartnerSupplySkuDetailPage = lazy(() => import('./pages/partner/PartnerSupplySkuDetailPage'));

const ROLE_HOME: Record<string, string> = {
  sales: '/sales',
  billing: '/billing/queue',
  picking: '/picking',
  admin: '/admin',
  partner: '/partner/supply',
};

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireRole({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, role, actualRole } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!role && actualRole !== 'admin') return <Navigate to="/select-role" replace />;
  return <>{children}</>;
}

function RequireAdminUnlock({ children }: { children: React.ReactNode }) {
  const { role, adminUnlocked } = useAuth();
  if (role === 'admin' && !adminUnlocked) return <Navigate to="/admin-passcode" replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { isAuthenticated, role, authMode } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (authMode === 'supabase' && role && ROLE_HOME[role]) {
    return <Navigate to={ROLE_HOME[role]} replace />;
  }
  if (role && ROLE_HOME[role]) return <Navigate to={ROLE_HOME[role]} replace />;
  return <Navigate to="/select-role" replace />;
}

function RequirePartnerRole({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (role !== 'partner') return <Navigate to="/select-role" replace />;
  return <>{children}</>;
}

export default function App(): React.JSX.Element | null {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] text-[var(--content-secondary)]">
          Loading…
        </div>
      }
    >
      <ImpersonationBanner />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/get-started" element={<GetStartedPage />} />
        <Route path="/activate" element={<ActivatePage />} />
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
          <Route path="pending-recovery" element={<PendingRecoveryPage />} />
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
          <Route path="queue" element={<LiveQueuePage />} />
          <Route path="desk" element={<BillingDeskPage />} />
          <Route path="needs-review" element={<NeedsReviewPage />} />
          <Route path="pending" element={<PendingPage />} />
          <Route path="rejected" element={<RejectedPage />} />
          <Route path="review/:id" element={<ReviewPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="offline-picks" element={<OfflinePickConflictsPage />} />
          <Route path="new-order" element={<BillingNewOrderLayout />}>
            <Route index element={<Navigate to="items" replace />} />
            <Route path="items" element={<NewOrderPage />} />
            <Route path="cart" element={<CartPage />} />
          </Route>
        </Route>

        {/* Compact Companion — no layout chrome */}
        <Route
          path="/billing/compact"
          element={
            <RequireRole>
              <CompactQueuePage />
            </RequireRole>
          }
        />

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
          <Route path="active" element={<ActivePicksPage />} />
          <Route path="barcode-mapping" element={<BarcodeMappingPage />} />
          <Route path="pick/:id" element={<PickPage />} />
          <Route path="pick/:id/finish" element={<PickFinalisePage />} />
          <Route path="preview/:id" element={<PickPreviewPage />} />
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
          path="/admin/users"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <UserManagementPage />
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
        <Route
          path="/admin/pack-catalog"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PackCatalogPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/pareto-labels"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <ParetoLabelPrintPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/stock-audit-labels"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <StockAuditLabelPrintPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/labels"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <LabelStudioPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/cycle-count"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <CycleCountPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/barcode-mapping/import"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <ProcessChallanPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/barcode-mapping"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <BarcodeMappingPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/uom-onboarding"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <UomOnboardingPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/bin-onboarding"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <BinOnboardingPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/pick-scan-lab"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PickScanLabPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/picker-ux-lab"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PickerUxLabPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/ocr-lab"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <OcrOrderLabPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/supply"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <SupplyDemandPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/supply/sku/:itemId"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <SupplyDemandSkuDetailPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/receiving"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <ReceivingJobsPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/admin/receiving/:jobId"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <ReceivingJobDetailPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />

        {/* Purchase — PO Excel, invoice OCR, receiving handoff */}
        <Route
          path="/purchase"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PurchaseHomePage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/purchase/new"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PurchaseNewPoPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/purchase/invoice/new"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PurchaseInvoiceNewPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/purchase/po/:poId"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PurchasePoDetailPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />
        <Route
          path="/purchase/po/:poId/invoice"
          element={
            <RequireRole>
              <RequireAdminUnlock>
                <PurchaseInvoiceReviewPage />
              </RequireAdminUnlock>
            </RequireRole>
          }
        />

        {/* Partner (OEM company rep) */}
        <Route
          path="/partner"
          element={
            <RequireRole>
              <RequirePartnerRole>
                <PartnerLayout />
              </RequirePartnerRole>
            </RequireRole>
          }
        >
          <Route path="supply" element={<PartnerSupplyPage />} />
          <Route path="supply/sku/:itemId" element={<PartnerSupplySkuDetailPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
