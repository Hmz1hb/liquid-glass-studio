import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import styles from './App.module.scss';
import {
  createEmptyTexture,
  createHDRTexture,
  loadTextureFromURL,
  MultiPassRenderer,
  updateVideoTexture,
} from './utils/GLUtils';
import { isHDRFile, loadHDRFile } from './utils/hdrLoader';
import { ResizableWindow } from './components/ResizableWindow';
import type { ResizeWindowCtrlRefType } from './components/ResizableWindow/ResizableWindow';

import VertexShader from './shaders/vertex.glsl?raw';
import FragmentBgShader from './shaders/fragment-bg.glsl?raw';
import FragmentBgVblurShader from './shaders/fragment-bg-vblur.glsl?raw';
import FragmentBgHblurShader from './shaders/fragment-bg-hblur.glsl?raw';
import FragmentMainShader from './shaders/fragment-main.glsl?raw';
import { Controller } from '@react-spring/web';

// import { useResizeObserver } from './utils/useResizeOberver';
import clsx from 'clsx';
import { capitalize, computeGaussianKernelByRadius } from './utils';
import { EditorMode, createDefaultShape, SHAPE_TYPE_INDEX } from './components/EditorMode';
import type { ShapeDef } from './components/EditorMode';
import { LightEditor, createDefaultLight } from './components/LightEditor/LightEditor';
import type { LightDef } from './components/LightEditor/LightEditor';

import bgGrid from '@/assets/bg-grid.png';
import bgBars from '@/assets/bg-bars.png';
import bgHalf from '@/assets/bg-half.png';
import bgTimcook from '@/assets/bg-timcook.png';
import bgUI from '@/assets/bg-ui.svg';
import bgTahoeLightImg from '@/assets/bg-tahoe-light.webp';
import bgText from '@/assets/bg-text.jpg';
import bgBuildings from '@/assets/bg-buildings.png';
import bgVideoFish from '@/assets/bg-video-fish.mp4';
import bgVideo2 from '@/assets/bg-video-2.mp4';
import bgVideo3 from '@/assets/bg-video-3.mp4';

import XIcon from '@mui/icons-material/X';
import GitHubIcon from '@mui/icons-material/GitHub';
import PlayCircleOutlinedIcon from '@mui/icons-material/PlayCircleOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { useLevaControls } from './Controls';
import { PresetControls } from './components/PresetControls/PresetControls';
import { SHOWCASE_DEMOS, getShowcaseFrame } from './utils/showcaseAnimations';
import {
  createUIContentCanvas,
  renderUIContent,
  uploadCanvasTexture,
  type UIContentType,
} from './utils/uiContentRenderer';
import { generateTextSDF, uploadTextSDFTexture, SDF_RANGE } from './utils/textSDF';
import { exportCanvasPNG, decodePresetFromURL, encodePresetToURL, CanvasRecorder, downloadBlob, savePresetToStorage, loadPresetsFromStorage, deletePresetFromStorage } from './utils/exportUtils';
import type { SavedPreset } from './utils/exportUtils';
import { KeyboardShortcutManager } from './utils/keyboardShortcuts';
import { PhysicsEngine } from './utils/physicsEngine';

// WebGPU imports
import { WebGPUMultiPassRenderer, isWebGPUAvailable } from './utils/WebGPURenderer';
import type { WebGPUTextureHandle } from './utils/WebGPURenderer';
import WGSLVertexShader from './shaders/wgsl/vertex.wgsl?raw';
import WGSLFragmentBgShader from './shaders/wgsl/fragment-bg.wgsl?raw';
import WGSLFragmentBgVblurShader from './shaders/wgsl/fragment-bg-vblur.wgsl?raw';
import WGSLFragmentBgHblurShader from './shaders/wgsl/fragment-bg-hblur.wgsl?raw';
import WGSLFragmentMainShader from './shaders/wgsl/fragment-main.wgsl?raw';

