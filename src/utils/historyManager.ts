/**
 * Snapshot-based undo/redo history manager using the command pattern.
 *
 * Each push stores a deep clone of the full state (e.g. the shapes array).
 * History is capped at a configurable maximum number of steps (default 50).
 */

export interface ShapeDef {
  id: string;
  type: 'rect' | 'circle' | 'triangle' | 'star' | 'hexagon' | 'pill' | 'cross' | 'heart';
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  roundness: number;
  rotation: number;
  zIndex: number;
}

export interface Command<T> {
  execute(): T;
  undo(): T;
}

export class HistoryManager<T> {
  private stack: T[] = [];
  private pointer: number = -1;
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  push(state: T): void {
    // Discard any redo states
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push(structuredClone(state));
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.pointer++;
    }
  }

  undo(): T | null {
    if (!this.canUndo()) return null;
    this.pointer--;
    return structuredClone(this.stack[this.pointer]);
  }

  redo(): T | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    return structuredClone(this.stack[this.pointer]);
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  current(): T | null {
    if (this.pointer < 0) return null;
    return structuredClone(this.stack[this.pointer]);
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
  }
}
