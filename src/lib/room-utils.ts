// Room data types
export interface RoomData {
  RoomKey?: string;
  RoomType?: string | string[];
  RoomLevel?: string | string[];
  RoomLength?: number;
  RoomWidth?: number;
  RoomDimensions?: string;
  RoomFeatures?: string | string[];
}

export interface ProcessedRoom {
  id: string;
  name: string;
  level: string;
  length: number;
  width: number;
  areaMeters: number;
  areaFeet: number;
  isLikelyCombinedSpace: boolean;
  originalRoom: RoomData;
}

// Color mapping for room levels
export const LEVEL_COLORS: Record<string, string> = {
  'Main': '#3b82f6',      // Blue
  'Ground': '#3b82f6',    // Blue
  'Basement': '#6b7280',  // Gray
  'Lower': '#6b7280',     // Gray
  'Second': '#8b5cf6',    // Purple
  'Upper': '#8b5cf6',     // Purple
  'Third': '#f59e0b',     // Amber
};

// Default color for unknown levels
const DEFAULT_COLOR = '#94a3b8';

/**
 * Normalize a value that could be a string or string array
 */
function normalizeString(value: string | string[] | undefined): string {
  if (!value) return '';
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

/**
 * Filter rooms with valid dimensions and process them
 */
export function processRooms(rooms: RoomData[] | undefined): ProcessedRoom[] {
  if (!rooms || rooms.length === 0) return [];

  const processed: ProcessedRoom[] = [];

  for (const room of rooms) {
    const length = room.RoomLength;
    const width = room.RoomWidth;

    // Skip invalid dimensions
    if (!length || !width || length === 0 || width === 0) continue;

    // Calculate areas (metric to sq ft conversion: 1 sq meter = 10.764 sq feet)
    const areaMeters = length * width;
    const areaFeet = areaMeters * 10.764;

    const name = normalizeString(room.RoomType) || 'Unknown Room';
    const level = normalizeString(room.RoomLevel) || 'Unknown';

    processed.push({
      id: room.RoomKey || `room-${processed.length}`,
      name,
      level,
      length,
      width,
      areaMeters,
      areaFeet,
      isLikelyCombinedSpace: false, // Will be calculated below
      originalRoom: room,
    });
  }

  // Flag duplicates on same level
  flagDuplicateRooms(processed);

  return processed;
}

/**
 * Flag rooms on the same level with identical dimensions
 * (likely combined spaces like Kitchen + Breakfast area)
 */
function flagDuplicateRooms(rooms: ProcessedRoom[]): void {
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const roomA = rooms[i];
      const roomB = rooms[j];

      // Only check rooms on same level
      if (roomA.level !== roomB.level) continue;

      // Check if dimensions match exactly
      if (roomA.length === roomB.length && roomA.width === roomB.width) {
        // Mark both as likely combined spaces
        roomA.isLikelyCombinedSpace = true;
        roomB.isLikelyCombinedSpace = true;
      }
    }
  }
}

/**
 * Group rooms by level
 */
export function groupRoomsByLevel(rooms: ProcessedRoom[]): Map<string, ProcessedRoom[]> {
  const grouped = new Map<string, ProcessedRoom[]>();

  for (const room of rooms) {
    const levelList = grouped.get(room.level) || [];
    levelList.push(room);
    grouped.set(room.level, levelList);
  }

  return grouped;
}

/**
 * Get unique levels from processed rooms
 */
export function getUniqueLevels(rooms: ProcessedRoom[]): string[] {
  const levels = new Set<string>();
  for (const room of rooms) {
    levels.add(room.level);
  }
  return Array.from(levels).sort();
}

/**
 * Get color for a room level
 */
export function getLevelColor(level: string): string {
  return LEVEL_COLORS[level] || DEFAULT_COLOR;
}

/**
 * Format area for display
 */
export function formatArea(area: number, unit: 'sqm' | 'sqft'): string {
  if (area == null || isNaN(area)) {
    return 'N/A';
  }
  if (unit === 'sqft') {
    return `${Math.round(area * 10.764)} sq ft`;
  }
  return `${area.toFixed(1)} sq m`;
}

/**
 * Format dimensions for display
 */
export function formatDimensions(length?: number, width?: number): string {
  if (length == null || width == null || isNaN(length) || isNaN(width)) {
    return 'N/A';
  }
  return `${length.toFixed(2)}m × ${width.toFixed(2)}m`;
}
