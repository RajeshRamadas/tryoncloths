import { useEffect, useRef, useState } from "react";
import { Cloud, LoaderCircle, X } from "lucide-react";
import { isNative } from "./native";
import {
  disconnectStudio,
  requestApi,
  setStudioConnection,
  studioConnection,
} from "./api";

export default function StudioConnection({
  onChange,
  disabled,
}: {
  onChange: () => void;
  disabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (open) {
      setUrl(studioConnection().url || (!isNative && window.location.protocol === "https:" ? window.location.origin : ""));
      setMessage("");
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      setToken("");
      button.current?.focus();
    }
  }, [open]);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      setStudioConnection(url, token);
      const response = await requestApi("/api/health");
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "The store access code was not accepted."
            : "The studio could not be reached. Check the address and try again.",
        );
      const health = await response.json();
      if (health.status !== "ok")
        throw new Error("This address is not a Forme studio.");
      if (health.personalizationContract !== "customer-avatar-v3")
        throw new Error("Update the app and studio server to support OpenAI customer-avatar generation.");
      onChange();
      setOpen(false);
    } catch (error) {
      disconnectStudio();
      onChange();
      setMessage(
        (error as Error).name === "AbortError"
          ? "Connection timed out. Check your internet connection and studio address."
          : (error as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={button}
        className="icon-button"
        aria-label="Studio connection"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Cloud size={20} />
      </button>
      <dialog
        ref={dialog}
        aria-label="Studio connection"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setOpen(false);
        }}
      >
        <button
          className="dialog-close icon-button"
          aria-label="Close studio connection"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <form className="connection-form" onSubmit={connect}>
          <span className="eyebrow">YOUR STORE</span>
          <h2>Connect your studio</h2>
          <p>
            Connect to your store’s private studio for customer avatar generation.
            Sample avatars work without a connection.
          </p>
          <label>
            Studio address
            <input
              type="url"
              required
              placeholder="https://studio.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
            />
          </label>
          <label>
            Store access code
            <input
              type="password"
              required
              minLength={24}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <p className="small-footnote">
            Ask your store administrator for these details. The access code is
            kept only for this app session.
          </p>
          {message && (
            <p role="alert" className="error-banner">
              {message}
            </p>
          )}
          <div className="dialog-actions">
            <button className="button primary" disabled={busy} type="submit">
              {busy && <LoaderCircle className="spin" size={16} />}
              {busy ? "Connecting…" : "Connect studio"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                disconnectStudio();
                onChange();
                setOpen(false);
              }}
            >
              Use offline
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
