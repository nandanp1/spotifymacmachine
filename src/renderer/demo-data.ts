import type { LyricsLine, LyricsResult } from "./features/lyrics/types";
import type { AuraTrack } from "./stores/player-store";

export interface DemoTrack extends AuraTrack {
  album: string;
  year: string;
  folio: string;
  artworkClass: string;
  palette: {
    shadow: string;
    primary: string;
    accent: string;
    highlight: string;
  };
  lyrics: LyricsResult | null;
}

const afterimageLyrics: LyricsLine[] = [
  { startMs: 0, endMs: 11_500, text: "An instrumental breath" },
  { startMs: 11_500, endMs: 25_000, text: "The city folds into the blue" },
  { startMs: 25_000, endMs: 39_000, text: "A quiet current carries through" },
  { startMs: 39_000, endMs: 53_000, text: "We leave the hallway light awake" },
  { startMs: 53_000, endMs: 68_000, text: "For every shadow we might make" },
  { startMs: 68_000, endMs: 84_000, text: "Stay where the evening turns to gold" },
  { startMs: 84_000, endMs: 100_000, text: "There is a story left untold" },
  { startMs: 100_000, endMs: 116_000, text: "No map, no name, no finish line" },
  { startMs: 116_000, endMs: 133_000, text: "Only your afterimage and mine" },
  { startMs: 133_000, endMs: 150_000, text: "The windows breathe a softer rain" },
  { startMs: 150_000, endMs: 167_000, text: "And draw the night across the pane" },
  { startMs: 167_000, endMs: 184_000, text: "Stay where the evening turns to gold" },
  { startMs: 184_000, endMs: 202_000, text: "There is a story left untold" },
  { startMs: 202_000, endMs: 222_000, text: "A slow horizon, warm and wide" },
  { startMs: 222_000, endMs: 243_000, text: "The room goes still; the colors glide" },
];

const slowMercuryLyrics: LyricsLine[] = [
  { startMs: 0, endMs: 16_000, text: "A silver note begins to rise" },
  { startMs: 16_000, endMs: 32_000, text: "It bends the air between our eyes" },
  { startMs: 32_000, endMs: 48_000, text: "The clock forgets its measured sound" },
  { startMs: 48_000, endMs: 64_000, text: "While midnight pours along the ground" },
  { startMs: 64_000, endMs: 82_000, text: "Slow mercury, carry me home" },
  { startMs: 82_000, endMs: 100_000, text: "Past every tower made of chrome" },
  { startMs: 100_000, endMs: 118_000, text: "We move like weather through the frame" },
  { startMs: 118_000, endMs: 136_000, text: "Returning different, still the same" },
  { startMs: 136_000, endMs: 156_000, text: "An instrumental interlude" },
  { startMs: 156_000, endMs: 174_000, text: "The dawn arrives in quiet waves" },
  { startMs: 174_000, endMs: 192_000, text: "And leaves a little light to save" },
  { startMs: 192_000, endMs: 214_000, text: "Slow mercury, carry me home" },
  { startMs: 214_000, endMs: 238_000, text: "Past every tower made of chrome" },
];

const northWindowLyrics: LyricsLine[] = [
  { startMs: 0, endMs: 15_000, text: "Morning gathers at the glass" },
  { startMs: 15_000, endMs: 31_000, text: "Soft as all the hours pass" },
  { startMs: 31_000, endMs: 47_000, text: "Dust becomes a field of stars" },
  { startMs: 47_000, endMs: 64_000, text: "Nothing here is very far" },
  { startMs: 64_000, endMs: 82_000, text: "At the north window I can see" },
  { startMs: 82_000, endMs: 100_000, text: "The quieter shape of you and me" },
  { startMs: 100_000, endMs: 118_000, text: "A paper moon, a linen sky" },
  { startMs: 118_000, endMs: 136_000, text: "A little room for time to lie" },
  { startMs: 136_000, endMs: 155_000, text: "At the north window, stay awhile" },
  { startMs: 155_000, endMs: 174_000, text: "Let all the weather change its mind" },
  { startMs: 174_000, endMs: 198_000, text: "The day grows pale, the room stays kind" },
];

export const DEMO_TRACKS = [
  {
    id: "aura-demo-afterimage",
    uri: "aura:demo:afterimage",
    title: "Afterimage",
    artist: "Nara Vale",
    artists: ["Nara Vale"],
    album: "Rooms Without Windows",
    artworkUrl: null,
    source: "demo",
    year: "2026",
    durationMs: 243_000,
    folio: "AURA / 01",
    artworkClass: "artwork--afterimage",
    palette: {
      shadow: "#08090d",
      primary: "#6d365d",
      accent: "#d97962",
      highlight: "#e5c88e",
    },
    lyrics: {
      kind: "synced",
      source: "Original Aura demo text",
      lines: afterimageLyrics,
    },
  },
  {
    id: "aura-demo-slow-mercury",
    uri: "aura:demo:slow-mercury",
    title: "Slow Mercury",
    artist: "Oren Field",
    artists: ["Oren Field"],
    album: "Night Transit",
    artworkUrl: null,
    source: "demo",
    year: "2025",
    durationMs: 238_000,
    folio: "AURA / 02",
    artworkClass: "artwork--mercury",
    palette: {
      shadow: "#060c10",
      primary: "#17434b",
      accent: "#b77d5b",
      highlight: "#d5d2ba",
    },
    lyrics: {
      kind: "synced",
      source: "Original Aura demo text",
      lines: slowMercuryLyrics,
    },
  },
  {
    id: "aura-demo-north-window",
    uri: "aura:demo:north-window",
    title: "North Window",
    artist: "Mara August",
    artists: ["Mara August"],
    album: "Pale Rooms",
    artworkUrl: null,
    source: "demo",
    year: "2026",
    durationMs: 198_000,
    folio: "AURA / 03",
    artworkClass: "artwork--north-window",
    palette: {
      shadow: "#0c0b0a",
      primary: "#574933",
      accent: "#9b5b3f",
      highlight: "#e9d9b6",
    },
    lyrics: {
      kind: "synced",
      source: "Original Aura demo text",
      lines: northWindowLyrics,
    },
  },
] satisfies [DemoTrack, ...DemoTrack[]];
