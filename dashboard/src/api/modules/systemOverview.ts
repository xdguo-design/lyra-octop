import { request } from "../request";

export interface SystemOverview {
  ok: boolean;
  db: boolean;
  users_loaded: number;
  agents_running: number;
}

export const getSystemOverview = () => request<SystemOverview>("/health");
