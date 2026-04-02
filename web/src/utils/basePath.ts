const normalizeBaseUrl = (baseUrl?: string): string => {
  const value = (baseUrl || '/').trim()

  if (!value || value === '/' || value === './') {
    return '/'
  }

  if (!value.startsWith('/')) {
    return '/'
  }

  return value.endsWith('/') ? value.slice(0, -1) || '/' : value
}

export const getRouterBasename = (): string => normalizeBaseUrl(import.meta.env.BASE_URL)

export const resolveAppPath = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseName = getRouterBasename()

  return baseName === '/' ? normalizedPath : `${baseName}${normalizedPath}`
}