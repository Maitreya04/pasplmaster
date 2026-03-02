import { Link } from 'react-router-dom';
import { PlusCircle, ListBullets } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useSalesDashboard } from '../../hooks/useSalesDashboard';
import { Card, Skeleton } from '../../components/shared';
import type { Order } from '../../types';

function formatLakhs(n: number): string {
  if (n >= 100) return `${(n / 100).toFixed(1)}Cr`;
  return `${n.toFixed(1)}L`;
}

function formatCurrency(n: number): string {
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function todayFormatted(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function CircularProgress({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const r = 45;
  const c = 2 * Math.PI * r;
  const stroke = (clamped / 100) * c;

  return (
    <svg viewBox="0 0 100 100" className="w-32 h-32 -rotate-90">
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="var(--navy-800)"
        strokeWidth="8"
      />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="8"
        strokeDasharray={`${stroke} ${c}`}
        strokeLinecap="round"
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

function HeroCard({
  annualTargetLakhs,
  fyAchievement,
  monthlyTargetLakhs,
  isLoading,
}: {
  annualTargetLakhs: number;
  fyAchievement: number;
  monthlyTargetLakhs: number;
  isLoading: boolean;
}) {
  const targetRupees = annualTargetLakhs * 100000;
  const pct = targetRupees > 0 ? (fyAchievement / targetRupees) * 100 : 0;
  const achievedLakhs = fyAchievement / 100000;

  if (isLoading) {
    return (
      <Card className="bg-[var(--navy-900)] border border-[var(--navy-700)]">
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-32 h-32 rounded-full bg-[var(--navy-800)] animate-pulse" />
          <div className="space-y-2 w-40">
            <div className="h-4 rounded-xl bg-[var(--navy-800)] animate-pulse" />
            <div className="h-3 rounded-xl bg-[var(--navy-800)] animate-pulse w-3/4 mx-auto" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-[var(--navy-900)] border border-[var(--navy-700)]">
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="relative">
          <CircularProgress pct={pct} />
          <span className="absolute inset-0 flex items-center justify-center font-mono text-2xl font-bold text-white">
            {pct.toFixed(0)}%
          </span>
        </div>
        <div className="text-center">
          <p className="font-mono text-white text-sm">
            ₹{formatLakhs(achievedLakhs)} of ₹{formatLakhs(annualTargetLakhs)}
          </p>
          <p className="text-[var(--navy-400)] text-xs mt-0.5">
            Monthly target: ₹{formatLakhs(monthlyTargetLakhs)}
          </p>
        </div>
      </div>
    </Card>
  );
}

function ThisMonthCard({
  orders,
  value,
  monthlyTargetLakhs,
  isLoading,
}: {
  orders: number;
  value: number;
  monthlyTargetLakhs: number;
  isLoading: boolean;
}) {
  const monthlyTargetRupees = monthlyTargetLakhs * 100000;
  const pct = monthlyTargetRupees > 0 ? (value / monthlyTargetRupees) * 100 : 0;

  if (isLoading) {
    return (
      <Card>
        <Skeleton variant="text" lines={4} />
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-[var(--content-secondary)] mb-3">This Month</h3>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xl font-bold text-white">{orders}</p>
          <p className="text-xs text-[var(--navy-400)]">orders</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-xs mb-1">
            <span className="font-mono text-[var(--content-secondary)]">
              {formatCurrency(value)}
            </span>
            <span className="font-mono text-[var(--navy-400)]">
              of ₹{formatLakhs(monthlyTargetLakhs)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--navy-800)] overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ProductGroupBar({
  group,
  target,
  achieved,
}: {
  group: string;
  target: number;
  achieved: number;
}) {
  const targetRupees = target * 100000;
  const pct = targetRupees > 0 ? (achieved / targetRupees) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-sm text-[var(--content-primary)] truncate">{group}</span>
        <span className="font-mono text-xs text-[var(--navy-400)] shrink-0">
          ₹{formatLakhs(target)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--navy-800)] overflow-hidden">
        <div
          className="h-full bg-white rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function RecentOrderCard({ order }: { order: Order }) {
  return (
    <Link to={`/sales/orders`}>
      <Card pressable className="py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-[var(--navy-300)]">{order.order_number}</span>
          <span className="text-xs text-[var(--navy-400)]">{formatTimeAgo(order.created_at)}</span>
        </div>
        <p className="font-medium text-white truncate mt-0.5">{order.customer_name}</p>
        <p className="font-mono text-xs text-[var(--content-secondary)] mt-0.5">
          {order.item_count} items · {formatCurrency(order.total_value)}
        </p>
      </Card>
    </Link>
  );
}

export default function SalesHome() {
  const { userName } = useAuth();
  const { data, isLoading } = useSalesDashboard(userName);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--content-primary)]">
      <div className="p-4 pb-6 space-y-6">
        {/* Top: Greeting + date */}
        <header>
          <h1 className="text-2xl font-bold text-white">
            Hey, {userName ?? 'there'}
          </h1>
          <p className="text-sm text-[var(--navy-400)] mt-0.5">{todayFormatted()}</p>
        </header>

        {/* Hero: Annual target ring */}
        <HeroCard
          annualTargetLakhs={data?.annualTargetLakhs ?? 0}
          fyAchievement={data?.fyAchievement ?? 0}
          monthlyTargetLakhs={data?.monthlyTargetLakhs ?? 0}
          isLoading={isLoading}
        />

        {/* This Month */}
        <ThisMonthCard
          orders={data?.thisMonthOrders ?? 0}
          value={data?.thisMonthValue ?? 0}
          monthlyTargetLakhs={data?.monthlyTargetLakhs ?? 0}
          isLoading={isLoading}
        />

        {/* Top 5 product groups */}
        {data && data.topProductGroups.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--content-secondary)] mb-3">
              Top 5 product groups
            </h2>
            <Card>
              <div className="space-y-4">
                {data.topProductGroups.map((pg) => (
                  <ProductGroupBar
                    key={pg.product_group}
                    group={pg.product_group}
                    target={pg.annual_target_lakhs}
                    achieved={pg.achieved}
                  />
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--content-secondary)] mb-3">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/sales/new">
              <Card pressable className="flex items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--role-primary-subtle)] flex items-center justify-center">
                  <PlusCircle size={24} weight="duotone" className="text-[var(--role-content)]" />
                </div>
                <span className="font-semibold text-white">New Order</span>
              </Card>
            </Link>
            <Link to="/sales/orders">
              <Card pressable className="flex items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--role-primary-subtle)] flex items-center justify-center">
                  <ListBullets size={24} weight="duotone" className="text-[var(--role-content)]" />
                </div>
                <span className="font-semibold text-white">My Orders</span>
              </Card>
            </Link>
          </div>
        </div>

        {/* Recent orders */}
        <div>
          <h2 className="text-sm font-semibold text-[var(--content-secondary)] mb-3">
            Recent orders
          </h2>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton variant="text" lines={3} />
              <Skeleton variant="text" lines={3} />
              <Skeleton variant="text" lines={3} />
            </div>
          ) : data?.recentOrders?.length ? (
            <div className="space-y-2">
              {data.recentOrders.map((order) => (
                <RecentOrderCard key={order.id} order={order} />
              ))}
            </div>
          ) : (
            <Card>
              <p className="text-sm text-[var(--navy-400)]">No orders yet</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