// Sellmeier presets: B and C coefficients
const SELLMEIER_PRESETS: Record<string, { B: [number, number, number]; C: [number, number, number] }> = {
  crown: { B: [1.03961, 0.23179, 1.01047], C: [0.00600, 0.02002, 103.56] },
  flint: { B: [1.34534, 0.20907, 0.93736], C: [0.00998, 0.04706, 111.89] },
  diamond: { B: [0.33061, 4.33566, 0.0], C: [0.01750, 0.10640, 0.0] },
  water: { B: [0.75831, 0.08495, 0.0], C: [0.01008, 8.91377, 0.0] },
  custom: { B: [1.0, 0.2, 1.0], C: [0.006, 0.02, 100.0] },
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasInfo, setCanvasInfo] = useState<{ width: number; height: number; dpr: number }>({
    width: Math.max(Math.min(window.innerWidth, window.innerHeight) - 150, 600),
    height: Math.max(Math.min(window.innerWidth, window.innerHeight) - 150, 600),
    dpr: 1,
  });

  // Backend selection state
  const [useWebGPU, setUseWebGPU] = useState(false);
  const [perfInfo, setPerfInfo] = useState<{ backend: string; fps: number; frameMs: number } | null>(null);

  // Editor mode shape state
  const [editorShapes, setEditorShapes] = useState<ShapeDef[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const editorShapesRef = useRef<ShapeDef[]>([]);
  editorShapesRef.current = editorShapes;

  // Physics engine
  const physicsRef = useRef(new PhysicsEngine());
  const dragVelocityRef = useRef<{ id: string; lastX: number; lastY: number; lastTime: number } | null>(null);

  // Light editor state
  const [lights, setLights] = useState<LightDef[]>([]);
  const lightsRef = useRef<LightDef[]>([]);
  lightsRef.current = lights;

  // Fullscreen mode
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Video recording state
  const [isRecording, setIsRecording] = useState(false);
  const recorderRef = useRef<CanvasRecorder | null>(null);

  // User preset state
  const [userPresets, setUserPresets] = useState<SavedPreset[]>(() => loadPresetsFromStorage());
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  // Showcase animation state
  const [activeShowcase, setActiveShowcase] = useState<string | null>(null);
  const showcaseStartRef = useRef<number>(0);
  const preShowcaseControls = useRef<Record<string, any> | null>(null);
  const activeShowcaseRef = useRef<string | null>(null);
  activeShowcaseRef.current = activeShowcase;
  const controlsAPIRef = useRef<any>(null);

  const { controls, lang, langName, levaGlobal, controlsAPI } = useLevaControls({
    containerRender: {
      /* eslint-disable react-hooks/rules-of-hooks */
      bgType: ({ value, setValue }) => {
        const [customFileType, setCustomFileType] = useState<null | 'image' | 'video' | 'hdr'>(null);
        const [customFile, setCustomFile] = useState<null | File>(null);
        const [customFileUrl, setCustomFileUrl] = useState<null | string>(null);
        const fileInputRef = useRef<HTMLInputElement>(null);

        return (
          <div className={styles.bgSelect}>
            {[
              { v: 11, media: '', loadTexture: true, type: 'custom' as const },
              { v: 0, media: bgGrid, loadTexture: false },
              { v: 1, media: bgBars, loadTexture: false },
              { v: 2, media: bgHalf, loadTexture: false },
              { v: 3, media: bgTahoeLightImg, loadTexture: true },
              { v: 4, media: bgBuildings, loadTexture: true },
              { v: 5, media: bgText, loadTexture: true },
              { v: 6, media: bgTimcook, loadTexture: true },
              { v: 7, media: bgUI, loadTexture: true },
              { v: 8, media: bgVideoFish, loadTexture: true, type: 'video' as const },
              { v: 9, media: bgVideo2, loadTexture: true, type: 'video' as const },
              { v: 10, media: bgVideo3, loadTexture: true, type: 'video' as const },
            ].map(({ v, media, loadTexture, type }) => {
              const mediaType = type === 'custom' ? customFileType : (type ?? 'image');
              const mediaUrl = type === 'custom' ? customFileUrl : media;
              return (
                <div
                  className={clsx(
                    styles.bgSelectItem,
                    styles[`bgSelectItemType${capitalize(type ?? 'image')}`],
                    {
                      [styles.bgSelectItemActive]: value === v,
                    },
                  )}
                  // style={{ backgroundImage: !type ? `url(${media})` : '' }}
                  key={v}
                  onClick={() => {
                    if (type === 'custom') {
                      if (!mediaUrl) {
                        fileInputRef.current?.click();
                      } else if (value === v) {
                        fileInputRef.current?.click();
                      }
                    }
                    setValue(v);
                    if (loadTexture && mediaUrl) {
                      stateRef.current.bgTextureUrl = mediaUrl;
                      if (mediaType === 'video') {
                        stateRef.current.bgTextureType = 'video';
                      } else if (mediaType === 'hdr') {
                        stateRef.current.bgTextureType = 'hdr';
                      } else {
                        stateRef.current.bgTextureType = 'image';
                      }
                    } else {
                      stateRef.current.bgTextureUrl = null;
                      stateRef.current.bgTextureReady = false;
                    }
                  }}
                >
                  {mediaUrl &&
                    (mediaType === 'video' ? (
                      <video
                        playsInline
                        muted={true}
                        loop
                        className={styles.bgSelectItemVideo}
                        ref={(ref) => {
                          if (ref) {
                            stateRef.current.bgVideoEls.set(v, ref);
                          } else {
                            stateRef.current.bgVideoEls.delete(v);
                          }
                        }}
                      >
                        <source src={mediaUrl}></source>
                      </video>
                    ) : mediaType === 'image' ? (
                      <img src={mediaUrl} className={styles.bgSelectItemImg} />
                    ) : null)}
                  {type === 'custom' ? (
                    <>
                      <input
                        type="file"
                        accept="image/*,video/*,.hdr"
                        ref={fileInputRef}
                        multiple={false}
                        onChange={(e) => {
                          if (!e.target.files?.[0]) {
                            return;
                          }
                          const file = e.target.files[0];
                          setCustomFile(file);
                          if (customFileUrl) {
                            URL.revokeObjectURL(customFileUrl);
                          }
                          const newUrl = URL.createObjectURL(file);
                          setCustomFileUrl(newUrl);
                          const fileType: 'image' | 'video' | 'hdr' = isHDRFile(file)
                            ? 'hdr'
                            : file.type.startsWith('image/')
                              ? 'image'
                              : file.type.startsWith('video/')
                                ? 'video'
                                : 'image';
                          setCustomFileType(fileType);
                          setValue(v);
                          stateRef.current.bgTextureUrl = newUrl;
                          stateRef.current.bgTextureType = fileType;
                          if (fileType === 'hdr') {
                            stateRef.current.hdrFile = file;
                          }
                        }}
                      ></input>
                      <FileUploadOutlinedIcon />
                    </>
                  ) : null}
                  <div
                    className={clsx(
                      styles.bgSelectItemOverlay,
                      styles[`bgSelectItemOverlay${capitalize(type ?? 'image')}`],
                    )}
                  >
                    {mediaType === 'video' && (
                      <PlayCircleOutlinedIcon
                        className={styles.bgSelectItemVideoIcon}
                        style={{
                          opacity: value !== v ? 1 : 0,
                        }}
                      />
                    )}
                    {type === 'custom' && (
                      <div className={styles.bgSelectItemCustomIcon}>
                        <FileUploadOutlinedIcon />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      },
      /* eslint-enable react-hooks/rules-of-hooks */
    },
  });

  const stateRef = useRef<{
    canvasWindowCtrlRef: ResizeWindowCtrlRefType | null;
    renderRaf: number | null;
    canvasInfo: typeof canvasInfo;
    glStates: {
      gl: WebGL2RenderingContext;
      programs: Record<string, WebGLProgram>;
      vao: WebGLVertexArrayObject;
    } | null;
    canvasPos: { x: number; y: number };
    canvasPointerPos: { x: number; y: number };
    controls: typeof controls;
    blurWeights: number[];
    lastMouseSpringValue: { x: number; y: number };
    lastMouseSpringTime: null | number;
    mouseSpring: Controller<{ x: number; y: number }>;
    mouseSpringSpeed: { x: number; y: number };
    bgTextureUrl: string | null;
    bgTexture: WebGLTexture | null;
    bgTextureRatio: number;
    bgTextureType: 'image' | 'video' | 'hdr' | null;
    hdrFile: File | null;
    isHDRContent: boolean;
    bgTextureReady: boolean;
    bgVideoEls: Map<number, HTMLVideoElement>;
    langName: typeof langName;
    uiContentCanvas: HTMLCanvasElement | null;
    uiContentTexture: WebGLTexture | null;
    textSDFTexture: WebGLTexture | null;
    textSDFDirty: boolean;
    lastTextContent: string;
    lastTextSize: number;
    lastTextFont: string;
    lastTextEnabled: boolean;
    startTime: number | null;
  }>({
    canvasWindowCtrlRef: null,
    renderRaf: null,
    glStates: null,
    canvasInfo,
    canvasPos: {
      x: 0,
      y: 0,
    },
    canvasPointerPos: {
      x: 0,
      y: 0,
    },
    controls,
    blurWeights: [],
    lastMouseSpringValue: {
      x: 0,
      y: 0,
    },
    lastMouseSpringTime: null,
    mouseSpring: new Controller({
      x: 0,
      y: 0,
      onChange: (c) => {
        if (!stateRef.current.lastMouseSpringTime) {
          stateRef.current.lastMouseSpringTime = Date.now();
          stateRef.current.lastMouseSpringValue = c.value;
          return;
        }

        const now = Date.now();
        const lastValue = stateRef.current.lastMouseSpringValue;
        const dt = now - stateRef.current.lastMouseSpringTime;
        const dx = {
          x: c.value.x - lastValue.x,
          y: c.value.y - lastValue.y,
        };
        const speed = {
          x: dx.x / dt,
          y: dx.y / dt,
        };

        if (Math.abs(speed.x) > 1e10 || Math.abs(speed.y) > 1e10) {
          speed.x = 0;
          speed.y = 0;
        }

        stateRef.current.mouseSpringSpeed = speed;

        stateRef.current.lastMouseSpringValue = c.value;
        stateRef.current.lastMouseSpringTime = now;
      },
    }),
    mouseSpringSpeed: {
      x: 0,
      y: 0,
    },
    bgTextureUrl: null,
    bgTexture: null,
    bgTextureRatio: 1,
    bgTextureType: null,
    hdrFile: null,
    isHDRContent: false,
    bgTextureReady: false,
    bgVideoEls: new Map(),
    langName: langName,
    uiContentCanvas: null,
    uiContentTexture: null,
    textSDFTexture: null,
    textSDFDirty: true,
    lastTextContent: '',
    lastTextSize: 0,
    lastTextFont: '',
    lastTextEnabled: false,
    lastTextSuperSample: 0,
    lastTextCanvasWidth: 0,
    lastTextCanvasHeight: 0,
    lastTextCanvasDpr: 0,
    startTime: null,
  });
  stateRef.current.canvasInfo = canvasInfo;
  stateRef.current.controls = controls;
  controlsAPIRef.current = controlsAPI;
  stateRef.current.langName = langName;

  // Load preset from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const preset = decodePresetFromURL(hash);
      if (preset && typeof controlsAPI === 'function') {
        controlsAPI(preset);
      }
    }
  }, []);

  // Sync WebGPU toggle from controls to state (triggers effect re-run)
  useEffect(() => {
    if (controls.useWebGPU !== useWebGPU) {
      setUseWebGPU(controls.useWebGPU);
    }
  }, [controls.useWebGPU]);

  // Initialize editor shapes when editor mode is first enabled
  const prevEditorMode = useRef(false);
  useEffect(() => {
    if (controls.editorMode && !prevEditorMode.current) {
      // Entering editor mode: seed with one shape at center
      if (editorShapes.length === 0) {
        const initial = createDefaultShape(canvasInfo.width, canvasInfo.height);
        initial.width = controls.shapeWidth;
        initial.height = controls.shapeHeight;
        initial.radius = controls.shapeRadius;
        initial.roundness = controls.shapeRoundness;
        initial.rotation = 0;
        initial.zIndex = 0;
        setEditorShapes([initial]);
        setSelectedShapeId(initial.id);
      }
    }
    prevEditorMode.current = controls.editorMode;
  }, [controls.editorMode]);

  // Phase 5: Wrap setEditorShapes to track drag velocity for physics impulses
  const handleShapesChange = useCallback((newShapes: ShapeDef[] | ((prev: ShapeDef[]) => ShapeDef[])) => {
    setEditorShapes((prev) => {
      const shapes = typeof newShapes === 'function' ? newShapes(prev) : newShapes;
      const physics = physicsRef.current;
      if (physics.isEnabled()) {
        const now = performance.now();
        for (const s of shapes) {
          const old = prev.find(p => p.id === s.id);
          if (old && (old.x !== s.x || old.y !== s.y)) {
            // Shape moved - track velocity
            const vel = dragVelocityRef.current;
            if (vel && vel.id === s.id) {
              const dt = Math.max(now - vel.lastTime, 1) / 1000;
              const vx = (s.x - vel.lastX) / dt;
              const vy = (s.y - vel.lastY) / dt;
              vel.lastX = s.x;
              vel.lastY = s.y;
              vel.lastTime = now;
              // Update rest position while dragging
              physics.setPosition(s.id, s.x, s.y);
            } else {
              dragVelocityRef.current = { id: s.id, lastX: s.x, lastY: s.y, lastTime: now };
              physics.setPosition(s.id, s.x, s.y);
            }
          }
        }
        // Check for drag end: if a shape that was being tracked hasn't moved, apply impulse
        if (dragVelocityRef.current) {
          const velShape = shapes.find(s => s.id === dragVelocityRef.current!.id);
          const oldShape = prev.find(s => s.id === dragVelocityRef.current!.id);
          if (velShape && oldShape && velShape.x === oldShape.x && velShape.y === oldShape.y) {
            // No movement this frame - drag likely ended
            // Impulse is handled via the velocity already tracked
          }
        }
      }
      return shapes;
    });
  }, []);

  // Sync light count from controls
  const prevLightCount = useRef(0);
  useEffect(() => {
    const targetCount = controls.lightCount;
    if (targetCount !== prevLightCount.current) {
      setLights((prev) => {
        if (targetCount > prev.length) {
          const newLights = [...prev];
          for (let i = prev.length; i < targetCount; i++) {
            newLights.push(createDefaultLight(i, canvasInfo.width, canvasInfo.height));
          }
          return newLights;
        } else if (targetCount < prev.length) {
          return prev.slice(0, targetCount);
        }
        return prev;
      });
      prevLightCount.current = targetCount;
    }
  }, [controls.lightCount, canvasInfo.width, canvasInfo.height]);

  // useEffect(() => {
  //   setLangName(controls.language[0] as keyof typeof languages);
  // }, [controls.language]);

  // console.log(controls.language);

  useMemo(() => {
    stateRef.current.blurWeights = computeGaussianKernelByRadius(controls.blurRadius);
  }, [controls.blurRadius]);

  const startShowcase = useCallback((id: string) => {
    preShowcaseControls.current = structuredClone(controls);
    showcaseStartRef.current = performance.now() / 1000;
    setActiveShowcase(id);
  }, [controls]);

  const stopShowcase = useCallback(() => {
    setActiveShowcase(null);
    if (preShowcaseControls.current && typeof controlsAPI === 'function') {
      controlsAPI(preShowcaseControls.current);
      preShowcaseControls.current = null;
    }
  }, [controlsAPI]);

  const handleExportPNG = useCallback(() => {
    if (canvasRef.current) {
      exportCanvasPNG(canvasRef.current, 'liquid-glass.png', 1);
    }
  }, []);

  const handleShareURL = useCallback(() => {
    const encoded = encodePresetToURL(controls);
    if (encoded) {
      window.location.hash = encoded;
      navigator.clipboard?.writeText(window.location.href).catch(() => {});
    }
  }, [controls]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
  }, []);

  // Video recording handlers
  const handleStartRecording = useCallback(() => {
    if (!canvasRef.current || isRecording) return;
    const recorder = new CanvasRecorder();
    const ok = recorder.start(canvasRef.current, 30);
    if (ok) {
      recorderRef.current = recorder;
      setIsRecording(true);
    }
  }, [isRecording]);

  const handleStopRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    const blob = await recorderRef.current.stop();
    recorderRef.current = null;
    setIsRecording(false);
    if (blob) {
      downloadBlob(blob, `liquid-glass-${Date.now()}.webm`);
    }
  }, []);

  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStartRecording, handleStopRecording]);

  // User preset handlers
  const handleSavePreset = useCallback(() => {
    const name = prompt('Preset name:');
    if (!name) return;
    savePresetToStorage(name, controls);
    setUserPresets(loadPresetsFromStorage());
  }, [controls]);

  const handleLoadPreset = useCallback((preset: SavedPreset) => {
    if (typeof controlsAPI === 'function') {
      controlsAPI(preset.values);
    }
    setShowPresetMenu(false);
  }, [controlsAPI]);

  const handleDeletePreset = useCallback((id: string) => {
    deletePresetFromStorage(id);
    setUserPresets(loadPresetsFromStorage());
  }, []);

  // Close preset menu when clicking outside
  useEffect(() => {
    if (!showPresetMenu) return;
    const onClick = () => setShowPresetMenu(false);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [showPresetMenu]);

  // Keyboard shortcuts via KeyboardShortcutManager
  useEffect(() => {
    const mgr = new KeyboardShortcutManager();
    mgr.registerMany([
      { key: 'f', description: 'Toggle fullscreen', action: () => setIsFullscreen((v) => !v) },
      { key: 'Escape', description: 'Exit fullscreen', action: () => setIsFullscreen(false) },
      { key: '/', shift: true, description: 'Show keyboard shortcuts', action: () => {
        const shortcuts = mgr.getAll();
        const msg = shortcuts.map((s) => `${mgr.getShortcutLabel(s)}: ${s.description}`).join('\n');
        alert('Keyboard Shortcuts:\n\n' + msg);
      }},
    ]);
    return () => mgr.dispose();
  }, []);

  const centerizeCanvasWindow = useCallback(() => {
    const ctrl = stateRef.current.canvasWindowCtrlRef;
    if (!ctrl) {
      return;
    }
    const size = ctrl.getSize();
    ctrl.setMoveOffset({
      x: window.innerWidth / 2 - size.width / 2,
      y: window.innerHeight / 2 - size.height / 2,
    });
  }, []);

  useLayoutEffect(() => {
    const onResize = () => {
      centerizeCanvasWindow();
      setCanvasInfo((v) => ({
        ...v,
        dpr: window.devicePixelRatio,
      }));
    };
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useLayoutEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    canvasRef.current.width = canvasInfo.width * canvasInfo.dpr;
    canvasRef.current.height = canvasInfo.height * canvasInfo.dpr;
  }, [canvasInfo]);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }

    const canvasEl = canvasRef.current;
    const onPointerMove = (e: PointerEvent) => {
      const canvasInfo = stateRef.current.canvasInfo;
      if (!canvasInfo) {
        return;
      }
      // In editor mode, don't update mouse tracking for shapes
      if (stateRef.current.controls.editorMode) {
        return;
      }
      stateRef.current.canvasPointerPos = {
        x: (e.clientX - stateRef.current.canvasPos.x) * canvasInfo.dpr,
        y:
          (stateRef.current.canvasInfo.height - (e.clientY - stateRef.current.canvasPos.y)) *
          canvasInfo.dpr,
      };
      stateRef.current.mouseSpring.start(stateRef.current.canvasPointerPos);
    };
    canvasEl.addEventListener('pointermove', onPointerMove);

    // ── Backend-agnostic renderer references ──
    let glRenderer: MultiPassRenderer | null = null;
    let gpuRenderer: WebGPUMultiPassRenderer | null = null;
    let gl: WebGL2RenderingContext | null = null;
    const isGPU = useWebGPU && isWebGPUAvailable();

    // WebGPU-specific texture state (lives alongside WebGL state in stateRef)
    let gpuBgTexture: WebGPUTextureHandle | null = null;
    let gpuUiContentTexture: WebGPUTextureHandle | null = null;
    let gpuTextSDFTexture: WebGPUTextureHandle | null = null;

    let disposed = false;

    const initAndRun = async () => {
      if (disposed) return;

      if (isGPU) {
        // ── WebGPU backend ──
        gpuRenderer = new WebGPUMultiPassRenderer(canvasEl);
        const ok = await gpuRenderer.init([
          {
            name: 'bgPass',
            vertexShader: WGSLVertexShader,
            fragmentShader: WGSLFragmentBgShader,
          },
          {
            name: 'vBlurPass',
            vertexShader: WGSLVertexShader,
            fragmentShader: WGSLFragmentBgVblurShader,
            inputs: { u_prevPassTexture: 'bgPass' },
          },
          {
            name: 'hBlurPass',
            vertexShader: WGSLVertexShader,
            fragmentShader: WGSLFragmentBgHblurShader,
            inputs: { u_prevPassTexture: 'vBlurPass' },
          },
          {
            name: 'mainPass',
            vertexShader: WGSLVertexShader,
            fragmentShader: WGSLFragmentMainShader,
            inputs: {
              u_blurredBg: 'hBlurPass',
              u_bg: 'bgPass',
            },
            outputToScreen: true,
          },
        ]);
        if (!ok || disposed) {
          console.warn('[Liquid Glass] WebGPU init failed, falling back to WebGL2');
          gpuRenderer?.dispose();
          gpuRenderer = null;
          // Fall through to WebGL2
        }
      }

      if (!gpuRenderer) {
        // ── WebGL2 backend ──
        try {
          gl = canvasEl.getContext('webgl2', { colorSpace: 'display-p3' } as WebGLContextAttributes);
          if (gl) {
            try {
              (gl as any).drawingBufferColorSpace = 'display-p3';
              console.log('[Liquid Glass] 10-bit display-p3 canvas enabled');
            } catch {
              console.log('[Liquid Glass] display-p3 drawingBufferColorSpace not supported, using sRGB');
            }
          }
        } catch {
          gl = canvasEl.getContext('webgl2');
        }
        if (!gl) return;

        glRenderer = new MultiPassRenderer(canvasEl, [
          {
            name: 'bgPass',
            shader: { vertex: VertexShader, fragment: FragmentBgShader },
          },
          {
            name: 'vBlurPass',
            shader: { vertex: VertexShader, fragment: FragmentBgVblurShader },
            inputs: { u_prevPassTexture: 'bgPass' },
          },
          {
            name: 'hBlurPass',
            shader: { vertex: VertexShader, fragment: FragmentBgHblurShader },
            inputs: { u_prevPassTexture: 'vBlurPass' },
          },
          {
            name: 'mainPass',
            shader: { vertex: VertexShader, fragment: FragmentMainShader },
            inputs: { u_blurredBg: 'hBlurPass', u_bg: 'bgPass' },
            outputToScreen: true,
          },
        ]);
      }

      if (disposed) return;

      // Helper: current renderer API
      const renderer = gpuRenderer ?? glRenderer!;
      const isWebGPUActive = !!gpuRenderer;
      const backendLabel = isWebGPUActive ? 'WebGPU' : 'WebGL2';

      // FPS tracking with frame time
      let fpsFrameCount = 0;
      let fpsLastTime = performance.now();
      let frameMsAccum = 0;
      let lastFrameTime = performance.now();
      const updatePerfInfo = (now: number) => {
        const dt = now - lastFrameTime;
        lastFrameTime = now;
        frameMsAccum += dt;
        fpsFrameCount++;
        if (now - fpsLastTime >= 1000) {
          const fps = Math.round(fpsFrameCount * 1000 / (now - fpsLastTime));
          const avgMs = +(frameMsAccum / fpsFrameCount).toFixed(2);
          setPerfInfo({ backend: backendLabel, fps, frameMs: avgMs });
          fpsFrameCount = 0;
          frameMsAccum = 0;
          fpsLastTime = now;
        }
      };

      let raf: number | null = null;
      const lastState = {
        canvasInfo: null as typeof canvasInfo | null,
        controls: null as typeof controls | null,
        bgTextureType: null as typeof stateRef.current.bgTextureType,
        bgTextureUrl: null as typeof stateRef.current.bgTextureUrl,
      };

      const render = () => {
        if (disposed) return;
        raf = requestAnimationFrame(render);

        const now = performance.now();
        updatePerfInfo(now);
        if (!stateRef.current.startTime) {
          stateRef.current.startTime = now;
        }
        const elapsedTime = (now - stateRef.current.startTime) / 1000.0;

        const canvasInfo = stateRef.current.canvasInfo;
        const textureUrl = stateRef.current.bgTextureUrl;

        if (
          !lastState.canvasInfo ||
          lastState.canvasInfo.width !== canvasInfo.width ||
          lastState.canvasInfo.height !== canvasInfo.height ||
          lastState.canvasInfo.dpr !== canvasInfo.dpr
        ) {
          if (gl && !isWebGPUActive) {
            gl.viewport(0, 0,
              Math.round(canvasInfo.width * canvasInfo.dpr),
              Math.round(canvasInfo.height * canvasInfo.dpr));
          }
          renderer.resize(canvasInfo.width * canvasInfo.dpr, canvasInfo.height * canvasInfo.dpr);
          renderer.setUniform('u_resolution', [
            canvasInfo.width * canvasInfo.dpr,
            canvasInfo.height * canvasInfo.dpr,
          ]);
        }

        // ── Texture loading ──
        if (textureUrl !== lastState.bgTextureUrl) {
          if (lastState.bgTextureType === 'video') {
            if (lastState.controls?.bgType !== undefined) {
              stateRef.current.bgVideoEls.get(lastState.controls.bgType)?.pause();
            }
          }
          if (!textureUrl) {
            if (isWebGPUActive) {
              gpuBgTexture = null;
            } else if (stateRef.current.bgTexture) {
              gl!.deleteTexture(stateRef.current.bgTexture);
              stateRef.current.bgTexture = null;
            }
            stateRef.current.bgTextureType = null;
            stateRef.current.isHDRContent = false;
            stateRef.current.bgTextureReady = false;
          } else {
            if (stateRef.current.bgTextureType === 'image') {
              stateRef.current.isHDRContent = false;
              stateRef.current.bgTextureReady = false;
              if (isWebGPUActive) {
                gpuRenderer!.loadTexture(textureUrl).then(({ handle, ratio }) => {
                  if (stateRef.current.bgTextureUrl === textureUrl) {
                    gpuBgTexture = handle;
                    stateRef.current.bgTextureRatio = ratio;
                    stateRef.current.bgTextureReady = true;
                  }
                });
              } else {
                const rafId = requestAnimationFrame(() => { stateRef.current.bgTextureReady = false; });
                loadTextureFromURL(gl!, textureUrl).then(({ texture, ratio }) => {
                  if (stateRef.current.bgTextureUrl === textureUrl) {
                    cancelAnimationFrame(rafId);
                    stateRef.current.bgTexture = texture;
                    stateRef.current.bgTextureRatio = ratio;
                    stateRef.current.bgTextureReady = true;
                  }
                });
              }
            } else if (stateRef.current.bgTextureType === 'video') {
              stateRef.current.isHDRContent = false;
              stateRef.current.bgTextureReady = false;
              if (!isWebGPUActive) {
                stateRef.current.bgTexture = createEmptyTexture(gl!);
              }
              stateRef.current.bgVideoEls.get(stateRef.current.controls.bgType)?.play();
            } else if (stateRef.current.bgTextureType === 'hdr' && stateRef.current.hdrFile) {
              stateRef.current.bgTextureReady = false;
              stateRef.current.isHDRContent = true;
              const hdrFile = stateRef.current.hdrFile;
              loadHDRFile(hdrFile).then((hdrData) => {
                if (stateRef.current.bgTextureUrl === textureUrl) {
                  if (isWebGPUActive) {
                    const { handle, ratio } = gpuRenderer!.createHDRTexture(hdrData);
                    gpuBgTexture = handle;
                    stateRef.current.bgTextureRatio = ratio;
                  } else {
                    const { texture, ratio } = createHDRTexture(gl!, hdrData);
                    stateRef.current.bgTexture = texture;
                    stateRef.current.bgTextureRatio = ratio;
                  }
                  stateRef.current.bgTextureReady = true;
                  controlsAPI.set({ hdrEnabled: true, hdrToneMappingType: 2 });
                }
              }).catch((err) => {
                console.error('[Liquid Glass] Failed to load HDR file:', err);
              });
            }
          }
        }
        lastState.controls = stateRef.current.controls;
        lastState.bgTextureType = stateRef.current.bgTextureType;
        lastState.canvasInfo = canvasInfo;
        lastState.bgTextureUrl = stateRef.current.bgTextureUrl;

        // Video frame update
        if (stateRef.current.bgTextureType === 'video') {
          const videoEl = stateRef.current.bgVideoEls.get(stateRef.current.controls.bgType);
          if (videoEl) {
            if (isWebGPUActive) {
              const result = gpuRenderer!.updateVideoTexture(gpuBgTexture, videoEl);
              if (result) {
                gpuBgTexture = result.handle;
                stateRef.current.bgTextureRatio = result.ratio;
                stateRef.current.bgTextureReady = true;
              }
            } else if (stateRef.current.bgTexture) {
              const info = updateVideoTexture(gl!, stateRef.current.bgTexture, videoEl);
              if (info) {
                stateRef.current.bgTextureRatio = info.ratio;
                stateRef.current.bgTextureReady = true;
              }
            }
          }
        }

        if (gl && !isWebGPUActive) {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        const controls = stateRef.current.controls;

        // Showcase animation: apply interpolated values every 3rd frame
        const showcaseId = activeShowcaseRef.current;
        if (showcaseId && fpsFrameCount % 3 === 0) {
          const demo = SHOWCASE_DEMOS.find((d) => d.id === showcaseId);
          if (demo) {
            const elapsed = now / 1000 - showcaseStartRef.current;
            const frame = getShowcaseFrame(demo, elapsed);
            if (typeof controlsAPIRef.current === 'function') {
              controlsAPIRef.current(frame.values);
            }
            if (frame.mouse) {
              const cx = frame.mouse[0] * canvasInfo.width * canvasInfo.dpr;
              const cy = (1 - frame.mouse[1]) * canvasInfo.height * canvasInfo.dpr;
              stateRef.current.mouseSpring.start({ x: cx, y: cy });
            }
          }
        }

        const mouseSpring = stateRef.current.mouseSpring.get();

        const shapeSizeSpring = {
          x: controls.shapeWidth +
            (Math.abs(stateRef.current.mouseSpringSpeed.x) * controls.shapeWidth * controls.springSizeFactor) / 100,
          y: controls.shapeHeight +
            (Math.abs(stateRef.current.mouseSpringSpeed.y) * controls.shapeHeight * controls.springSizeFactor) / 100,
        };

        let editorShapes = editorShapesRef.current;
        const isEditorMode = controls.editorMode && editorShapes.length > 0;

        // Phase 5: Physics step
        const physics = physicsRef.current;
        physics.setEnabled(controls.physicsEnabled && isEditorMode);
        physics.setGravity(controls.physicsGravity);
        physics.setGlobalDamping(controls.physicsDamping);

        if (physics.isEnabled()) {
          // Sync physics bodies with editor shapes
          const editorShapeIds = new Set(editorShapes.map(s => s.id));
          // Remove orphaned physics bodies for deleted shapes
          for (const bodyId of physics.getBodyIds()) {
            if (!editorShapeIds.has(bodyId)) {
              physics.removeBody(bodyId);
            }
          }
          for (const s of editorShapes) {
            const body = physics.getBody(s.id);
            if (!body) {
              physics.addBody(s.id, s.x, s.y, s.width, s.height, controls.physicsStiffness);
            } else {
              body.springStiffness = controls.physicsStiffness;
              body.width = s.width;
              body.height = s.height;
            }
          }

          const updates = physics.step();
          if (updates.size > 0) {
            const newShapes = editorShapes.map(s => {
              const update = updates.get(s.id);
              if (update) return { ...s, x: update.x, y: update.y };
              return s;
            });
            editorShapes = newShapes;
            editorShapesRef.current = newShapes;
          }
        }

        const shapeData: number[] = [];
        const shapeParamsData: number[] = [];
        if (isEditorMode) {
          for (let i = 0; i < 8; i++) {
            if (i < editorShapes.length) {
              const s = editorShapes[i];
              const sx = s.x * canvasInfo.dpr;
              const sy = (canvasInfo.height - s.y) * canvasInfo.dpr;
              const sw = s.width * canvasInfo.dpr;
              const sh = s.height * canvasInfo.dpr;
              const sr = ((Math.min(sw, sh) / 2) * s.radius) / 100;
              const shapeTypeIdx = SHAPE_TYPE_INDEX[s.type] ?? 0;
              shapeData.push(sx, sy, sw, sh);
              shapeParamsData.push(sr, s.roundness, shapeTypeIdx, s.rotation ?? 0);
            } else {
              shapeData.push(0, 0, 0, 0);
              shapeParamsData.push(0, 2, 0, 0);
            }
          }
        }

        renderer.setUniforms({
          u_resolution: [canvasInfo.width * canvasInfo.dpr, canvasInfo.height * canvasInfo.dpr],
          u_dpr: canvasInfo.dpr,
          u_blurWeights: stateRef.current.blurWeights,
          u_blurRadius: stateRef.current.controls.blurRadius,
          u_mouse: [stateRef.current.canvasPointerPos.x, stateRef.current.canvasPointerPos.y],
          u_mouseSpring: isEditorMode ? [0, 0] : [mouseSpring.x, mouseSpring.y],
          u_shapeWidth: shapeSizeSpring.x,
          u_shapeHeight: shapeSizeSpring.y,
          u_shapeRadius:
            ((Math.min(shapeSizeSpring.x, shapeSizeSpring.y) / 2) * controls.shapeRadius) / 100,
          u_shapeRoundness: controls.shapeRoundness,
          u_mergeRate: controls.mergeRate,
          u_glareAngle: (controls.glareAngle * Math.PI) / 180,
          u_showShape1: controls.showShape1 && !controls.textEnabled ? 1 : 0,
          u_shapeCount: isEditorMode ? editorShapes.length : 0,
          u_shapes: isEditorMode ? shapeData : new Array(32).fill(0),
          u_shapeParams: isEditorMode ? shapeParamsData : new Array(32).fill(0),
        });

        // UI Content rendering
        if (controls.uiContentEnabled) {
          const cw = Math.round(canvasInfo.width * canvasInfo.dpr);
          const ch = Math.round(canvasInfo.height * canvasInfo.dpr);
          if (
            !stateRef.current.uiContentCanvas ||
            stateRef.current.uiContentCanvas.width !== cw ||
            stateRef.current.uiContentCanvas.height !== ch
          ) {
            stateRef.current.uiContentCanvas = createUIContentCanvas(cw, ch);
          }
          renderUIContent(
            stateRef.current.uiContentCanvas,
            controls.uiContentType as UIContentType,
            { text: controls.uiContentText },
          );
          if (isWebGPUActive) {
            gpuUiContentTexture = gpuRenderer!.uploadCanvasTexture(
              stateRef.current.uiContentCanvas,
              gpuUiContentTexture,
            );
          } else {
            stateRef.current.uiContentTexture = uploadCanvasTexture(
              gl!,
              stateRef.current.uiContentCanvas,
              stateRef.current.uiContentTexture,
            );
          }
        }

        // Text SDF generation
        if (
          controls.textEnabled !== stateRef.current.lastTextEnabled ||
          controls.textContent !== stateRef.current.lastTextContent ||
          controls.textSize !== stateRef.current.lastTextSize ||
          controls.textFont !== stateRef.current.lastTextFont ||
          controls.textSuperSample !== stateRef.current.lastTextSuperSample ||
          stateRef.current.lastTextCanvasWidth !== canvasInfo.width ||
          stateRef.current.lastTextCanvasHeight !== canvasInfo.height ||
          stateRef.current.lastTextCanvasDpr !== canvasInfo.dpr
        ) {
          stateRef.current.textSDFDirty = true;
          stateRef.current.lastTextEnabled = controls.textEnabled;
          stateRef.current.lastTextContent = controls.textContent;
          stateRef.current.lastTextSize = controls.textSize;
          stateRef.current.lastTextFont = controls.textFont;
          stateRef.current.lastTextSuperSample = controls.textSuperSample;
          stateRef.current.lastTextCanvasWidth = canvasInfo.width;
          stateRef.current.lastTextCanvasHeight = canvasInfo.height;
          stateRef.current.lastTextCanvasDpr = canvasInfo.dpr;
        }

        if (controls.textEnabled && stateRef.current.textSDFDirty) {
          const sdfWidth = Math.round(canvasInfo.width * canvasInfo.dpr);
          const sdfHeight = Math.round(canvasInfo.height * canvasInfo.dpr);
          const sdfResult = generateTextSDF(
            controls.textContent,
            controls.textSize * canvasInfo.dpr,
            controls.textFont,
            sdfWidth,
            sdfHeight,
            controls.textSuperSample,
          );
          if (isWebGPUActive) {
            gpuTextSDFTexture = gpuRenderer!.uploadTextSDFTexture(sdfResult, gpuTextSDFTexture);
          } else {
            stateRef.current.textSDFTexture = uploadTextSDFTexture(
              gl!,
              sdfResult,
              stateRef.current.textSDFTexture,
            );
          }
          stateRef.current.textSDFDirty = false;
        }

        // Build texture uniforms based on backend
        let textSDFTexture: any;
        let bgTexture: any;
        let uiContentTexture: any;
        if (isWebGPUActive) {
          textSDFTexture = controls.textEnabled && gpuTextSDFTexture ? gpuTextSDFTexture : undefined;
          bgTexture = stateRef.current.bgTextureUrl && gpuBgTexture ? gpuBgTexture : undefined;
          uiContentTexture = controls.uiContentEnabled && gpuUiContentTexture ? gpuUiContentTexture : undefined;
        } else {
          textSDFTexture = controls.textEnabled && stateRef.current.textSDFTexture
            ? stateRef.current.textSDFTexture : undefined;
          bgTexture = (stateRef.current.bgTextureUrl && stateRef.current.bgTexture) ?? undefined;
          uiContentTexture = controls.uiContentEnabled && stateRef.current.uiContentTexture
            ? stateRef.current.uiContentTexture : undefined;
        }

        // Build lighting uniform data
        const currentLights = lightsRef.current;
        const lightPositions: number[] = [];
        const lightColors: number[] = [];
        for (let i = 0; i < 3; i++) {
          if (i < currentLights.length) {
            const l = currentLights[i];
            lightPositions.push(l.x * canvasInfo.dpr, l.y * canvasInfo.dpr, l.intensity, l.radius);
            lightColors.push(l.color.r / 255, l.color.g / 255, l.color.b / 255, 0);
          } else {
            lightPositions.push(0, 0, 0, 0);
            lightColors.push(0, 0, 0, 0);
          }
        }

        renderer.render({
          bgPass: {
            u_bgType: controls.bgType,
            u_bgTexture: bgTexture,
            u_bgTextureRatio: stateRef.current.bgTextureUrl && stateRef.current.bgTextureReady
              ? stateRef.current.bgTextureRatio : undefined,
            u_bgTextureReady: stateRef.current.bgTextureReady ? 1 : 0,
            u_shadowExpand: controls.shadowExpand,
            u_shadowFactor: controls.shadowFactor / 100,
            u_shadowPosition: [-controls.shadowPosition.x, -controls.shadowPosition.y],
            u_textSDF: textSDFTexture,
            u_textEnabled: controls.textEnabled ? 1 : 0,
            u_textScale: 2 * SDF_RANGE,
            u_lightCount: currentLights.length,
            u_lights: lightPositions,
            u_lightColors: lightColors,
            u_bevelWidth: controls.bevelWidth,
            u_edgeGlowIntensity: controls.edgeGlowIntensity,
            u_edgeGlowColor: [
              controls.edgeGlowColor.r / 255,
              controls.edgeGlowColor.g / 255,
              controls.edgeGlowColor.b / 255,
            ],
          },
          mainPass: {
            u_tint: [
              controls.tint.r / 255,
              controls.tint.g / 255,
              controls.tint.b / 255,
              controls.tint.a,
            ],
            u_refThickness: controls.refThickness,
            u_refFactor: controls.refFactor,
            u_refDispersion: controls.refDispersion,
            u_refFresnelRange: controls.refFresnelRange,
            u_refFresnelHardness: controls.refFresnelHardness / 100,
            u_refFresnelFactor: controls.refFresnelFactor / 100,
            u_glareRange: controls.glareRange,
            u_glareHardness: controls.glareHardness / 100,
            u_glareConvergence: controls.glareConvergence / 100,
            u_glareOppositeFactor: controls.glareOppositeFactor / 100,
            u_glareFactor: controls.glareFactor / 100,
            u_blurEdge: controls.blurEdge ? 1 : 0,
            u_uiContentEnabled: controls.uiContentEnabled ? 1 : 0,
            u_uiContentOpacity: controls.uiContentOpacity / 100,
            u_uiContent: uiContentTexture,
            u_emissiveColor: [
              controls.emissiveColor.r / 255,
              controls.emissiveColor.g / 255,
              controls.emissiveColor.b / 255,
            ],
            u_emissiveIntensity: controls.emissiveIntensity / 100,
            u_emissivePulse: controls.emissivePulse
              ? Math.sin(elapsedTime * 2.0) * 0.5 + 0.5
              : 0.0,
            u_hdrEnabled: controls.hdrEnabled ? 1 : 0,
            u_exposure: controls.hdrExposure,
            u_toneMappingType: controls.hdrToneMappingType,
            u_bloom: controls.hdrBloom,
            u_textSDF: textSDFTexture,
            u_textEnabled: controls.textEnabled ? 1 : 0,
            u_textScale: 2 * SDF_RANGE,
            u_lightCount: currentLights.length,
            u_lights: lightPositions,
            u_lightColors: lightColors,
            u_specularPower: controls.specularPower,
            u_specularIntensity: controls.specularIntensity,
            u_causticsEnabled: controls.causticsEnabled ? 1 : 0,
            u_causticsScale: controls.causticsScale,
            u_causticsIntensity: controls.causticsIntensity,
            u_bevelWidth: controls.bevelWidth,
            u_edgeGlowIntensity: controls.edgeGlowIntensity,
            u_edgeGlowColor: [
              controls.edgeGlowColor.r / 255,
              controls.edgeGlowColor.g / 255,
              controls.edgeGlowColor.b / 255,
            ],
            u_colorBleedIntensity: controls.colorBleedIntensity,
            // Phase 3 Material uniforms
            u_roughness: controls.roughness,
            u_reflectionIntensity: controls.reflectionIntensity,
            u_dofIntensity: controls.dofIntensity,
            u_frostedEdge: controls.frostedEdge,
            u_sellmeierEnabled: controls.sellmeierEnabled ? 1 : 0,
            u_sellmeierB: (SELLMEIER_PRESETS[controls.sellmeierPreset] || SELLMEIER_PRESETS.crown).B,
            u_sellmeierC: (SELLMEIER_PRESETS[controls.sellmeierPreset] || SELLMEIER_PRESETS.crown).C,
            u_multiBounce: controls.multiBounce ? 1 : 0,
            u_glassOnGlass: 0, // placeholder for future
            // Phase 4 Surface Detail
            u_smudgeEnabled: controls.smudgeEnabled ? 1 : 0,
            u_smudgeIntensity: controls.smudgeIntensity,
            u_scratchEnabled: controls.scratchEnabled ? 1 : 0,
            u_scratchDensity: controls.scratchDensity,
            u_scratchDepth: controls.scratchDepth,
            u_scratchAngle: (controls.scratchAngle * Math.PI) / 180,
            u_bubbleEnabled: controls.bubbleEnabled ? 1 : 0,
            u_bubbleCount: controls.bubbleCount,
            u_bubbleSeed: 42.0,
            u_bubbleSize: controls.bubbleSize,
            u_dustEnabled: controls.dustEnabled ? 1 : 0,
            u_dustDensity: controls.dustDensity,
            u_dustBrightness: controls.dustBrightness,
            // Phase 5 Animation uniforms
            u_time: elapsedTime,
            u_flowEnabled: controls.flowEnabled ? 1 : 0,
            u_flowSpeed: controls.flowSpeed,
            u_flowScale: controls.flowScale,
            u_flowIntensity: controls.flowIntensity,
            u_pulseEnabled: controls.pulseEnabled ? 1 : 0,
            u_pulseAmplitude: controls.pulseAmplitude,
            u_pulseFrequency: controls.pulseFrequency,
            STEP: controls.step,
          },
        });
      };

      raf = requestAnimationFrame(render);
      stateRef.current.renderRaf = raf;
    };

    initAndRun();

    return () => {
      disposed = true;
      canvasEl.removeEventListener('pointermove', onPointerMove);
      if (stateRef.current.renderRaf) {
        cancelAnimationFrame(stateRef.current.renderRaf);
        stateRef.current.renderRaf = null;
      }
      gpuRenderer?.dispose();
      glRenderer?.dispose();
      // Reset texture state for clean re-init
      stateRef.current.bgTexture = null;
      stateRef.current.bgTextureReady = false;
      stateRef.current.uiContentTexture = null;
      stateRef.current.textSDFTexture = null;
      stateRef.current.textSDFDirty = true;
    };
  }, [useWebGPU]);

  return (
    <>
      {!isFullscreen && levaGlobal}
      {!isFullscreen && (
        <header className={styles.header}>
          <div className={styles.logoWrapper}>
            <div className={styles.title}>Liquid Glass Studio</div>
            <div className={styles.subtitle}>{lang['ui.subtitle']}</div>
          </div>
          <div className={styles.content}>
            <span>
              by <a>iyinchao</a>
            </span>
            <button
              className={styles.button}
              onClick={handleExportPNG}
              title="Export PNG"
              style={{ fontSize: '11px', padding: '4px 8px', cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white' }}
            >
              PNG
            </button>
            <button
              className={styles.button}
              onClick={handleShareURL}
              title="Copy share URL"
              style={{ fontSize: '11px', padding: '4px 8px', cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white' }}
            >
              Share
            </button>
            <button
              className={styles.button}
              onClick={handleToggleRecording}
              title={isRecording ? 'Stop recording' : 'Record video'}
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                cursor: 'pointer',
                background: isRecording ? 'rgba(255,60,60,0.3)' : 'rgba(255,255,255,0.1)',
                border: isRecording ? '1px solid rgba(255,60,60,0.6)' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: '4px',
                color: isRecording ? '#ff6b6b' : 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {isRecording && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />
              )}
              {isRecording ? 'Stop' : 'REC'}
            </button>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                className={styles.button}
                onClick={handleSavePreset}
                title="Save current settings as preset"
                style={{ fontSize: '11px', padding: '4px 8px', cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white' }}
              >
                Save
              </button>
              {userPresets.length > 0 && (
                <button
                  className={styles.button}
                  onClick={(e) => { e.stopPropagation(); setShowPresetMenu((v) => !v); }}
                  title="Load saved preset"
                  style={{ fontSize: '11px', padding: '4px 8px', cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: 'white', marginLeft: '2px' }}
                >
                  My Presets
                </button>
              )}
              {showPresetMenu && userPresets.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    background: 'rgba(30,30,40,0.95)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6,
                    padding: '4px 0',
                    minWidth: 160,
                    zIndex: 1000,
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {userPresets.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '5px 10px',
                        fontSize: 11,
                        color: 'white',
                        cursor: 'pointer',
                      }}
                      onClick={() => handleLoadPreset(p)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{p.name}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id); }}
                        style={{ background: 'none', border: 'none', color: 'rgba(255,100,100,0.7)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
                        title="Delete preset"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <a
              href="https://github.com/iyinchao/liquid-glass-studio"
              target="_blank"
              className={styles.button}
            >
              <GitHubIcon />
            </a>
            <a
              href="https://x.com/charles_yin/status/1936338569267986605"
              target="_blank"
              className={styles.button}
            >
              <XIcon></XIcon>
            </a>
          </div>
        </header>
      )}
      {!isFullscreen && (
        <PresetControls
          controls={controls}
          controlsAPI={controlsAPI}
          lang={lang}
          activeShowcase={activeShowcase}
          onStartShowcase={startShowcase}
          onStopShowcase={stopShowcase}
        />
      )}
      <ResizableWindow
        disableMove
        size={canvasInfo}
        onResize={(size) => {
          setCanvasInfo({
            ...size,
            dpr: window.devicePixelRatio,
          });
          centerizeCanvasWindow();
        }}
        onMove={(pos) => {
          stateRef.current.canvasPos = pos;
        }}
        ctrlRef={(ref) => {
          stateRef.current.canvasWindowCtrlRef = ref;
        }}
      >
        <div className={clsx(styles.canvasContainer)}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            style={
              {
                ['--dpr']: canvasInfo.dpr,
              } as CSSProperties
            }
          />
          {perfInfo && (
            <div className={styles.perfOverlay}>
              <span className={styles.perfBackend}>{perfInfo.backend}</span>
              <span>{perfInfo.fps} FPS</span>
              <span>{perfInfo.frameMs}ms</span>
            </div>
          )}
          {isRecording && (
            <div style={{
              position: 'absolute',
              top: 8,
              left: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(0,0,0,0.5)',
              padding: '4px 10px',
              borderRadius: 4,
              color: '#ff4444',
              fontSize: 11,
              fontWeight: 600,
              zIndex: 100,
              pointerEvents: 'none',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4444', animation: 'pulse 1s infinite' }} />
              REC
            </div>
          )}
          {controls.editorMode && (
            <EditorMode
              shapes={editorShapes}
              onShapesChange={handleShapesChange}
              selectedShapeId={selectedShapeId}
              onSelectShape={setSelectedShapeId}
              canvasWidth={canvasInfo.width}
              canvasHeight={canvasInfo.height}
              lang={lang}
              multiSelectedIds={multiSelectedIds}
              onMultiSelectChange={setMultiSelectedIds}
            />
          )}
          <LightEditor
            lights={lights}
            onLightsChange={setLights}
            canvasWidth={canvasInfo.width}
            canvasHeight={canvasInfo.height}
            visible={controls.lightCount > 0}
          />
        </div>
      </ResizableWindow>
    </>
  );
}

export default App;
