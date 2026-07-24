import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, CheckCircle2, LockKeyhole, X } from "lucide-react";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { IconButton } from "./IconButton";

export type ConnectionState =
  | "preview"
  | "connecting"
  | "connected"
  | "cancelled"
  | "error";

interface ConnectionPanelProps {
  open: boolean;
  state: ConnectionState;
  errorMessage?: string;
  onClose: () => void;
  onConnect: () => void;
  onUsePreview: () => void;
}

export function ConnectionPanel({
  open,
  state,
  errorMessage,
  onClose,
  onConnect,
  onUsePreview,
}: ConnectionPanelProps) {
  const panelRef = useDialogFocus<HTMLElement>(open);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            className="overlay-scrim overlay-scrim--strong"
            type="button"
            aria-label="Close Spotify connection dialog"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.section
            ref={panelRef}
            className="connection-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            initial={{ opacity: 0, y: 22, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          >
            <IconButton
              label="Close connection dialog"
              className="connection-panel__close"
              quiet
              onClick={onClose}
            >
              <X size={18} />
            </IconButton>

            {state === "connected" ? (
              <>
                <CheckCircle2 className="connection-panel__icon" size={24} />
                <p className="eyebrow">Connection ready</p>
                <h2 id="connect-title">Spotify is part of the room.</h2>
                <p>
                  Aura will register its player when the Web Playback SDK becomes ready.
                </p>
                <button className="primary-button" type="button" onClick={onClose}>
                  Return to now playing
                  <ArrowRight size={17} />
                </button>
              </>
            ) : state === "error" || state === "cancelled" ? (
              <>
                <AlertCircle className="connection-panel__icon" size={24} />
                <p className="eyebrow">
                  {state === "cancelled" ? "Connection cancelled" : "Connection paused"}
                </p>
                <h2 id="connect-title">
                  {state === "cancelled"
                    ? "Nothing changed."
                    : "Spotify could not be connected."}
                </h2>
                <p>
                  {errorMessage ??
                    "Check your client ID, redirect URI, and network, then try again."}
                </p>
                <div className="connection-actions">
                  <button className="primary-button" type="button" onClick={onConnect}>
                    Try again
                    <ArrowRight size={17} />
                  </button>
                  <button className="text-button" type="button" onClick={onUsePreview}>
                    Continue preview
                  </button>
                </div>
              </>
            ) : (
              <>
                <LockKeyhole className="connection-panel__icon" size={24} />
                <p className="eyebrow">Private by design</p>
                <h2 id="connect-title">Bring your Spotify listening into Aura.</h2>
                <p>
                  Sign-in opens in your browser. Credentials stay with Spotify and tokens
                  are stored in the macOS Keychain.
                </p>
                <ul className="connection-facts">
                  <li>Premium is required for in-app playback.</li>
                  <li>Aura never records, downloads, or inspects Spotify audio.</li>
                  <li>You can disconnect and erase stored credentials at any time.</li>
                </ul>
                <button
                  className="primary-button"
                  type="button"
                  disabled={state === "connecting"}
                  onClick={onConnect}
                >
                  {state === "connecting" ? "Waiting for Spotify…" : "Continue to Spotify"}
                  <ArrowRight size={17} />
                </button>
                <button className="text-button" type="button" onClick={onUsePreview}>
                  Stay in local preview
                </button>
              </>
            )}
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}
