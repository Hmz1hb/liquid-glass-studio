import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './EditorMode.module.scss';
import clsx from 'clsx';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { HistoryManager } from '../../utils/historyManager';

export type ShapeType = 'rect' | 'circle' | 'triangle' | 'star' | 'hexagon' | 'pill' | 'cross' | 'heart';

export const SHAPE_TYPES: { value: ShapeType; label: string; icon: string }[] = [
  { value: 'rect', label: 'Rectangle', icon: '▭' },
  { value: 'circle', label: 'Circle', icon: '●' },
  { value: 'triangle', label: 'Triangle', icon: '▲' },
  { value: 'star', label: 'Star', icon: '★' },
  { value: 'hexagon', label: 'Hexagon', icon: '⬡' },
  { value: 'pill', label: 'Pill', icon: '💊' },
  { value: 'cross', label: 'Cross', icon: '✚' },
  { value: 'heart', label: 'Heart', icon: '♥' },
];

export const SHAPE_TYPE_INDEX: Record<ShapeType, number> = {
  rect: 0,
  circle: 1,
  triangle: 2,
  star: 3,
  hexagon: 4,
  pill: 5,
  cross: 6,
  heart: 7,
};

export interface ShapeDef {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  roundness: number;
  rotation: number;
  zIndex: number;
}

interface Props {
  shapes: ShapeDef[];
  onShapesChange: (shapes: ShapeDef[]) => void;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  canvasWidth: number;
  canvasHeight: number;
  lang: Record<string, any>;
  multiSelectedIds?: Set<string>;
  onMultiSelectChange?: (ids: Set<string>) => void;
}

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 8;
const MIN_SHAPE_SIZE = 20;
const NUDGE_AMOUNT = 1;
const NUDGE_SHIFT_AMOUNT = 10;
const ROTATE_HANDLE_OFFSET = 24;

let nextShapeId = 1;
export function generateShapeId(): string {
  return `shape_${nextShapeId++}`;
}

export function createDefaultShape(canvasWidth: number, canvasHeight: number): ShapeDef {
  return {
    id: generateShapeId(),
    type: 'rect',
    x: canvasWidth / 2,
    y: canvasHeight / 2,
    width: 200,
    height: 200,
    radius: 80,
    roundness: 5,
    rotation: 0,
    zIndex: 0,
  };
}

// Clipboard for copy/paste
let clipboard: ShapeDef[] = [];

