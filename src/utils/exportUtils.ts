/**
 * Capture canvas as PNG blob and trigger download
 */
export function exportCanvasPNG(
  canvas: HTMLCanvasElement,
  filename: string = 'liquid-glass.png',
  scale: number = 1,
): void {
  if (scale === 1) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  } else {
    // For higher resolution, create offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width * scale;
    offscreen.height = canvas.height * scale;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height);
    offscreen.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}

/**
 * Video recorder wrapper using MediaRecorder API
 */
export class CanvasRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  start(canvas: HTMLCanvasElement, fps: number = 30): boolean {
    try {
      this.stream = canvas.captureStream(fps);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      this.chunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.start(100); // collect data every 100ms
      return true;
    } catch (err) {
      console.error('[Liquid Glass] Recording failed:', err);
      return false;
    }
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        this.chunks = [];
        this.stream = null;
        this.mediaRecorder = null;
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Encode control values to URL hash for sharing
 */
export function encodePresetToURL(controls: Record<string, any>): string {
  // Only encode glass-related controls, not debug/editor settings
  const shareableKeys = [
    'refThickness', 'refFactor', 'refDispersion',
    'refFresnelRange', 'refFresnelHardness', 'refFresnelFactor',
    'glareRange', 'glareHardness', 'glareFactor',
    'glareConvergence', 'glareOppositeFactor', 'glareAngle',
    'blurRadius', 'blurEdge', 'tint',
    'shadowExpand', 'shadowFactor', 'shadowPosition',
    'emissiveColor', 'emissiveIntensity', 'emissivePulse',
    'shapeWidth', 'shapeHeight', 'shapeRadius', 'shapeRoundness',
  ];

  const filtered: Record<string, any> = {};
  for (const key of shareableKeys) {
    if (key in controls) {
      filtered[key] = controls[key];
    }
  }

  try {
    const json = JSON.stringify(filtered);
    const encoded = btoa(json);
    return encoded;
  } catch {
    return '';
  }
}

/**
 * Decode preset from URL hash
 */
export function decodePresetFromURL(hash: string): Record<string, any> | null {
  try {
    const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!cleaned) return null;
    const json = atob(cleaned);
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save preset to localStorage
 */
export interface SavedPreset {
  id: string;
  name: string;
  timestamp: string;
  values: Record<string, any>;
}

const STORAGE_KEY = 'liquid-glass-presets';

export function savePresetToStorage(name: string, values: Record<string, any>): SavedPreset {
  const presets = loadPresetsFromStorage();
  const preset: SavedPreset = {
    id: `preset_${Date.now()}`,
    name,
    timestamp: new Date().toISOString(),
    values: structuredClone(values),
  };
  presets.push(preset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  return preset;
}

export function loadPresetsFromStorage(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedPreset[];
  } catch {
    return [];
  }
}

export function deletePresetFromStorage(id: string): void {
  const presets = loadPresetsFromStorage().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function renamePresetInStorage(id: string, newName: string): void {
  const presets = loadPresetsFromStorage();
  const preset = presets.find((p) => p.id === id);
  if (preset) {
    preset.name = newName;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }
}
