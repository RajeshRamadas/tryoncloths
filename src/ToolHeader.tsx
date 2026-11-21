import { ArrowLeft, Leaf } from "lucide-react";

// The header every store-tool page shares, so staff always see where they are and how to get
// back to the customer they were serving.
export default function ToolHeader() {
  return (
    <header className="topbar tool-header">
      <a className="brand" href="/" aria-label="Forme home">
        <span className="brand-symbol">
          <Leaf size={18} />
        </span>
        forme<span className="brand-dot">.</span>
      </a>
      <span className="brand-divider" />
      <span className="workspace-name">Store tools</span>
      <div className="topbar-right">
        <a className="button secondary" href="/">
          <ArrowLeft size={16} aria-hidden="true" /> Back to studio
        </a>
      </div>
    </header>
  );
}
