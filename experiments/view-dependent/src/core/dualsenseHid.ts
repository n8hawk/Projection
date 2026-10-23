// DualSense motion sensors over WebHID (Chrome / Edge only). The Gamepad API
// doesn't expose the gyro, so we read the controller's raw input reports.
// Offsets follow the Linux hid-playstation driver's dualsense_input_report.
//
// Over Bluetooth, turning on the full report (needed for motion) leaves the
// browser's own gamepad reader seeing reports it can't parse, so sticks,
// buttons and triggers freeze and rumble stops. While connected here we
// therefore also decode buttons and sticks, and send rumble ourselves.
import type { PadSnapshot } from './gamepad';

const SONY = 0x054c;
const DUALSENSE = 0x0ce6;
const DUALSENSE_EDGE = 0x0df2;
/** Raw gyro counts per degree/second (±2000 °/s over 16 bits). */
const COUNTS_PER_DPS = 16.4;

type HidDevice = {
  opened: boolean;
  productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  receiveFeatureReport(id: number): Promise<DataView>;
  sendReport(id: number, data: Uint8Array): Promise<void>;
  addEventListener(type: 'inputreport', fn: (e: { reportId: number; data: DataView }) => void): void;
  removeEventListener(type: 'inputreport', fn: (e: { reportId: number; data: DataView }) => void): void;
};
type Hid = {
  requestDevice(o: { filters: { vendorId: number; productId?: number }[] }): Promise<HidDevice[]>;
  getDevices(): Promise<HidDevice[]>;
};

/** Angular rates in degrees per second, bias-corrected. */
export interface GyroRates { pitch: number; yaw: number; roll: number }

export class DualSenseGyro {
  static get supported(): boolean { return 'hid' in navigator; }

  device: HidDevice | null = null;
  rates: GyroRates = { pitch: 0, yaw: 0, roll: 0 };
  /** performance.now() of the last motion report. */
  lastReport = 0;
  private bias = { x: 0, y: 0, z: 0 };
  private acc = { pitch: 0, yaw: 0, roll: 0 };
  private biasSamples = 0;
  private stillFor = 0;
  private lastTs: number | null = null;
  /** Buttons and sticks from the latest report, in standard gamepad order. */
  private state: PadSnapshot | null = null;
  private bluetooth = false;
  private outSeq = 0;
  private rumbleTimer = 0;

  get connected(): boolean { return !!this.device && performance.now() - this.lastReport < 500; }

  /** Ask the user to pick the controller (must run from a click). */
  async connect(): Promise<boolean> {
    const hid = (navigator as Navigator & { hid?: Hid }).hid;
    if (!hid) return false;
    const [dev] = await hid.requestDevice({ filters: [{ vendorId: SONY, productId: DUALSENSE }, { vendorId: SONY, productId: DUALSENSE_EDGE }] });
    if (!dev) return false;
    await this.attach(dev);
    return true;
  }

  /** Reopen a controller the user already granted on an earlier visit. */
  async reconnect(): Promise<boolean> {
    const hid = (navigator as Navigator & { hid?: Hid }).hid;
    if (!hid) return false;
    const [dev] = (await hid.getDevices()).filter((d) => /dualsense|wireless controller/i.test(d.productName));
    if (!dev) return false;
    await this.attach(dev);
    return true;
  }

  /** Degrees turned since the last call (reports arrive faster than frames). */
  takeDelta(): GyroRates {
    const a = this.acc;
    this.acc = { pitch: 0, yaw: 0, roll: 0 };
    return a;
  }

  /** The controller as a gamepad, read from the same reports (null if stale). */
  get pad(): PadSnapshot | null { return this.connected ? this.state : null; }

