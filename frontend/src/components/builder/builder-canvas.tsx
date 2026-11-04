"use client"

import ArchitecturePipeline from "@/components/builder/architecture-pipeline"
import CustomPipeline from "@/components/builder/custom-pipeline"
import NodePalette from "@/components/builder/node-palette"
import PropertiesPanel from "@/components/builder/properties-panel"
import type { ConfigurationBuilderState } from "@/hooks/use-configuration-builder"
import { isNodeCompatibleWithLayer } from "@/lib/configuration-validation"
import { MAX_CHAIN_STEPS, chainAgents } from "@/lib/prompt-chain"
import { MAX_ROUTES, routeAgents } from "@/lib/routing"

interface Props {
  builder: ConfigurationBuilderState
}

export default function BuilderCanvas({ builder }: Props) {
  const selectedLayer = builder.configuration.layers.find(
    (layer) => layer.id === builder.selectedLayerId,
  )
  const isPromptChain =
    builder.configuration.architecture === "prompt-chaining"
  const isRouting = builder.configuration.architecture === "routing"
  const chainCount = chainAgents(builder.configuration).length
  const routeCount = routeAgents(builder.configuration).length

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        {builder.isCustom ? (
          <CustomPipeline
            layers={builder.configuration.layers}
            nodes={builder.configuration.nodes}
            edges={builder.configuration.edges}
            selectedNodeId={builder.selectedNodeId}
            selectedLayerId={builder.selectedLayerId}
            linkSourceId={builder.linkSourceId}
            onSelectNode={builder.setSelectedNodeId}
            onSelectLayer={builder.setSelectedLayerId}
            onMoveLayer={builder.moveLayer}
            onRemoveLayer={builder.removeLayer}
            onAddLayer={builder.addLayer}
            onStartLink={builder.setLinkSourceId}
            onCancelLink={() => builder.setLinkSourceId(null)}
            onRemoveEdge={builder.removeEdge}
          />
        ) : (
          <ArchitecturePipeline
            layers={builder.configuration.layers}
            nodes={builder.configuration.nodes}
            selectedNodeId={builder.selectedNodeId}
            architecture={builder.configuration.architecture}
            onSelect={builder.setSelectedNodeId}
            onMoveNode={
              isPromptChain ? builder.moveChainAgent : undefined
            }
            onAddAgent={
              isPromptChain
                ? () =>
                    builder.addComponent({
                      label: "GPT Agent",
                      type: "model",
                      provider: "openai",
                      model: "gpt-4o-mini",
                    })
                : undefined
            }
            canAddAgent={chainCount < MAX_CHAIN_STEPS}
            onAddRoute={
              isRouting
                ? () =>
                    builder.addComponent({
                      label: "GPT Agent",
                      type: "model",
                      provider: "openai",
                      model: "gpt-4o-mini",
                    })
                : undefined
            }
            canAddRoute={routeCount < MAX_ROUTES}
          />
        )}

        <div className="rounded-2xl border border-border/80 bg-white">
          <NodePalette
            onAdd={(item) => {
              if (builder.isCustom && builder.selectedLayerId) {
                const layer = builder.configuration.layers.find(
                  (entry) => entry.id === builder.selectedLayerId,
                )
                if (
                  layer &&
                  isNodeCompatibleWithLayer(item.type, layer.type)
                ) {
                  builder.addComponent(item, layer.id)
                  return
                }
              }
              builder.addComponent(item)
            }}
            targetLabel={
              builder.isCustom
                ? selectedLayer
                  ? selectedLayer.name
                  : undefined
                : undefined
            }
            allowedTypes={
              isPromptChain || isRouting ? ["model"] : undefined
            }
            executableProvidersOnly={isPromptChain || isRouting}
          />
        </div>
      </div>

      <div className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-white lg:sticky lg:top-24 lg:self-start">
        <PropertiesPanel
          node={builder.selectedNode}
          architecture={builder.configuration.architecture}
          canDelete={builder.canDeleteSelectedNode}
          onDelete={builder.deleteNode}
          onUpdateName={builder.updateNodeName}
          onUpdateModel={builder.updateModel}
          onUpdateInstructions={builder.updateInstructions}
          onUpdatePromptStep={builder.updatePromptStep}
          onUpdateRouterSettings={builder.updateRouterSettings}
          configuration={builder.configuration}
        />
      </div>
    </div>
  )
}
