import { useEffect, useState } from "react"

import { PRESETS_CHANGED_EVENT, getPresets, type AgentPreset } from "@/lib/agent-presets"

/** The preset library, kept current across tabs and edits. Empty until mounted (SSR-safe). */
export function useAgentPresets(): AgentPreset[] {
  const [presets, setPresets] = useState<AgentPreset[]>([])
  useEffect(() => {
    const refresh = () => setPresets(getPresets())
    refresh()
    window.addEventListener(PRESETS_CHANGED_EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(PRESETS_CHANGED_EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])
  return presets
}
