import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/api/genieacs`,
  timeout: 35000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

export interface BaicellsRadio {
  id:           string;
  serial:       string;
  lastInform:   string | null;
  ip:           string;
  rfStatus:     'on' | 'off' | 'offline';
  mcc:          string;
  mnc:          string;
  tac:          string;
  mmeIp:        string;
  bandwidthMhz: string;
  earfcn:       string;
  cellId:       string;
  pci:          string;
  band:         string;
}

export interface ProvisionInput {
  mcc: string; mnc: string; tac: number; mmeIp: string;
  bandwidthMhz: number; earfcn: number; cellId: number; pci: number; band: number;
}

export interface NbiTask {
  url:  string;
  body: Record<string, any>;
}

export interface RadioBackup {
  filename: string;
  deviceId: string;
}

export const genieacsApi = {
  getDevices: async (): Promise<BaicellsRadio[]> => {
    const { data } = await api.get('/devices');
    return data.devices;
  },

  preview: async (deviceId: string, input: ProvisionInput): Promise<{ deviceId: string; tasks: NbiTask[] }> => {
    const { data } = await api.post(`/preview/${encodeURIComponent(deviceId)}`, input);
    return data;
  },

  executeTasks: async (deviceId: string, tasks: NbiTask[]): Promise<{ success: boolean; results: any[] }> => {
    const { data } = await api.post('/execute-tasks', { deviceId, tasks });
    return data;
  },

  forceRefresh: async (deviceId: string): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post(`/refresh/${encodeURIComponent(deviceId)}`);
    return data;
  },

  reboot: async (deviceId: string): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post(`/reboot/${encodeURIComponent(deviceId)}`);
    return data;
  },

  rebootAll: async (): Promise<{ success: boolean; rebooted: number; failures: string[] }> => {
    const { data } = await api.post('/reboot-all');
    return data;
  },

  setRf: async (deviceId: string, enable: boolean): Promise<{ success: boolean; message: string }> => {
    const { data } = await api.post(`/rf/${encodeURIComponent(deviceId)}`, { enable });
    return data;
  },

  setRfAll: async (enable: boolean): Promise<{ success: boolean; affected: number; failures: string[] }> => {
    const { data } = await api.post('/rf-all', { enable });
    return data;
  },

  listBackups: async (deviceId: string): Promise<RadioBackup[]> => {
    const { data } = await api.get(`/backups/${encodeURIComponent(deviceId)}`);
    return data.backups;
  },

  triggerBackup: async (deviceId: string): Promise<{ success: boolean; filename: string }> => {
    const { data } = await api.post(`/backup/${encodeURIComponent(deviceId)}`);
    return data;
  },

  getBackupDownloadUrl: (deviceId: string, filename: string): string => {
    return `${API_URL}/api/genieacs/backups/${encodeURIComponent(deviceId)}/${encodeURIComponent(filename)}`;
  },
};
