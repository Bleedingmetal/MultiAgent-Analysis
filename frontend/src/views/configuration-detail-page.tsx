"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowLeft, PencilSimple } from "@phosphor-icons/react"

import { ConfigRunPanel } from "@/components/product/config-run-panel"
import { Reveal } from "@/components/product/ui-bits"
import { Button } from "@/components/ui/button"
import { getConfiguration } from "@/lib/configuration-storage"
import type {
  ArchitectureType,
  ConfigurationNode,
} from "@/types/configuration"

function architectureLabel(architecture: ArchitectureType) {
  switch (architecture) {
    case "single-agent":
      return "Single agent"
    case "prompt-chaining":
      return "Prompt chaining"
    case "routing":
      return "Routing"
    case "parallelization":
      return "Parallelization"
    case "evaluator-optimizer":
      return "Evaluator-optimizer"
    case "autonomous-agent":
      return "Autonomous"
    case "custom":
      return "Custom"
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date))
}

function NodeChip({ node }: { node: ConfigurationNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-white px-3 py-2.5">
      <p className="text-[13px] font-medium text-mm-dark">{node.name}</p>
      {node.modelSettings ? (
        <p className="mt-0.5 font-data text-[11px] text-muted-foreground">
          {node.modelSettings.provider} / {node.modelSettings.model}
        </p>
      ) : (
        <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
          {node.type.replace("-", " ")}
        </p>
      )}
    </div>
  )
}

export default function ConfigurationDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [configuration, setConfiguration] = useState<
    ReturnType<typeof getConfiguration> | undefined
  >(undefined)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setConfiguration(id ? getConfiguration(id) : undefined)
    setReady(true)
  }, [id])

  if (!ready) return null

  if (!configuration) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-xl font-semibold text-mm-dark">Not found</h2>
        <Button
          render={<Link href="/configurations" />}
          variant="outline"
          className="h-10 rounded-full px-4"
        >
          <ArrowLeft className="size-4" />
          Configurations
        </Button>
      </div>
    )
  }

  const models = configuration.nodes.filter((n) => n.type === "model")
  const orderedLayers = [...configuration.layers].sort(
    (a, b) => a.order - b.order,
  )

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0 max-w-3xl">
          <Link
            href="/configurations"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-mm-dark"
          >
            <ArrowLeft className="size-3.5" weight="bold" />
            Configurations
          </Link>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] text-mm-dark md:text-[42px]">
            {configuration.name}
          </h2>
          {configuration.description ? (
            <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground">
              {configuration.description}
            </p>
          ) : null}
          <p className="mt-4 font-data text-[12px] text-muted-foreground">
            {architectureLabel(configuration.architecture)}
            <span className="mx-2 text-border">/</span>
            {models.length} {models.length === 1 ? "model" : "models"}
            <span className="mx-2 text-border">/</span>
            {formatDate(configuration.updatedAt)}
          </p>
        </div>
        <Button
          render={<Link href={`/configurations/${configuration.id}/edit`} />}
          variant="outline"
          className="h-10 rounded-full border-border/80 px-4 text-sm"
        >
          <PencilSimple className="size-4" weight="bold" />
          Edit
        </Button>
      </Reveal>

      <div className="grid gap-5 xl:grid-cols-12">
        <Reveal delay={0.06} className="xl:col-span-8">
          <ConfigRunPanel configuration={configuration} />
        </Reveal>

        <Reveal delay={0.1} className="xl:col-span-4">
          <aside className="bezel xl:sticky xl:top-24">
            <div className="bezel-core p-5">
              <h3 className="text-[15px] font-semibold tracking-tight text-mm-dark">
                Pipeline
              </h3>
              <ol className="mt-5 space-y-0">
                {orderedLayers.map((layer, index) => {
                  const layerNodes = configuration.nodes
                    .filter((n) => n.layerId === layer.id)
                    .sort((a, b) => a.order - b.order)
                  return (
                    <li key={layer.id} className="relative pl-6">
                      {index < orderedLayers.length - 1 ? (
                        <span
                          aria-hidden
                          className="absolute left-[7px] top-5 bottom-0 w-px bg-border"
                        />
                      ) : null}
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 size-[15px] rounded-full border-2 border-mm-charge bg-white"
                      />
                      <p className="text-[12px] font-medium text-muted-foreground">
                        {layer.name}
                      </p>
                      <div className="mt-2 mb-5 space-y-2">
                        {layerNodes.length ? (
                          layerNodes.map((node) => (
                            <NodeChip key={node.id} node={node} />
                          ))
                        ) : (
                          <p className="text-[12px] text-muted-foreground">
                            Empty
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </aside>
        </Reveal>
      </div>
    </div>
  )
}
