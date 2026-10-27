const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export const apiUrl = path => apiBase + path;
export const hasApi = import.meta.env.VITE_PAGES !== 'true' || Boolean(apiBase);
export const assetUrl = path => path?.startsWith('/') && !path.startsWith('//')
  ? import.meta.env.BASE_URL + path.slice(1)
  : path;
