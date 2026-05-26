import { useParams, useNavigate } from 'react-router-dom';
import { PickFlowPanel } from './PickFlowPanel';

export default function PickPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const orderId = id ? parseInt(id, 10) : null;

  if (!orderId || !Number.isFinite(orderId)) {
    navigate('/picking');
    return null;
  }

  return (
    <PickFlowPanel
      orderId={orderId}
      mode="production"
      onBack={() => navigate('/picking')}
    />
  );
}
