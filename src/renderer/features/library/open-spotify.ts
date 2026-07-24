const SPOTIFY_OPEN_URI =
  /^spotify:(album|artist|audiobook|episode|playlist|show|track):([A-Za-z0-9]+)$/u;

/**
 * Converts a supported Spotify URI into an allowlisted HTTPS URL suitable for
 * the desktop app's external-link boundary.
 */
export function toSpotifyOpenUrl(uri: string): string | null {
  const match = SPOTIFY_OPEN_URI.exec(uri.trim());
  if (!match) {
    return null;
  }

  const [, type, id] = match;
  return `https://open.spotify.com/${type}/${id}`;
}
