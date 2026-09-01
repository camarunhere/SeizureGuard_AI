import { createContext, useContext, useRef, useState } from "react";

// Real Web Bluetooth connection to a BITalino (r)evolution BLE board (PLUX
// Biosignals) — a research-grade sensor board with EDA, sEMG, and ACC
// channels on one device, matching the dissertation's target sensor set.
//
// VERIFIED vs UNVERIFIED, explicitly:
// - The service/characteristic UUIDs below and the start/stop command byte
//   format ARE verified against real primary sources: the UUIDs come from
//   an open-source Android BLE client's actual source
//   (pires/bitalino-ble-android, BITalinoBLEService.java), and the command
//   bit-packing (sampling-rate byte + channel-select/start byte) comes from
//   PLUX's own official Python API (BITalinoWorld/revolution-python-api).
//   Both were fetched and read directly, not paraphrased from a search
//   summary. Connecting, and starting/stopping acquisition, is real.
// - The exact byte offsets for unpacking each analog channel's value out of
//   a data frame are NOT independently verified here — the general frame
//   structure (sequence number + CRC + digital + up to 6 variable-resolution
//   analog channels) comes from the peer-reviewed BITalino paper, but no
//   primary source with confirmed bit offsets was found. Rather than guess
//   at that (this feeds a seizure-risk model — a wrong-but-plausible parse
//   would be worse than an honest "not yet calibrated"), this only exposes
//   the RAW frame bytes and a best-effort sequence number. Calibrating real
//   EDA (µS) / EMG (RMS) values needs a validation pass against PLUX's own
//   OpenSignals software once the physical board is in hand — see the
//   compatibility panel in PatientPortal.jsx.
const SERVICE_UUID = "c566488a-0882-4e1b-a6d0-0b717e652234";
const COMMANDS_CHARACTERISTIC_UUID = "4051eb11-bf0a-4c74-8730-a48f4193fcea";
const FRAMES_CHARACTERISTIC_UUID = "40fdba6b-672e-47c4-808a-e529adff3633";

const SAMPLING_RATE_CODES = { 1: 0, 10: 1, 100: 2, 1000: 3 };

const BitalinoContext = createContext(null);

export function BitalinoProvider({ children }) {
  const supported = typeof navigator !== "undefined" && !!navigator.bluetooth;
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | acquiring
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");
  const [lastFrame, setLastFrame] = useState(null); // { hex, seq, at }
  const [frameRate, setFrameRate] = useState(0);

  const deviceRef = useRef(null);
  const commandsCharRef = useRef(null);
  const framesCharRef = useRef(null);
  const frameCountRef = useRef(0);
  const frameRateTimerRef = useRef(null);

  const teardown = () => {
    setStatus("idle");
    setLastFrame(null);
    setFrameRate(0);
    if (frameRateTimerRef.current) clearInterval(frameRateTimerRef.current);
    frameRateTimerRef.current = null;
    frameCountRef.current = 0;
  };

  const connect = async () => {
    setError("");
    setStatus("connecting");
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });
      deviceRef.current = device;
      setDeviceName(device.name || "BITalino");
      device.addEventListener("gattserverdisconnected", teardown);

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      commandsCharRef.current = await service.getCharacteristic(COMMANDS_CHARACTERISTIC_UUID);
      framesCharRef.current = await service.getCharacteristic(FRAMES_CHARACTERISTIC_UUID);

      await framesCharRef.current.startNotifications();
      framesCharRef.current.addEventListener("characteristicvaluechanged", (e) => {
        const bytes = new Uint8Array(e.target.value.buffer);
        const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        // Best-effort only — sequence number is commonly packed in the top
        // nibble of the last byte per BITalino's published frame structure,
        // but this specific offset is NOT independently verified here.
        const seq = bytes.length ? (bytes[bytes.length - 1] >> 4) & 0x0f : null;
        setLastFrame({ hex, seq, length: bytes.length, at: Date.now() });
        frameCountRef.current += 1;
      });

      frameRateTimerRef.current = setInterval(() => {
        setFrameRate(frameCountRef.current);
        frameCountRef.current = 0;
      }, 1000);

      setStatus("connected");
    } catch (err) {
      setError(err.message || "Failed to connect to BITalino device.");
      teardown();
    }
  };

  // channels: array of analog channel indices 0-5 (A1-A6); samplingRate: 1|10|100|1000
  const startAcquisition = async (channels, samplingRate) => {
    setError("");
    const commands = commandsCharRef.current;
    if (!commands) {
      setError("Not connected.");
      return;
    }
    try {
      const rateCode = SAMPLING_RATE_CODES[samplingRate] ?? SAMPLING_RATE_CODES[1000];
      const rateByte = (rateCode << 6) | 0x03;
      await commands.writeValueWithoutResponse(new Uint8Array([rateByte]));

      let startByte = 1;
      for (const ch of channels) startByte |= 1 << (2 + ch);
      await commands.writeValueWithoutResponse(new Uint8Array([startByte]));

      setStatus("acquiring");
    } catch (err) {
      setError(err.message || "Failed to start acquisition.");
    }
  };

  const stopAcquisition = async () => {
    const commands = commandsCharRef.current;
    if (!commands) return;
    try {
      await commands.writeValueWithoutResponse(new Uint8Array([0]));
      setStatus("connected");
    } catch (err) {
      setError(err.message || "Failed to stop acquisition.");
    }
  };

  const disconnect = () => {
    deviceRef.current?.gatt?.disconnect();
    deviceRef.current = null;
    commandsCharRef.current = null;
    framesCharRef.current = null;
    setDeviceName("");
    teardown();
  };

  return (
    <BitalinoContext.Provider
      value={{ supported, status, deviceName, error, lastFrame, frameRate, connect, startAcquisition, stopAcquisition, disconnect }}
    >
      {children}
    </BitalinoContext.Provider>
  );
}

export function useBitalino() {
  const ctx = useContext(BitalinoContext);
  if (!ctx) throw new Error("useBitalino must be used within a BitalinoProvider");
  return ctx;
}
