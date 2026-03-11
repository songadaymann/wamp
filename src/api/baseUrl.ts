export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_ROOM_API_BASE_URL?.trim();
  return configured ? configured.replace(/\/+$/, '') : '';
}
