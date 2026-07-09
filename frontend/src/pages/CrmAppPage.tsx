import { useEffect } from 'react';
import { CrmLayout } from '../components/crm/CrmLayout';

const MOCK_IS_AUTHORIZED = true;

export function CrmAppPage() {
  useEffect(() => {
    if (!MOCK_IS_AUTHORIZED) {
      window.location.href = '/';
    }
  }, []);

  if (!MOCK_IS_AUTHORIZED) {
    return null;
  }

  return <CrmLayout />;
}