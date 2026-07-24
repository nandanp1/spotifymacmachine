const PRODUCTION_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://i.scdn.co https://mosaic.scdn.co https://*.spotifycdn.com",
  "connect-src 'self' https://api.spotify.com https://accounts.spotify.com https://*.spotifycdn.com",
  "media-src 'none'",
  "worker-src 'self' blob:",
  "frame-src 'none'",
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

  return PRODUCTION_DIRECTIVES.map((directive) => {
    if (directive.startsWith("connect-src ")) {
      return `${directive} ${DEVELOPMENT_CONNECTIONS.join(" ")}`;
    }

    // Vite injects the React Refresh bootstrap as an inline module in
    // development. This policy is applied only to the validated loopback
    // renderer URL; packaged builds retain the stricter production directive.
    if (directive.startsWith("script-src ")) {
      return `${directive} 'unsafe-inline'`;
    }

    return directive;
  }).join("; ");
}
