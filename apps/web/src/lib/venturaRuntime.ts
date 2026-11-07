import "core-js/actual";

// Ventura's WKWebView predates these AbortSignal methods. Preserve first reason
// and remove every listener once the combined signal aborts.
if (!AbortSignal.any) {
  AbortSignal.any = (signals: AbortSignal[]) => {
    const controller = new AbortController();
    const listeners = new Map<AbortSignal, () => void>();
    const abort = (signal: AbortSignal) => {
      controller.abort(signal.reason);
      for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
      listeners.clear();
    };
    for (const signal of signals) {
      if (signal.aborted) { abort(signal); break; }
      if (listeners.has(signal)) continue;
      const listener = () => abort(signal);
      listeners.set(signal, listener);
      signal.addEventListener("abort", listener, { once: true });
    }
    return controller.signal;
  };
}
if (!AbortSignal.timeout) {
  AbortSignal.timeout = (milliseconds: number) => {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new RangeError("Invalid timeout");
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  };
}
