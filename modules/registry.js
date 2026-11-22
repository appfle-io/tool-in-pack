/**
 * Module registry — the one place a new tool gets plugged in.
 *
 * A module is a plain ES module with a default export:
 *   {
 *     id, name, kind, subtitle, description, icon (svg string), version,
 *     defaultEnabled, defaultPinned,
 *     mount(root, ctx) -> cleanup function | void
 *   }
 *
 * Adding a tool:
 *   1. modules/<your-module>/module.js  (with mount())
 *   2. one import + one entry in `registry` below
 * Everything else (home card, enable/pin toggles, routing, offline shell)
 * picks it up automatically.
 */

import docReader from './doc-reader/module.js';

export const registry = [
  docReader,
];

export function listModules() {
  return registry.slice();
}

export function getModule(id) {
  return registry.find((mod) => mod.id === id) || null;
}
