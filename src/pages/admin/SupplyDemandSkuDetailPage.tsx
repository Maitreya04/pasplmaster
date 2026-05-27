import { useSearchParams } from 'react-router-dom';
import { demandLocationFilterParam, parseDemandLocationFilter } from '../../lib/purchase/openPoDemand';
import { cleanDateParam } from '../../lib/purchase/supplyDemandFilters';
import { SupplyDemandSkuDetailView } from '../../components/supply/SupplyDemandSkuDetailView';

export default function SupplyDemandSkuDetailPage(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const legacyDate = cleanDateParam(searchParams.get('date'));
  const selectedDateFrom = cleanDateParam(searchParams.get('from')) || legacyDate;
  const selectedDateTo = cleanDateParam(searchParams.get('to')) || legacyDate;
  const locationFilter = parseDemandLocationFilter(searchParams.get('warehouse'));
  const fromTab = searchParams.get('fromTab') === 'sku' ? 'sku' : 'brand';

  const backParams = new URLSearchParams();
  backParams.set('tab', fromTab);
  if (selectedDateFrom) backParams.set('from', selectedDateFrom);
  if (selectedDateTo) backParams.set('to', selectedDateTo);
  const warehouse = demandLocationFilterParam(locationFilter);
  if (warehouse) backParams.set('warehouse', warehouse);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <SupplyDemandSkuDetailView
        mode="admin"
        backPath={`/admin/supply?${backParams.toString()}`}
      />
    </div>
  );
}
