import type { LyricsTrackIdentity } from "./types";

export interface LyricsIdentityCandidate {
  spotifyTrackId?: string;
  isrc?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

export function normalizeLyricsIdentity(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*(?:remaster|version|edit|live|feat)[^)]*\)/gi, "")
    .replace(/\b(?:feat|featuring|ft)\.?\s+.+$/gi, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function scoreLyricsIdentity(
  candidate: LyricsIdentityCandidate,
  track: LyricsTrackIdentity,
): number {
  if (
    candidate.spotifyTrackId &&
    candidate.spotifyTrackId === track.spotifyTrackId
  ) {
    return 1_000;
  }
  if (
    candidate.isrc &&
    track.isrc &&
    candidate.isrc.toUpperCase() === track.isrc.toUpperCase()
  ) {
    return 900;
  }
  if (!candidate.title || !candidate.artist) {
    return 0;
  }

  const titleMatches =
    normalizeLyricsIdentity(candidate.title) ===
    normalizeLyricsIdentity(track.title);
  const artistMatches =
    normalizeLyricsIdentity(candidate.artist) ===
    normalizeLyricsIdentity(track.artist);
  if (!titleMatches || !artistMatches) {
    return 0;
  }

  let score = 600;
  if (
    candidate.album &&
    track.album &&
    normalizeLyricsIdentity(candidate.album) ===
      normalizeLyricsIdentity(track.album)
  ) {
    score += 50;
  }
  if (
    candidate.durationMs &&
    Math.abs(candidate.durationMs - track.durationMs) <= 2_500
  ) {
    score += 25;
  }
  return score;
}
