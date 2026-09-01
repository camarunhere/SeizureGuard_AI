import { createContext, useContext, useEffect, useRef, useState } from "react";

// Lives above <main key={active}> in App.jsx so a paired device survives tab
// switches — App.jsx remounts everything under <main> on every nav change
// (that's what drives the page-change fade-in), which would otherwise tear
// down the GATT connection along with the component that opened it.

const BluetoothContext = createContext(null);

// Only devices implementing the standard Bluetooth SIG Heart Rate Service
// (Polar/Wahoo/Garmin broadcast mode, most chest straps) work here. Most
// budget fitness watches (incl. boAt) sync heart rate through their own app
// via a proprietary protocol and never expose this standard service — that's
// a vendor restriction, not something fixable from the browser.
const HR_STALE_MS = 8000;

function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const is16Bit = flags & 0x1;
  const value = is16Bit ? dataView.getUint16(1, true) : dataView.getUint8(1);
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  return { value, contactSupported, contactDetected };
}

export function BluetoothProvider({ children }) {
  const supported = typeof navigator !== "undefined" && !!navigator.bluetooth;
  const [status, setStatus] = useState("idle"); // idle | connecting | connected
  const [heartRate, setHeartRate] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [contactOk, setContactOk] = useState(null); // null = device doesn't report contact status
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState("");
  const deviceRef = useRef(null);
  const userInitiatedDisconnect = useRef(false);

  const teardown = () => {
    setStatus("idle");
    setHeartRate(null);
    setLastUpdated(null);
    setContactOk(null);
  };

  const attachCharacteristic = async (device) => {
    const server = await device.gatt.connect();
    let service;
    try {
      service = await server.getPrimaryService("heart_rate");
    } catch {
      device.gatt.disconnect();
      throw new Error(
        `"${device.name || "This device"}" paired, but doesn't expose the standard Bluetooth heart-rate service. ` +
        "Most budget fitness watches (including boAt) only share heart rate with their own app, not with other apps over Bluetooth. " +
        "Try a chest strap or running watch with a 'broadcast heart rate' mode (Polar, Wahoo, Garmin), or use Manual entry instead."
      );
    }
    const characteristic = await service.getCharacteristic("heart_rate_measurement");
    await characteristic.startNotifications();
    characteristic.addEventListener("characteristicvaluechanged", (e) => {
      const { value, contactSupported, contactDetected } = parseHeartRateMeasurement(e.target.value);
      setHeartRate(value);
      setLastUpdated(Date.now());
      setContactOk(contactSupported ? contactDetected : null);
    });
    setStatus("connected");
  };

  const connect = async () => {
    setError("");
    setStatus("connecting");
    try {
      // acceptAllDevices + optionalServices instead of filtering by the
      // heart_rate service: many wearables don't include service UUIDs in
      // their advertisement, so a filtered scan can run for a long time (or
      // never surface the device) even though it supports the service once
      // connected. optionalServices still grants access to it post-connect.
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["heart_rate"],
      });
      deviceRef.current = device;
      setDeviceName(device.name || "Heart rate device");
      userInitiatedDisconnect.current = false;

      device.addEventListener("gattserverdisconnected", async () => {
        if (userInitiatedDisconnect.current) {
          teardown();
          return;
        }
        // Dropped unexpectedly (out of range, watch screen timeout, etc.) —
        // the browser retains permission for this device in this tab, so
        // reconnect automatically instead of forcing the patient to re-pair.
        setStatus("connecting");
        try {
          await attachCharacteristic(device);
        } catch {
          teardown();
        }
      });

      await attachCharacteristic(device);
    } catch (err) {
      setError(err.message || "Failed to connect to device.");
      teardown();
    }
  };

  const disconnect = () => {
    userInitiatedDisconnect.current = true;
    deviceRef.current?.gatt?.disconnect();
    deviceRef.current = null;
    setDeviceName("");
    teardown();
  };

  // lastUpdated only changes on a new BLE notification, so without a clock
  // tick the UI would never notice readings have stopped arriving.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(() => forceTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, [status]);

  const isStale = status === "connected" && lastUpdated != null && Date.now() - lastUpdated > HR_STALE_MS;

  return (
    <BluetoothContext.Provider value={{ supported, status, heartRate, lastUpdated, contactOk, isStale, deviceName, error, connect, disconnect }}>
      {children}
    </BluetoothContext.Provider>
  );
}

export function useHeartRateDevice() {
  const ctx = useContext(BluetoothContext);
  if (!ctx) throw new Error("useHeartRateDevice must be used within a BluetoothProvider");
  return ctx;
}
