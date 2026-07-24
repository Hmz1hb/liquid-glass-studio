import React, { useCallback, useRef, useState } from 'react';
import styles from './LightEditor.module.scss';

export interface LightDef {
  id: string;
  x: number;
  y: number;
  intensity: number;
  radius: number;
  color: { r: number; g: number; b: number };
}

interface LightEditorProps {
  lights: LightDef[];
  onLightsChange: (lights: LightDef[]) => void;
  canvasWidth: number;
  canvasHeight: number;
  visible: boolean;
}

export const LightEditor: React.FC<LightEditorProps> = ({
  lights,
  onLightsChange,
  canvasWidth,
  canvasHeight,
  visible,
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  const overlayRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, light: LightDef) => {
      e.stopPropagation();
      setDraggingId(light.id);
      setSelectedId(light.id);
      const rect = overlayRef.current?.getBoundingClientRect();
      const offsetX = rect ? rect.left : 0;
      const offsetY = rect ? rect.top : 0;
      dragOffset.current = {
        x: e.clientX - offsetX - light.x,
        y: e.clientY - offsetY - light.y,
      };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingId) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      const offsetX = rect ? rect.left : 0;
      const offsetY = rect ? rect.top : 0;
      const newLights = lights.map((l) =>
        l.id === draggingId
          ? {
              ...l,
              x: e.clientX - offsetX - dragOffset.current.x,
              y: e.clientY - offsetY - dragOffset.current.y,
            }
          : l
      );
      onLightsChange(newLights);
    },
    [draggingId, lights, onLightsChange]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  if (!visible || lights.length === 0) return null;

  const selectedLight = lights.find((l) => l.id === selectedId);

  return (
    <div
      ref={overlayRef}
      className={styles.lightOverlay}
      style={{ width: canvasWidth, height: canvasHeight }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {lights.map((light) => (
        <div
          key={light.id}
          className={`${styles.lightHandle} ${
            light.id === selectedId ? styles.lightHandleSelected : ''
          }`}
          style={{
            left: light.x - 12,
            top: light.y - 12,
            background: `rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, 0.8)`,
            boxShadow: `0 0 ${light.radius * 20}px rgba(${light.color.r}, ${light.color.g}, ${light.color.b}, ${light.intensity * 0.5})`,
          }}
          onMouseDown={(e) => handleMouseDown(e, light)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L14.5 9.5H22L16 14L18.5 21.5L12 17L5.5 21.5L8 14L2 9.5H9.5L12 2Z" />
          </svg>
        </div>
      ))}
      {selectedLight && (
        <div
          className={styles.lightPanel}
          style={{
            left: Math.min(selectedLight.x + 20, canvasWidth - 180),
            top: Math.max(selectedLight.y - 60, 10),
          }}
        >
          <div className={styles.lightPanelTitle}>Light</div>
          <label className={styles.lightPropLabel}>
            <span>Intensity</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={selectedLight.intensity}
              onChange={(e) => {
                onLightsChange(
                  lights.map((l) =>
                    l.id === selectedId
                      ? { ...l, intensity: parseFloat(e.target.value) }
                      : l
                  )
                );
              }}
            />
          </label>
          <label className={styles.lightPropLabel}>
            <span>Radius</span>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={selectedLight.radius}
              onChange={(e) => {
                onLightsChange(
                  lights.map((l) =>
                    l.id === selectedId
                      ? { ...l, radius: parseFloat(e.target.value) }
                      : l
                  )
                );
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
};

export function createDefaultLight(index: number, canvasWidth: number, canvasHeight: number): LightDef {
  const positions = [
    { x: canvasWidth * 0.3, y: canvasHeight * 0.3 },
    { x: canvasWidth * 0.7, y: canvasHeight * 0.3 },
    { x: canvasWidth * 0.5, y: canvasHeight * 0.7 },
  ];
  const colors = [
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 200, b: 150 },
    { r: 150, g: 200, b: 255 },
  ];
  const pos = positions[index % 3];
  return {
    id: `light-${Date.now()}-${index}`,
    x: pos.x,
    y: pos.y,
    intensity: 1.0,
    radius: 1.0,
    color: colors[index % 3],
  };
}
