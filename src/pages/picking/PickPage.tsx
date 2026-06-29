import { useParams, useNavigate } from 'react-router-dom';
import { PickFlowExperience } from '../../features/picking/PickFlowExperience';

export default function PickPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const orderId = id ? parseInt(id, 10) : null;

  if (!orderId || !Number.isFinite(orderId)) {
    navigate('/picking');
    return null;
  }

  return (
    <PickFlowExperience
      orderId={orderId}
      mode="production"
      onBack={() => navigate('/picking')}
      onFinish={() =>
        navigate(`/picking/pick/${id}/finish`, { state: { expectAllDone: true } })
      }
    />
  );
}
