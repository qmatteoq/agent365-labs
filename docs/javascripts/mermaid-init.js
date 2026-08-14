/*
 * Adapted from the Copilot Developer Camp (https://github.com/microsoft/copilot-camp)
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 */
(function () {
  function renderMermaid() {
    if (!window.mermaid) return;

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "neutral",
    });

    window.mermaid.run({ querySelector: ".mermaid" });
  }

  if (typeof document$ !== "undefined") {
    document$.subscribe(renderMermaid);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderMermaid);
  } else {
    renderMermaid();
  }
})();