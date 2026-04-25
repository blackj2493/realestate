"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  Treemap,
} from "recharts";
import { processRooms, getUniqueLevels, type ProcessedRoom, type RoomData } from "@/lib/room-utils";

// Vibrant color palette for floors with subtle gradients
const FLOOR_COLORS = {
  'Main': { base: '#2563EB', light: '#3B82F6' },
  'Ground': { base: '#2563EB', light: '#3B82F6' },
  'Second': { base: '#9333EA', light: '#A855F7' },
  'Upper': { base: '#9333EA', light: '#A855F7' },
  'Basement': { base: '#0891B2', light: '#06B6D4' },
  'Lower': { base: '#0891B2', light: '#06B6D4' },
};

function getFloorColor(level: string): { base: string; light: string } {
  return FLOOR_COLORS[level as keyof typeof FLOOR_COLORS] || { base: '#64748B', light: '#94A3B8' };
}

// Custom treemap content renderer - modern floating tiles
function CustomTreemapContent(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  room?: ProcessedRoom;
  unit?: string;
  index?: number;
  payload?: unknown;
  depth?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, room, unit = "sqft" } = props;
  if (!room || width < 45 || height < 35) return null;

  const colorSet = getFloorColor(room.level);
  const showStripes = room.isLikelyCombinedSpace;
  
  const areaM2 = room.areaMeters;
  const areaFt2 = room.areaFeet;
  const areaValue = unit === "sqm" ? areaM2.toFixed(1) : Math.round(areaFt2).toLocaleString();
  const areaUnit = unit === "sqm" ? "m²" : "ft²";

  return (
    <g>
      {/* Gradient definition - always created */}
      <defs>
        <linearGradient id={`grad-${props.index || 0}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={colorSet.light} />
          <stop offset="100%" stopColor={colorSet.base} />
        </linearGradient>
      </defs>
      
      {/* Stripe pattern with solid base color background */}
      {showStripes && (
        <defs>
          <pattern
            id={`combined-stripes-${props.index || 0}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill={colorSet.base} />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          </pattern>
        </defs>
      )}
      
      {/* Main rectangle with subtle gradient and rounded corners - ALWAYS rendered */}
      <rect
        x={x + 1.5}
        y={y + 1.5}
        width={Math.max(width - 3, 0)}
        height={Math.max(height - 3, 0)}
        fill={showStripes ? `url(#combined-stripes-${props.index || 0})` : `url(#grad-${props.index || 0})`}
        rx={3}
      />
      {/* Room name - larger font, no cut off */}
      {width >= 50 && height >= 35 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#FFFFFF"
            fontSize={14}
            fontWeight={600}
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          >
            {name}
          </text>
          {height >= 50 && (
            <text
              x={x + width / 2}
              y={y + height / 2 + 14}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="rgba(255,255,255,0.9)"
              fontSize={12}
              fontWeight={400}
              style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
            >
              {areaValue} {areaUnit}
            </text>
          )}
        </>
      )}
      {/* Combined badge - small icon inside top-right */}
      {room.isLikelyCombinedSpace && width >= 55 && height >= 35 && (
        <g>
          <circle cx={x + width - 12} cy={y + 12} r={7} fill="rgba(0,0,0,0.35)" />
          <text
            x={x + width - 12}
            y={y + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize={9}
            fontWeight={600}
          >
            !
          </text>
          <title>Likely Combined Space</title>
        </g>
      )}
    </g>
  );
}

export default function SpatialDistribution({
  rooms,
  title = "Room Distribution",
}: {
  rooms?: RoomData[];
  title?: string;
}) {
  const [selectedLevel, setSelectedLevel] = useState<string>("All Floors");
  const [unit, setUnit] = useState<"sqm" | "sqft">("sqft");

  // Process rooms data
  const processedRooms = useMemo(() => processRooms(rooms), [rooms]);
  const availableLevels = useMemo(() => getUniqueLevels(processedRooms), [processedRooms]);

  // Filter rooms by selected level
  const filteredRooms = useMemo(() => {
    if (selectedLevel === "All Floors") {
      return processedRooms;
    }
    return processedRooms.filter((room) => room.level === selectedLevel);
  }, [processedRooms, selectedLevel]);

  // Prepare data for treemap
  const treemapData = useMemo(() => {
    return {
      name: "Property",
      children: filteredRooms.map((room, idx) => ({
        name: room.name,
        size: room.areaFeet,
        room,
        index: idx,
      })),
    };
  }, [filteredRooms]);

  // Calculate totals correctly
  const totalArea = useMemo(() => {
    if (unit === "sqm") {
      return filteredRooms.reduce((sum, room) => sum + room.areaMeters, 0);
    }
    return filteredRooms.reduce((sum, room) => sum + room.areaFeet, 0);
  }, [filteredRooms, unit]);

  // Handle empty state
  if (!rooms || rooms.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-md p-5" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
        <p className="text-sm text-slate-400 py-8 text-center">No room data available</p>
      </div>
    );
  }

  const levelOptions = ["All Floors", ...availableLevels];

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        </div>

        {/* Modern Pill Toggle Controls */}
        <div className="flex items-center gap-4">
          {/* Floor filter - modern pill toggle */}
          <div className="flex items-center bg-slate-100 rounded-full p-1">
            {levelOptions.map((level) => (
                <button
                key={level}
                onClick={() => setSelectedLevel(level)}
                className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                  selectedLevel === level
                    ? "bg-white text-slate-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-600"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          {/* Unit toggle - modern pill */}
          <div className="flex items-center bg-slate-100 rounded-full p-1">
            <button
              onClick={() => setUnit("sqm")}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                unit === "sqm" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"
              }`}
            >
              m²
            </button>
            <button
              onClick={() => setUnit("sqft")}
              className={`px-4 py-2 text-sm font-medium rounded-full transition-all ${
                unit === "sqft" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"
              }`}
            >
              ft²
            </button>
          </div>

          {/* Legend - colored dots */}
          <div className="flex items-center gap-3 ml-auto">
            {availableLevels.map((level) => {
              const colors = getFloorColor(level);
              return (
                <div key={level} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: colors.base }}
                  />
                  <span className="text-sm text-slate-500 font-medium">{level}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart - modern floating tiles with gaps */}
      <div className="h-[280px] px-4 pb-4">
        {filteredRooms.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={[treemapData]}
              dataKey="size"
              aspectRatio={4 / 3}
              fill="#6B7280"
              content={<CustomTreemapContent unit={unit} />}
            />
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            No rooms for this floor
          </div>
        )}
      </div>

      {/* Clean List */}
      <div className="border-t border-slate-100">
        <div className="px-5 py-3 border-b border-slate-100">
          <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">Rooms ({filteredRooms.length})</span>
        </div>
        <div className="max-h-[180px] overflow-y-auto">
          {filteredRooms.map((room) => {
            const colors = getFloorColor(room.level);
            const areaValue = unit === "sqm" ? room.areaMeters.toFixed(1) : Math.round(room.areaFeet).toLocaleString();
            const areaUnit = unit === "sqm" ? "m²" : "ft²";
            
            return (
              <div
                key={room.id}
                className="flex items-center justify-between px-5 py-3 border-b border-slate-50"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.base }}
                  />
                  <span className="text-sm text-slate-700 font-medium">{room.name}</span>
                  {room.isLikelyCombinedSpace && (
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">COMB</span>
                  )}
                </div>
                <span className="text-sm font-medium text-slate-700 tabular-nums">
                  {areaValue} <span className="text-slate-400">{areaUnit}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}