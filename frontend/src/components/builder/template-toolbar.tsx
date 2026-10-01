import type {
  ArchitectureType,
} from "@/types/configuration"

import {
  Button,
} from "@/components/ui/button"

const templates: {
  label: string
  value: ArchitectureType
}[] = [
  {
    label: "Single Agent",
    value: "single-agent",
  },

  {
    label: "Prompt Chain",
    value: "prompt-chaining",
  },

  {
    label: "Routing",
    value: "routing",
  },

  {
    label: "Parallel",
    value: "parallelization",
  },

  {
    label: "Evaluator",
    value: "evaluator-optimizer",
  },

  {
    label: "Autonomous",
    value: "autonomous-agent",
  },
]

interface Props {
  value: ArchitectureType

  onChange: (
    architecture:
      ArchitectureType,
  ) => void
}

export default function TemplateToolbar({
  value,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
      <span className="px-2 text-xs text-muted-foreground">
        Templates
      </span>

      {templates.map(
        (template) => (
          <Button
            key={template.value}
            size="sm"

            variant={
              value ===
              template.value
                ? "secondary"
                : "ghost"
            }

            onClick={() =>
              onChange(
                template.value,
              )
            }
          >
            {template.label}
          </Button>
        ),
      )}
    </div>
  )
}