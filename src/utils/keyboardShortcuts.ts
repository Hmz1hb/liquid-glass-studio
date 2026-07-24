export interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: () => void;
}

export class KeyboardShortcutManager {
  private shortcuts: ShortcutDef[] = [];
  private enabled: boolean = true;
  private handler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.handler = this.handleKeyDown.bind(this);
    document.addEventListener('keydown', this.handler);
  }

  private isMac(): boolean {
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
      navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Don't intercept when typing in inputs
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const ctrlOrCmd = this.isMac() ? e.metaKey : e.ctrlKey;

    for (const shortcut of this.shortcuts) {
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
      const ctrlMatch = (shortcut.ctrl ?? false) === ctrlOrCmd;
      const shiftMatch = (shortcut.shift ?? false) === e.shiftKey;
      const altMatch = (shortcut.alt ?? false) === e.altKey;

      if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
        e.preventDefault();
        e.stopPropagation();
        shortcut.action();
        return;
      }
    }
  }

  register(shortcut: ShortcutDef): void {
    this.shortcuts.push(shortcut);
  }

  registerMany(shortcuts: ShortcutDef[]): void {
    this.shortcuts.push(...shortcuts);
  }

  unregisterAll(): void {
    this.shortcuts = [];
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getAll(): ShortcutDef[] {
    return [...this.shortcuts];
  }

  getShortcutLabel(shortcut: ShortcutDef): string {
    const parts: string[] = [];
    if (shortcut.ctrl) parts.push(this.isMac() ? 'Cmd' : 'Ctrl');
    if (shortcut.shift) parts.push('Shift');
    if (shortcut.alt) parts.push(this.isMac() ? 'Option' : 'Alt');

    let keyLabel = shortcut.key;
    switch (shortcut.key) {
      case 'ArrowUp': keyLabel = '\u2191'; break;
      case 'ArrowDown': keyLabel = '\u2193'; break;
      case 'ArrowLeft': keyLabel = '\u2190'; break;
      case 'ArrowRight': keyLabel = '\u2192'; break;
      case 'Delete': keyLabel = 'Del'; break;
      case 'Backspace': keyLabel = this.isMac() ? '\u232B' : 'Backspace'; break;
      case ' ': keyLabel = 'Space'; break;
      case 'Escape': keyLabel = 'Esc'; break;
      default:
        if (keyLabel.length === 1) keyLabel = keyLabel.toUpperCase();
    }

    parts.push(keyLabel);
    return parts.join('+');
  }

  dispose(): void {
    if (this.handler) {
      document.removeEventListener('keydown', this.handler);
      this.handler = null;
    }
    this.shortcuts = [];
  }
}
