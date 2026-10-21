// DualSense motion sensors over WebHID (Chrome / Edge only). The Gamepad API
// doesn't expose the gyro, so we read the controller's raw input reports.
// Offsets follow the Linux hid-playstation driver's dualsense_input_report.

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

  /** Re-learn the resting drift; call while the controller is held still. */
  recalibrate(): void { this.biasSamples = 0; }

  private async attach(dev: HidDevice): Promise<void> {
    if (!dev.opened) await dev.open();
    // Over Bluetooth the controller sends a reduced report without motion
    // data until the calibration feature report has been read.
    try { await dev.receiveFeatureReport(0x05); } catch { /* USB doesn't need it */ }
    this.device?.removeEventListener('inputreport', this.onReport);
    this.device = dev;
    this.biasSamples = 0;
    dev.addEventListener('inputreport', this.onReport);
  }

  private onReport = (e: { reportId: number; data: DataView }): void => {
    // USB: report 0x01 (63 data bytes). Bluetooth: report 0x31, one byte later.
    let base: number;
    if (e.reportId === 0x01 && e.data.byteLength >= 63) base = 0;
    else if (e.reportId === 0x31 && e.data.byteLength >= 64) base = 1;
    else return;
    const d = e.data;
    const gx = d.getInt16(base + 15, true);
    const gy = d.getInt16(base + 17, true);
    const gz = d.getInt16(base + 19, true);

    // Learn the drift from the first ~half second, then keep nudging it
    // whenever the controller is nearly still.
    const still = Math.abs(gx - this.bias.x) + Math.abs(gy - this.bias.y) + Math.abs(gz - this.bias.z) < 3 * COUNTS_PER_DPS;
    if (this.biasSamples < 100 || still) {
      const k = this.biasSamples < 100 ? 1 / ++this.biasSamples : 0.002;
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
    const now = performance.now();
    const dt = this.lastReport ? Math.min(0.02, (now - this.lastReport) / 1000) : 0;
    this.lastReport = now;
    this.acc.pitch += this.rates.pitch * dt;
    this.acc.yaw += this.rates.yaw * dt;
    this.acc.roll += this.rates.roll * dt;
  };
}
