import { Menu, nativeImage, Tray, type NativeImage } from 'electron';

const SIZE = 32;

/**
 * The tray icon, drawn in code so the app ships no image files: an Instagram-ish gradient disc with a white chat
 * bubble.
 */
export function trayIcon(): NativeImage {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const c = SIZE / 2;
  const put = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    const i = (y * SIZE + x) * 4;
    // BGRA, as createFromBitmap expects; straight alpha blended over what is there.
    const ia = 1 - a;
    buf[i] = Math.round(b * a + buf[i]! * ia);
    buf[i + 1] = Math.round(g * a + buf[i + 1]! * ia);
    buf[i + 2] = Math.round(r * a + buf[i + 2]! * ia);
    buf[i + 3] = Math.round(255 * a + buf[i + 3]! * ia);
  };
  // Coverage of a pixel by a disc, with a one-pixel soft edge for anti-aliasing.
  const cover = (x: number, y: number, cx: number, cy: number, radius: number): number =>
    Math.max(0, Math.min(1, radius - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const disc = cover(x, y, c, c, c - 1);
      if (disc > 0) {
        const t = (x + (SIZE - y)) / (2 * SIZE);
        put(x, y, Math.round(254 - 123 * t), Math.round(218 - 160 * t), Math.round(117 + 63 * t), disc);
      }
      // Bubble: an ellipse with a small tail at the bottom left.
      const ex = (x + 0.5 - c) / 9.5;
      const ey = (y + 0.5 - (c - 1)) / 7.5;
      const bubble = Math.max(0, Math.min(1, (1 - Math.hypot(ex, ey)) * 8));
      const tail = x >= 8 && x <= 12 && y >= 20 && y <= 24 && x - 8 <= 24 - y ? 1 : 0;
      const white = Math.max(bubble, tail);
      if (white > 0) put(x, y, 255, 255, 255, white);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE });
}

export type TrayDeps = { show: () => void; quit: () => void };

export function createTray({ show, quit }: TrayDeps): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip('IGchat');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open IGchat', click: show },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ])
  );
  tray.on('click', show);
  return tray;
}
