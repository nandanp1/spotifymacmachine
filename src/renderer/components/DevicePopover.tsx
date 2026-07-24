import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Laptop,
  LoaderCircle,
  Radio,
  Smartphone,
  Speaker,
  X,
} from "lucide-react";
import { IconButton } from "./IconButton";

export interface AuraDevice {
  id: string;
  name: string;
  type: "computer" | "smartphone" | "speaker";
  isActive: boolean;
  available: boolean;
  supportsVolume: boolean;
}

interface DevicePopoverProps {
  open: boolean;
  connected: boolean;
  devices: AuraDevice[];
  loadState: "idle" | "loading" | "ready" | "error";
  errorMessage?: string;
  selectedDeviceId?: string | null;
  pendingDeviceId?: string | null;
  onClose: () => void;
  onSelect: (device: AuraDevice) => void;
  onConnect: () => void;
  onRetry: () => void;
}

const deviceIcons = {
  computer: Laptop,
  smartphone: Smartphone,
  speaker: Speaker,
};

export function DevicePopover({
  open,
  connected,
  devices,
  loadState,
  errorMessage,
  selectedDeviceId,
  pendingDeviceId,
  onClose,
  onSelect,
  onConnect,
  onRetry,
}: DevicePopoverProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          className="device-popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby="device-title"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.24 }}
        >
          <header>
            <div>
              <p className="eyebrow">Spotify Connect</p>
              <h2 id="device-title">Available devices</h2>
            </div>
            <IconButton
              label="Close devices"
              size="small"
              quiet
              autoFocus
              onClick={onClose}
            >
              <X size={17} />
            </IconButton>
          </header>

          {connected ? (
            <div className="device-list">
              {loadState === "loading" ? (
                <div className="popover-empty" role="status">
                  <LoaderCircle className="spin" size={19} />
                  <h3>Finding your devices</h3>
                  <p>Spotify is checking the current Connect session.</p>
                </div>
              ) : loadState === "error" ? (
                <div className="popover-empty" role="alert">
                  <AlertCircle size={19} />
                  <h3>Devices are unavailable</h3>
                  <p>{errorMessage ?? "Spotify could not load this device list."}</p>
                  <button
                    className="primary-button primary-button--compact"
                    type="button"
                    onClick={onRetry}
                  >
                    Try again
                  </button>
                </div>
              ) : devices.length ? (
                devices.map((device) => {
                  const DeviceIcon = deviceIcons[device.type];
                  const selected = device.id === selectedDeviceId;
                  const pending = device.id === pendingDeviceId;
                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={
                        !device.available ||
                        (pendingDeviceId !== null &&
                          pendingDeviceId !== undefined)
                      }
                      aria-pressed={selected}
                      className={`device-row ${
                        selected ? "device-row--selected" : ""
                      }`}
                      onClick={() => onSelect(device)}
                    >
                      <DeviceIcon size={18} aria-hidden="true" />
                      <span>
                        <strong>{device.name}</strong>
                        <small>
                          {pending
                            ? "Selecting remote target…"
                            : selected
                              ? device.isActive
                                ? "Remote control target · active"
                                : "Remote control target"
                              : device.isActive
                                ? "Active on Spotify · select to control"
                                : device.available
                                  ? "Select as remote target"
                                  : "Unavailable"}
                        </small>
                      </span>
                      {pending ? (
                        <LoaderCircle
                          className="spin"
                          size={16}
                          aria-label="Selecting device"
                        />
                      ) : selected ? (
                        <Check size={16} aria-label="Remote control target" />
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="popover-empty">
                  <Radio size={19} />
                  <p>No Spotify devices are reporting in yet.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="popover-empty">
              <Radio size={19} />
              <h3>Preview mode</h3>
              <p>Connect a Premium account to discover and transfer playback.</p>
              <button className="primary-button primary-button--compact" onClick={onConnect}>
                Connect Spotify
              </button>
            </div>
          )}
          <p className="device-note">
            Audio stays on the Spotify device you explicitly select.
          </p>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
