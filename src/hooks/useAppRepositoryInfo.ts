import { useEffect, useState } from 'react';
import { api } from '../utils/api';

export type AppRepositoryInfo = {
  displayName: string;
  owner: string;
  repo: string;
  repositoryUrl: string;
};

type AppRepositoryResponse = {
  success: boolean;
  remoteUrl: string | null;
  repository: AppRepositoryInfo | null;
};

export function useAppRepositoryInfo() {
  const [repository, setRepository] = useState<AppRepositoryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadRepository = async () => {
      try {
        const response = await api.settings.appRepository();
        if (!response.ok) {
          throw new Error(`Failed to load repository info: ${response.status}`);
        }

        const data = (await response.json()) as AppRepositoryResponse;
        if (!cancelled) {
          setRepository(data.repository ?? null);
        }
      } catch {
        if (!cancelled) {
          setRepository(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRepository();

    return () => {
      cancelled = true;
    };
  }, []);

  return { repository, isLoading };
}