  /** Vibrate both motors (0..1) for `ms`, then stop. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.connected) return;
    void this.sendRumble(strong, weak);
    clearTimeout(this.rumbleTimer);
    this.rumbleTimer = window.setTimeout(() => void this.sendRumble(0, 0), ms);
  }

  private async sendRumble(strong: number, weak: number): Promise<void> {
    const dev = this.device;
    if (!dev) return;
    // The shared part of the output report (hid-playstation's
    // dualsense_output_report_common): flags, then right/left motor.
    const common = new Uint8Array(47);
    common[0] = 0x03; // compatible vibration + haptics select
    common[2] = Math.round(Math.min(1, weak) * 255); // right, high frequency
    common[3] = Math.round(Math.min(1, strong) * 255); // left, low frequency
    try {
      if (this.bluetooth) {
        // Report 0x31: sequence tag, 0x10, common, padding, CRC-32.
        const data = new Uint8Array(77);
        data[0] = (this.outSeq++ & 0x0f) << 4;
        data[1] = 0x10;
        data.set(common, 2);
        const crc = crc32(Uint8Array.of(0xa2, 0x31, ...data.subarray(0, 73)));
        new DataView(data.buffer).setUint32(73, crc, true);
        await dev.sendReport(0x31, data);
      } else {
        const data = new Uint8Array(62);
        data.set(common, 0);
        await dev.sendReport(0x02, data);
      }
    } catch { /* controller went away */ }
  }

  /** Re-learn the resting drift; call while the controller is held still. */
  recalibrate(): void { this.biasSamples = 0; }

  private async attach(dev: HidDevice): Promise<void> {
    if (!dev.opened) await dev.open();
    // Over Bluetooth the controller sends a reduced report without motion
    // data until the calibration feature report has been read.
    try { await dev.receiveFeatureReport(0x05); } catch { /* USB doesn't need it */ }
    this.device?.removeEventListener('inputreport', this.onReport);
    this.device = dev;
    this.state = null;
    this.biasSamples = 0;
    this.lastTs = null;
    dev.addEventListener('inputreport', this.onReport);
  }

  private onReport = (e: { reportId: number; data: DataView }): void => {
    // USB: report 0x01 (63 data bytes). Bluetooth: report 0x31, one byte later.
    let base: number;
    if (e.reportId === 0x01 && e.data.byteLength >= 63) base = 0;
    else if (e.reportId === 0x31 && e.data.byteLength >= 64) base = 1;
    else return;
    this.bluetooth = base === 1;
    const d = e.data;
    this.state = decodePad(d, base);
    const gx = d.getInt16(base + 15, true);
    const gy = d.getInt16(base + 17, true);
    const gz = d.getInt16(base + 19, true);

    // The controller's own clock (1/3 µs ticks) times the samples, so bursts
    // of reports bunched up by USB or Bluetooth still integrate correctly.
    const ts = d.getUint32(base + 27, true);
    const now = performance.now();
    let dt = this.lastTs === null ? 0 : ((ts - this.lastTs) >>> 0) / 3e6;
    if (!(dt > 0 && dt < 0.05)) dt = this.lastReport ? Math.min(0.02, (now - this.lastReport) / 1000) : 0;
    this.lastTs = ts;

    // Learn the drift from the first ~half second, then refine it only after
    // the controller has been held still for a while. Adapting during slow,
    // deliberate pointing would eat that motion and make aiming feel sticky.
    const still = Math.abs(gx - this.bias.x) + Math.abs(gy - this.bias.y) + Math.abs(gz - this.bias.z) < 1.5 * COUNTS_PER_DPS;
    this.stillFor = still ? this.stillFor + dt : 0;
    if (this.biasSamples < 100 || this.stillFor > 0.5) {
      const k = this.biasSamples < 100 ? 1 / ++this.biasSamples : 0.0005;
      this.bias.x += (gx - this.bias.x) * k;
      this.bias.y += (gy - this.bias.y) * k;
      this.bias.z += (gz - this.bias.z) * k;
    }
    this.rates = {
      pitch: (gx - this.bias.x) / COUNTS_PER_DPS,
      yaw: (gy - this.bias.y) / COUNTS_PER_DPS,
      roll: (gz - this.bias.z) / COUNTS_PER_DPS,
    };
    if (this.biasSamples < 100) this.rates = { pitch: 0, yaw: 0, roll: 0 };
    this.lastReport = now;
    this.acc.pitch += this.rates.pitch * dt;
    this.acc.yaw += this.rates.yaw * dt;
    this.acc.roll += this.rates.roll * dt;
  };
}

const stick = (v: number) => Math.max(-1, (v - 128) / 127);

/** Sticks, triggers and buttons as a standard-mapping gamepad. */
function decodePad(d: DataView, base: number): PadSnapshot {
  const b0 = d.getUint8(base + 7), b1 = d.getUint8(base + 8), b2 = d.getUint8(base + 9);
  const l2 = d.getUint8(base + 4) / 255, r2 = d.getUint8(base + 5) / 255;
  const hat = b0 & 0x0f; // 0 = up, clockwise, 8 = released
  const dir = (a: number, b: number, c: number) => hat === a || hat === b || hat === c;
  const btn = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, value });
  return {
    index: -1,
    id: 'DualSense Wireless Controller (054c, WebHID)',
    axes: [stick(d.getUint8(base)), stick(d.getUint8(base + 1)), stick(d.getUint8(base + 2)), stick(d.getUint8(base + 3))],
    buttons: [
      btn(!!(b0 & 0x20)), btn(!!(b0 & 0x40)), btn(!!(b0 & 0x10)), btn(!!(b0 & 0x80)), // cross circle square triangle
      btn(!!(b1 & 0x01)), btn(!!(b1 & 0x02)), btn(l2 > 0.1, l2), btn(r2 > 0.1, r2), // l1 r1 l2 r2
      btn(!!(b1 & 0x10)), btn(!!(b1 & 0x20)), btn(!!(b1 & 0x40)), btn(!!(b1 & 0x80)), // create options l3 r3
      btn(dir(7, 0, 1)), btn(dir(3, 4, 5)), btn(dir(5, 6, 7)), btn(dir(1, 2, 3)), // up down left right
      btn(!!(b2 & 0x01)), btn(!!(b2 & 0x02)), // ps touchpad
    ],
  };
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
