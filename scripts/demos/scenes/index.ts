/** Scene registry — one entry per recordable demo clip. */

import type { Scene } from "../lib/types";
import railDraw from "./railDraw";
import mapModes from "./mapModes";
import listingUnlocked from "./listingUnlocked";
import railCommute from "./railCommute";
import railColor from "./railColor";
import railCompare from "./railCompare";

export const SCENES: Scene[] = [railDraw, mapModes, railCommute, railColor, railCompare, listingUnlocked];

export function findScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id);
}
