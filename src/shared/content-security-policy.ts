const PRODUCTION_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://i.scdn.co https://mosaic.scdn.co https://*.spotifycdn.com",
  "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://*.spotify.com wss://*.spotify.com https://*.scdn.co https://*.spotifycdn.com",
  "media-src 'self' blob: https://*.spotifycdn.com",
  "worker-src 'self' blob:",
  "frame-src https://sdk.scdn.co",
] as const;

const DEVELOPMENT_CONNECTIONS = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
] as const;

export function buildContentSecurityPolicy(
  isDevelopment: boolean,
): string {
  if (!isDevelopment) {
    return PRODUCTION_DIRECTIVES.join("; ");
  }

  return PRODUCTION_DIRECTIVES.map((directive) =>
    directive.startsWith("connect-src ")
      ? `${directive} ${DEVELOPMENT_CONNECTIONS.join(" ")}`
      : directive,
  ).join("; ");
}