export const EditorMode = ({
  shapes,
  onShapesChange,
  selectedShapeId,
  onSelectShape,
  canvasWidth,
  canvasHeight,
  lang,
  multiSelectedIds,
  onMultiSelectChange,
}: Props) => {
  const historyRef = useRef(new HistoryManager<ShapeDef[]>());
  // Track whether we've pushed the initial state
  const historyInitialized = useRef(false);

  // Push initial state once
  useEffect(() => {
    if (!historyInitialized.current && shapes.length > 0) {
      historyRef.current.push(shapes);
      historyInitialized.current = true;
    }
  }, [shapes]);

  // Helper: commit shapes to history and propagate change
  const commitShapes = useCallback(
    (newShapes: ShapeDef[]) => {
      historyRef.current.push(newShapes);
      onShapesChange(newShapes);
    },
    [onShapesChange],
  );

  const overlayRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    type: 'move' | 'resize' | 'rotate';
    shapeId: string;
    startMouseX: number;
    startMouseY: number;
    startShape: ShapeDef;
    handleDir?: HandleDir;
    startAngle?: number;
    moveAll?: boolean;
    startShapes?: ShapeDef[];
  } | null>(null);

  const [, forceUpdate] = useState(0);

  const selectedShape = shapes.find((s) => s.id === selectedShapeId) ?? null;
  const multiSelected = multiSelectedIds ?? new Set<string>();

  const getShapeBounds = useCallback((shape: ShapeDef) => {
    return {
      left: shape.x - shape.width / 2,
      top: shape.y - shape.height / 2,
      right: shape.x + shape.width / 2,
      bottom: shape.y + shape.height / 2,
      width: shape.width,
      height: shape.height,
    };
  }, []);

  const hitTestShape = useCallback(
    (clientX: number, clientY: number): ShapeDef | null => {
      const overlay = overlayRef.current;
      if (!overlay) return null;
      const rect = overlay.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // Sort by zIndex descending for hit test (top shapes first)
      const sorted = [...shapes].sort((a, b) => b.zIndex - a.zIndex);
      for (const shape of sorted) {
        const bounds = getShapeBounds(shape);
        if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
          return shape;
        }
      }
      return null;
    },
    [shapes, getShapeBounds],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.dataset.handle || target.dataset.rotate) {
        return;
      }

      const hit = hitTestShape(e.clientX, e.clientY);
      const isShiftClick = e.shiftKey;

      if (hit) {
        if (isShiftClick && onMultiSelectChange) {
          // Multi-select toggle
          const newSet = new Set(multiSelected);
          if (newSet.has(hit.id)) {
            newSet.delete(hit.id);
          } else {
            newSet.add(hit.id);
          }
          onMultiSelectChange(newSet);
          onSelectShape(hit.id);
        } else {
          onSelectShape(hit.id);
          if (onMultiSelectChange && multiSelected.size > 0 && !multiSelected.has(hit.id)) {
            onMultiSelectChange(new Set());
          }
        }

        // Start drag - move all multi-selected shapes if applicable
        const moveMultiple = multiSelected.size > 1 && multiSelected.has(hit.id);
        dragState.current = {
          type: 'move',
          shapeId: hit.id,
          startMouseX: e.clientX,
          startMouseY: e.clientY,
          startShape: { ...hit },
          moveAll: moveMultiple,
          startShapes: moveMultiple ? shapes.filter((s) => multiSelected.has(s.id)).map((s) => ({ ...s })) : undefined,
        };
        e.preventDefault();
        e.stopPropagation();
      } else {
        onSelectShape(null);
        if (onMultiSelectChange) onMultiSelectChange(new Set());
      }
    },
    [hitTestShape, onSelectShape, multiSelected, onMultiSelectChange, shapes],
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, dir: HandleDir) => {
      if (!selectedShape) return;
      e.preventDefault();
      e.stopPropagation();

      dragState.current = {
        type: 'resize',
        shapeId: selectedShape.id,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startShape: { ...selectedShape },
        handleDir: dir,
      };
    },
    [selectedShape],
  );

  const onRotatePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!selectedShape) return;
      e.preventDefault();
      e.stopPropagation();

      const overlay = overlayRef.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      const cx = selectedShape.x + rect.left;
      const cy = selectedShape.y + rect.top;
      const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);

      dragState.current = {
        type: 'rotate',
        shapeId: selectedShape.id,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startShape: { ...selectedShape },
        startAngle,
      };
    },
    [selectedShape],
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      const dx = e.clientX - ds.startMouseX;
      const dy = e.clientY - ds.startMouseY;

      if (ds.type === 'move' && ds.moveAll && ds.startShapes) {
        // Move all multi-selected shapes
        const newShapes = [...shapes];
        for (const startShape of ds.startShapes) {
          const idx = newShapes.findIndex((s) => s.id === startShape.id);
          if (idx !== -1) {
            newShapes[idx] = {
              ...startShape,
              x: startShape.x + dx,
              y: startShape.y + dy,
            };
          }
        }
        onShapesChange(newShapes);
      } else if (ds.type === 'move') {
        const shapeIndex = shapes.findIndex((s) => s.id === ds.shapeId);
        if (shapeIndex === -1) return;
        const newShapes = [...shapes];
        newShapes[shapeIndex] = {
          ...ds.startShape,
          x: ds.startShape.x + dx,
          y: ds.startShape.y + dy,
        };
        onShapesChange(newShapes);
      } else if (ds.type === 'resize' && ds.handleDir) {
        const shapeIndex = shapes.findIndex((s) => s.id === ds.shapeId);
        if (shapeIndex === -1) return;

        const s = ds.startShape;
        let newX = s.x;
        let newY = s.y;
        let newW = s.width;
        let newH = s.height;
        const dir = ds.handleDir;

        if (dir.includes('e')) {
          newW = Math.max(MIN_SHAPE_SIZE, s.width + dx);
          newX = s.x + (newW - s.width) / 2;
        } else if (dir.includes('w')) {
          newW = Math.max(MIN_SHAPE_SIZE, s.width - dx);
          newX = s.x - (newW - s.width) / 2;
        }

        if (dir.includes('s')) {
          newH = Math.max(MIN_SHAPE_SIZE, s.height + dy);
          newY = s.y + (newH - s.height) / 2;
        } else if (dir.includes('n')) {
          newH = Math.max(MIN_SHAPE_SIZE, s.height - dy);
          newY = s.y - (newH - s.height) / 2;
        }

        const newShapes = [...shapes];
        newShapes[shapeIndex] = { ...s, x: newX, y: newY, width: newW, height: newH };
        onShapesChange(newShapes);
      } else if (ds.type === 'rotate' && ds.startAngle !== undefined) {
        const shapeIndex = shapes.findIndex((s) => s.id === ds.shapeId);
        if (shapeIndex === -1) return;

        const overlay = overlayRef.current;
        if (!overlay) return;
        const rect = overlay.getBoundingClientRect();
        const cx = ds.startShape.x + rect.left;
        const cy = ds.startShape.y + rect.top;
        const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
        let deltaAngle = currentAngle - ds.startAngle;

        // Snap to 15-degree increments when shift is held
        if (e.shiftKey) {
          const snapAngle = Math.PI / 12;
          deltaAngle = Math.round(deltaAngle / snapAngle) * snapAngle;
        }

        const newShapes = [...shapes];
        newShapes[shapeIndex] = {
          ...ds.startShape,
          rotation: ds.startShape.rotation + deltaAngle,
        };
        onShapesChange(newShapes);
      }

      forceUpdate((v) => v + 1);
    };

    const onPointerUp = () => {
      if (dragState.current) {
        // Commit the final state after drag/resize/rotate ends
        historyRef.current.push(shapes);
      }
      dragState.current = null;
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [shapes, onShapesChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const ctrlOrCmd = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;

      // Undo
      if (ctrlOrCmd && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        const prev = historyRef.current.undo();
        if (prev) {
          onShapesChange(prev);
        }
        return;
      }

      // Redo (Ctrl+Shift+Z or Ctrl+Y)
      if (ctrlOrCmd && ((e.shiftKey && e.key === 'z') || (e.shiftKey && e.key === 'Z') || e.key === 'y')) {
        e.preventDefault();
        const next = historyRef.current.redo();
        if (next) {
          onShapesChange(next);
        }
        return;
      }

      // Delete selected
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShapeId && shapes.length > 1) {
        e.preventDefault();
        const idsToDelete = multiSelected.size > 0 ? multiSelected : new Set([selectedShapeId]);
        const newShapes = shapes.filter((s) => !idsToDelete.has(s.id));
        commitShapes(newShapes);
        onSelectShape(newShapes.length > 0 ? newShapes[newShapes.length - 1].id : null);
        if (onMultiSelectChange) onMultiSelectChange(new Set());
        return;
      }

      // Copy
      if (ctrlOrCmd && e.key === 'c' && selectedShapeId) {
        e.preventDefault();
        const ids = multiSelected.size > 0 ? multiSelected : new Set([selectedShapeId]);
        clipboard = shapes.filter((s) => ids.has(s.id)).map((s) => ({ ...s }));
        return;
      }

      // Paste
      if (ctrlOrCmd && e.key === 'v' && clipboard.length > 0) {
        e.preventDefault();
        if (shapes.length + clipboard.length > 8) return;
        const pasted = clipboard.map((s) => ({
          ...s,
          id: generateShapeId(),
          x: s.x + 20,
          y: s.y + 20,
        }));
        commitShapes([...shapes, ...pasted]);
        onSelectShape(pasted[pasted.length - 1].id);
        if (onMultiSelectChange) {
          onMultiSelectChange(new Set(pasted.map((s) => s.id)));
        }
        return;
      }

      // Select all
      if (ctrlOrCmd && e.key === 'a' && onMultiSelectChange) {
        e.preventDefault();
        onMultiSelectChange(new Set(shapes.map((s) => s.id)));
        return;
      }

      // Arrow key nudging
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedShapeId) {
        e.preventDefault();
        const amount = e.shiftKey ? NUDGE_SHIFT_AMOUNT : NUDGE_AMOUNT;
        const ids = multiSelected.size > 0 ? multiSelected : new Set([selectedShapeId]);
        const newShapes = shapes.map((s) => {
          if (!ids.has(s.id)) return s;
          return {
            ...s,
            x: s.x + (e.key === 'ArrowRight' ? amount : e.key === 'ArrowLeft' ? -amount : 0),
            y: s.y + (e.key === 'ArrowDown' ? amount : e.key === 'ArrowUp' ? -amount : 0),
          };
        });
        commitShapes(newShapes);
        return;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shapes, selectedShapeId, multiSelected, onShapesChange, commitShapes, onSelectShape, onMultiSelectChange]);

  const handleAddShape = useCallback(() => {
    if (shapes.length >= 8) return;
    const newShape = createDefaultShape(canvasWidth, canvasHeight);
    newShape.x += (shapes.length % 3) * 30 - 30;
    newShape.y += (shapes.length % 3) * 30 - 30;
    newShape.zIndex = shapes.length;
    commitShapes([...shapes, newShape]);
    onSelectShape(newShape.id);
  }, [shapes, commitShapes, onSelectShape, canvasWidth, canvasHeight]);

  const handleDeleteShape = useCallback(() => {
    if (!selectedShapeId) return;
    const idsToDelete = multiSelected.size > 0 ? multiSelected : new Set([selectedShapeId]);
    const newShapes = shapes.filter((s) => !idsToDelete.has(s.id));
    commitShapes(newShapes);
    onSelectShape(newShapes.length > 0 ? newShapes[newShapes.length - 1].id : null);
    if (onMultiSelectChange) onMultiSelectChange(new Set());
  }, [shapes, selectedShapeId, multiSelected, commitShapes, onSelectShape, onMultiSelectChange]);

  const handleDuplicateShape = useCallback(() => {
    if (!selectedShapeId || shapes.length >= 8) return;
    const shape = shapes.find((s) => s.id === selectedShapeId);
    if (!shape) return;
    const dup: ShapeDef = {
      ...shape,
      id: generateShapeId(),
      x: shape.x + 20,
      y: shape.y + 20,
      zIndex: shapes.length,
    };
    commitShapes([...shapes, dup]);
    onSelectShape(dup.id);
  }, [shapes, selectedShapeId, commitShapes, onSelectShape]);

  const moveLayerUp = useCallback(() => {
    if (!selectedShapeId) return;
    const idx = shapes.findIndex((s) => s.id === selectedShapeId);
    if (idx >= shapes.length - 1) return;
    const newShapes = [...shapes];
    [newShapes[idx], newShapes[idx + 1]] = [newShapes[idx + 1], newShapes[idx]];
    newShapes.forEach((s, i) => { s.zIndex = i; });
    commitShapes(newShapes);
  }, [shapes, selectedShapeId, commitShapes]);

  const moveLayerDown = useCallback(() => {
    if (!selectedShapeId) return;
    const idx = shapes.findIndex((s) => s.id === selectedShapeId);
    if (idx <= 0) return;
    const newShapes = [...shapes];
    [newShapes[idx], newShapes[idx - 1]] = [newShapes[idx - 1], newShapes[idx]];
    newShapes.forEach((s, i) => { s.zIndex = i; });
    commitShapes(newShapes);
  }, [shapes, selectedShapeId, commitShapes]);

  const handleDirs: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const getHandlePosition = (dir: HandleDir, bounds: ReturnType<typeof getShapeBounds>) => {
    const hx =
      dir.includes('w') ? bounds.left : dir.includes('e') ? bounds.right : bounds.left + bounds.width / 2;
    const hy =
      dir.includes('n') ? bounds.top : dir.includes('s') ? bounds.bottom : bounds.top + bounds.height / 2;
    return { x: hx, y: hy };
  };

  const getHandleCursor = (dir: HandleDir) => {
    const map: Record<HandleDir, string> = {
      nw: 'nwse-resize',
      n: 'ns-resize',
      ne: 'nesw-resize',
      e: 'ew-resize',
      se: 'nwse-resize',
      s: 'ns-resize',
      sw: 'nesw-resize',
      w: 'ew-resize',
    };
    return map[dir];
  };

  return (
    <div className={styles.editorOverlay}>
      <div
        ref={overlayRef}
        className={styles.canvasOverlay}
        style={{ width: canvasWidth, height: canvasHeight }}
        onPointerDown={handlePointerDown}
      >
        {shapes.map((shape) => {
          const bounds = getShapeBounds(shape);
          const isSelected = shape.id === selectedShapeId;
          const isMultiSelected = multiSelected.has(shape.id);
          const rotDeg = (shape.rotation * 180) / Math.PI;
          return (
            <div
              key={shape.id}
              className={clsx(styles.shapeBounds, {
                [styles.shapeBoundsSelected]: isSelected,
                [styles.multiSelectHighlight]: isMultiSelected && !isSelected,
              })}
              style={{
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
                transform: rotDeg !== 0 ? `rotate(${rotDeg}deg)` : undefined,
                transformOrigin: 'center center',
              }}
            >
              {isSelected &&
                handleDirs.map((dir) => {
                  const pos = getHandlePosition(dir, {
                    left: 0,
                    top: 0,
                    right: bounds.width,
                    bottom: bounds.height,
                    width: bounds.width,
                    height: bounds.height,
                  });
                  return (
                    <div
                      key={dir}
                      data-handle={dir}
                      className={styles.resizeHandle}
                      style={{
                        left: pos.x - HANDLE_SIZE / 2,
                        top: pos.y - HANDLE_SIZE / 2,
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        cursor: getHandleCursor(dir),
                      }}
                      onPointerDown={(e) => onHandlePointerDown(e, dir)}
                    />
                  );
                })}
              {/* Rotation handle */}
              {isSelected && (
                <>
                  <div
                    className={styles.rotateLine}
                    style={{
                      left: bounds.width / 2,
                      top: -ROTATE_HANDLE_OFFSET,
                      height: ROTATE_HANDLE_OFFSET,
                    }}
                  />
                  <div
                    data-rotate="true"
                    className={styles.rotateHandle}
                    style={{
                      left: bounds.width / 2 - 6,
                      top: -ROTATE_HANDLE_OFFSET - 6,
                    }}
                    onPointerDown={onRotatePointerDown}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Shape list panel */}
      <div className={styles.shapePanel}>
        <div className={styles.shapePanelHeader}>
          <span className={styles.shapePanelTitle}>{lang['editor.shapeList']}</span>
          <div className={styles.shapePanelActions}>
            <button
              className={styles.iconButton}
              onClick={handleDuplicateShape}
              disabled={!selectedShapeId || shapes.length >= 8}
              title="Duplicate"
            >
              <ContentCopyIcon style={{ fontSize: 14 }} />
            </button>
            <button
              className={styles.iconButton}
              onClick={handleAddShape}
              disabled={shapes.length >= 8}
              title={lang['editor.addShape']}
            >
              <AddIcon style={{ fontSize: 16 }} />
            </button>
            <button
              className={styles.iconButton}
              onClick={handleDeleteShape}
              disabled={!selectedShapeId || shapes.length <= 1}
              title={lang['editor.deleteShape']}
            >
              <DeleteOutlineIcon style={{ fontSize: 16 }} />
            </button>
          </div>
        </div>
        <div className={styles.shapeList}>
          {shapes.map((shape, index) => {
            const typeInfo = SHAPE_TYPES.find((t) => t.value === shape.type) ?? SHAPE_TYPES[0];
            const isSelected = shape.id === selectedShapeId;
            return (
              <div key={shape.id}>
                <div
                  className={clsx(styles.shapeListItem, {
                    [styles.shapeListItemSelected]: isSelected,
                  })}
                  onClick={() => onSelectShape(shape.id)}
                >
                  <span className={styles.shapeListItemIcon}>{typeInfo.icon}</span>
                  <span>
                    {lang['editor.shape']} {index + 1}
                  </span>
                  {isSelected && (
                    <div className={styles.layerActions}>
                      <button
                        className={styles.layerBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveLayerUp();
                        }}
                        title="Move Up"
                      >
                        <ArrowUpwardIcon style={{ fontSize: 12 }} />
                      </button>
                      <button
                        className={styles.layerBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveLayerDown();
                        }}
                        title="Move Down"
                      >
                        <ArrowDownwardIcon style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  )}
                  <span className={styles.shapeListItemSize}>
                    {Math.round(shape.width)}x{Math.round(shape.height)}
                  </span>
                </div>
                {isSelected && (
                  <div className={styles.shapeProps}>
                    <div className={styles.shapeTypeRow}>
                      {SHAPE_TYPES.map((st) => (
                        <button
                          key={st.value}
                          className={clsx(styles.shapeTypeBtn, {
                            [styles.shapeTypeBtnActive]: shape.type === st.value,
                          })}
                          title={st.label}
                          onClick={() => {
                            const newShapes = shapes.map((s) =>
                              s.id === shape.id ? { ...s, type: st.value } : s,
                            );
                            commitShapes(newShapes);
                          }}
                        >
                          {st.icon}
                        </button>
                      ))}
                    </div>
                    <label className={styles.shapePropLabel}>
                      <span>{lang['editor.shapeRadius'] ?? 'Radius'}</span>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={shape.radius}
                        onChange={(e) => {
                          const newShapes = shapes.map((s) =>
                            s.id === shape.id ? { ...s, radius: Number(e.target.value) } : s,
                          );
                          onShapesChange(newShapes);
                        }}
                        onPointerUp={() => historyRef.current.push(shapes)}
                      />
                    </label>
                    <label className={styles.shapePropLabel}>
                      <span>{lang['editor.shapeRoundness'] ?? 'Roundness'}</span>
                      <input
                        type="range"
                        min={2}
                        max={7}
                        step={0.1}
                        value={shape.roundness}
                        onChange={(e) => {
                          const newShapes = shapes.map((s) =>
                            s.id === shape.id ? { ...s, roundness: Number(e.target.value) } : s,
                          );
                          onShapesChange(newShapes);
                        }}
                        onPointerUp={() => historyRef.current.push(shapes)}
                      />
                    </label>
                    <label className={styles.shapePropLabel}>
                      <span>Rotation</span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={Math.round((shape.rotation * 180) / Math.PI)}
                        onChange={(e) => {
                          const deg = Number(e.target.value);
                          const newShapes = shapes.map((s) =>
                            s.id === shape.id ? { ...s, rotation: (deg * Math.PI) / 180 } : s,
                          );
                          onShapesChange(newShapes);
                        }}
                        onPointerUp={() => historyRef.current.push(shapes)}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
