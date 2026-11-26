import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const alertSettingsKey = ['alert-settings'] as const;

export function useAlertSettings() {
  return useQuery({ queryKey: alertSettingsKey, queryFn: api.getAlertSettings });
}

/** Saves the address (null clears it). The server's answer replaces the cached settings. */
export function useSaveAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string | null) => api.saveAlertSettings(email),
    onSuccess: (data) => qc.setQueryData(alertSettingsKey, data),
  });
}

export function useSendTestEmail() {
  return useMutation({ mutationFn: () => api.sendTestAlert() });
}
