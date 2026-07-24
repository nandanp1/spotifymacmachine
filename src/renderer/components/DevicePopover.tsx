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
}

interface DevicePopoverProps {
  open: boolean;
  connected: boolean;
  devices: AuraDevice[];
  loadState: "idle" | "loading" | "ready" | "error";
  errorMessage?: string;
  onClose: () => void;
  onTransfer: (device: AuraDevice) => void;
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
  onClose,
  onTransfer,
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
                  return (
                    <button
                      key={device.id}
                      type="button"
                      disabled={!device.available || device.isActive}
                      className="device-row"
                      onClick={() => onTransfer(device)}
                    >
                      <DeviceIcon size={18} aria-hidden="true" />
                      <span>
                        <strong>{device.name}</strong>
                        <small>
                          {device.isActive
                            ? "Playing here"
                            : device.available
                              ? "Ready to transfer"
                              : "Unavailable"}
                        </small>
                      </span>
                      {device.isActive ? <Check size={16} aria-label="Active device" /> : null}
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
              <h3>Preview device only</h3>
              <p>Connect a Premium account to discover and transfer playback.</p>
              <button className="primary-button primary-button--compact" onClick={onConnect}>
                Connect Spotify
              </button>
            </div>
          )}
          <p className="device-note">
            Aura transfers playback only when you choose a device.
          </p>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
