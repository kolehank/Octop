// Dashboard injects React on window.__AGENTBUDDY_REACT__ / __AGENTBUDDY_JSX__
// (dashboard/src/plugins/toolRenderers/ensureBuiltins.ts). We must bind to the
// SAME instance as the host tree — importing any other copy of react breaks
// hooks ("Invalid hook call"). Never import "react" in this plugin.
//
// NOTE: the code name is AGENTBUDDY. docs/plugin-package.md mentions
// __OCTOP_REACT__ but that global does not exist; CONDITIONS-NOTES.md §2.1
// freezes this deviation: prefer __AGENTBUDDY_REACT__.

export const __AGENTBUDDY_REACT__ = window.__AGENTBUDDY_REACT__;
export const __AGENTBUDDY_JSX__ = window.__AGENTBUDDY_JSX__;

export const useState = __AGENTBUDDY_REACT__.useState;
export const useEffect = __AGENTBUDDY_REACT__.useEffect;
export const useRef = __AGENTBUDDY_REACT__.useRef;
export const useMemo = __AGENTBUDDY_REACT__.useMemo;
export const useCallback = __AGENTBUDDY_REACT__.useCallback;

export default __AGENTBUDDY_REACT__;