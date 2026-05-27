import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePartnerCompanies } from '../../hooks/usePartnerCompanies';
import { SupplyDemandSkuDetailView } from '../../components/supply/SupplyDemandSkuDetailView';

export default function PartnerSupplySkuDetailPage(): React.JSX.Element {
  const { partnerCompanyId } = useAuth();
  const { data: companies = [] } = usePartnerCompanies();
  const [searchParams] = useSearchParams();
  const partner = companies.find((c) => c.id === partnerCompanyId) ?? null;

  const backParams = new URLSearchParams(searchParams);
  backParams.set('tab', 'sku');
  backParams.delete('fromTab');
  const backPath = `/partner/supply?${backParams.toString()}`;

  return (
    <SupplyDemandSkuDetailView
      mode="partner"
      brandKeys={partner?.brand_keys}
      backPath={backPath}
    />
  );
}
