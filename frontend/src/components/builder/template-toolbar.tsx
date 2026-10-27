import type { ArchitectureType } from "@/types/configuration"
import { cn } from "@/lib/utils"

const templates: {
  label: string
  value: ArchitectureType
}[] = [
  { label: "Single Agent", value: "single-agent" },
  { label: "Prompt Chain", value: "prompt-chaining" },
  { label: "Routing", value: "routing" },
  { label: "Parallel", value: "parallelization" },
  { label: "Evaluator", value: "evaluator-optimizer" },
  { label: "Autonomous", value: "autonomous-agent" },
  { label: "Custom", value: "custom" },
]

interface Props {
  value: ArchitectureType
  onChange: (architecture: ArchitectureType) => void
}

export default function TemplateToolbar({ value, onChange }: Props) {
  return (
    <div className="rounded-2xl border border-border/80 bg-white p-1.5">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-7">
        {templates.map((template) => {
          const active = value === template.value
          return (
            <button
              key={template.value}
              type="button"
              onClick={() => onChange(template.value)}
              className={cn(
                "rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors",
                active
                  ? "bg-mm-blue text-white"
                  : "text-mm-dark hover:bg-muted/80",
              )}
            >
              {template.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
