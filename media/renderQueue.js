(function () {
  function schedule(cb) {
    if (typeof window.requestAnimationFrame === "function") {
      return window.requestAnimationFrame(() => cb());
    }
    return window.setTimeout(cb, 16);
  }

  function cancel(handle) {
    if (typeof handle !== "number") return;
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(handle);
      return;
    }
    window.clearTimeout(handle);
  }

  function createRenderQueue(items, renderItem, options) {
    const list = Array.isArray(items) ? items.slice() : [];
    const chunkSize = Math.max(1, Number((options && options.chunkSize) || 24));
    const onDone = typeof options?.onDone === "function" ? options.onDone : function () {};

    let index = 0;
    let cancelled = false;
    let handle = null;

    function flushChunk() {
      handle = null;
      if (cancelled) return;

      const end = Math.min(index + chunkSize, list.length);
      while (index < end) {
        try {
          renderItem(list[index], index);
        } catch (error) {
          console.warn("history render item failed", error);
        }
        index += 1;
      }

      if (index < list.length) {
        handle = schedule(flushChunk);
        return;
      }

      onDone();
    }

    return {
      start() {
        if (cancelled) return;
        handle = schedule(flushChunk);
      },
      cancel() {
        cancelled = true;
        cancel(handle);
        handle = null;
      }
    };
  }

  window.__NITORI_RENDER_QUEUE__ = {
    createRenderQueue
  };
})();
