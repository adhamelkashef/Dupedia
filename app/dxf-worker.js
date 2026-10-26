/* DXF import worker: runs the shared DXF core off the main thread. */
/* global DPDxf */
importScripts("../vendor/dxf-parser.js", "dxf-core.js");
self.onmessage = (ev) => DPDxf.process(ev.data.text, ev.data.name, (m) => self.postMessage(m));
