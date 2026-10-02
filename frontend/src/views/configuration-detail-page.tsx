"use client"

import {
  ArrowLeft,
  Bot,
  Calendar,
  Pencil,
  Route,
} from "lucide-react"

import Link from "next/link"
import {
  useParams,
} from "next/navigation"

import {
  useEffect,
  useState,
} from "react"

import {
  Badge,
} from "@/components/ui/badge"

import {
  Button,
} from "@/components/ui/button"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Separator,
} from "@/components/ui/separator"

import {
  getConfiguration,
} from "@/lib/configuration-storage"

import type {
  ArchitectureType,
  ConfigurationNode,
} from "@/types/configuration"

function architectureLabel(
  architecture: ArchitectureType,
) {
  switch (architecture) {
    case "single-agent":
      return "Single Agent"

    case "prompt-chaining":
      return "Prompt Chaining"

    case "routing":
      return "Routing"

    case "parallelization":
      return "Parallelization"

    case "evaluator-optimizer":
      return "Evaluator-Optimizer"

    case "autonomous-agent":
      return "Autonomous Agent"

    case "custom":
      return "Custom"
  }
}

function formatDate(
  date: string,
) {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(
    new Date(date),
  )
}

function ComponentCard({
  node,
}: {
  node: ConfigurationNode
}) {
  return (
    <div
      className="
        rounded-lg
        border
        bg-muted/20
        p-4
      "
    >
      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {node.name}
          </p>

          <p
            className="
              mt-1
              text-xs
              capitalize
              text-muted-foreground
            "
          >
            {node.type.replace(
              "-",
              " ",
            )}
          </p>
        </div>

        {node.modelSettings && (
          <Badge
            variant="secondary"
            className="shrink-0"
          >
            {
              node.modelSettings
                .provider
            }
          </Badge>
        )}
      </div>

      {node.modelSettings && (
        <div
          className="
            mt-4
            grid
            gap-3
            text-xs
            sm:grid-cols-2
          "
        >
          <div>
            <p className="text-muted-foreground">
              Model
            </p>

            <p className="mt-1">
              {
                node.modelSettings
                  .model
              }
            </p>
          </div>

          <div>
            <p className="text-muted-foreground">
              Temperature
            </p>

            <p className="mt-1">
              {
                node.modelSettings
                  .temperature ??
                "Default"
              }
            </p>
          </div>
        </div>
      )}

      {node.metadata?.role && (
        <div className="mt-3 text-xs">
          <p className="text-muted-foreground">
            Role
          </p>

          <p className="mt-1">
            {node.metadata.role}
          </p>
        </div>
      )}
    </div>
  )
}

export default function ConfigurationDetailPage() {
  const params = useParams<{
    id: string
  }>()

  const id = params?.id

  const [
    configuration,
    setConfiguration,
  ] =
    useState<
      ReturnType<
        typeof getConfiguration
      > | undefined
    >(undefined)

  const [
    ready,
    setReady,
  ] =
    useState(false)

  useEffect(() => {
    setConfiguration(
      id
        ? getConfiguration(id)
        : undefined,
    )
    setReady(true)
  }, [id])

  if (!ready) {
    return null
  }

  if (!configuration) {
    return (
      <div
        className="
          flex
          min-h-[400px]
          flex-col
          items-center
          justify-center
          gap-4
          text-center
        "
      >
        <div>
          <h2 className="text-xl font-semibold">
            Configuration not found
          </h2>

          <p
            className="
              mt-1
              text-sm
              text-muted-foreground
            "
          >
            This configuration may have
            been deleted.
          </p>
        </div>

        <Button
          render={<Link href="/configurations" />}
          className="
            h-10
            px-4
            text-sm
            font-medium
          "
        >
          <span
            className="
              flex
              flex-row
              items-center
              gap-2
              whitespace-nowrap
            "
          >
            <ArrowLeft className="size-4 shrink-0" />

            <span>
              Back to Configurations
            </span>
          </span>
        </Button>
      </div>
    )
  }

  const models =
    configuration.nodes.filter(
      (node) =>
        node.type === "model",
    )

  const orderedLayers = [
    ...configuration.layers,
  ].sort(
    (a, b) =>
      a.order - b.order,
  )

  return (
    <div className="space-y-6">
      <div
        className="
          flex
          flex-col
          gap-4
          sm:flex-row
          sm:items-start
          sm:justify-between
        "
      >
        <div className="min-w-0">
          <Button
            render={<Link href="/configurations" />}
            variant="ghost"
            className="
              -ml-3
              mb-3
              h-9
              px-3
              text-sm
              font-medium
            "
          >
            <span
              className="
                flex
                flex-row
                items-center
                gap-2
                whitespace-nowrap
              "
            >
              <ArrowLeft className="size-4 shrink-0" />

              <span>
                Configurations
              </span>
            </span>
          </Button>

          <div
            className="
              flex
              flex-wrap
              items-center
              gap-3
            "
          >
            <h2
              className="
                text-2xl
                font-semibold
                tracking-tight
              "
            >
              {configuration.name}
            </h2>

            <Badge variant="secondary">
              {architectureLabel(
                configuration.architecture,
              )}
            </Badge>
          </div>

          <p
            className="
              mt-2
              max-w-2xl
              text-sm
              text-muted-foreground
            "
          >
            {configuration.description ||
              "No description provided."}
          </p>
        </div>

        <Button
          render={
            <Link
              href={`/configurations/${configuration.id}/edit`}
            />
          }
          className="
            h-10
            shrink-0
            px-4
            text-sm
            font-medium
          "
        >
          <span
            className="
              flex
              flex-row
              items-center
              gap-2
              whitespace-nowrap
            "
          >
            <Pencil className="size-4 shrink-0" />

            <span>
              Edit Configuration
            </span>
          </span>
        </Button>
      </div>

      <div
        className="
          grid
          gap-4
          md:grid-cols-3
        "
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Architecture
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div
              className="
                flex
                flex-row
                items-center
                gap-2
              "
            >
              <Route className="size-4 shrink-0 text-mm-charge" />

              <span className="text-sm">
                {architectureLabel(
                  configuration.architecture,
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Models
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div
              className="
                flex
                flex-row
                items-center
                gap-2
              "
            >
              <Bot className="size-4 shrink-0 text-mm-charge" />

              <span className="text-sm">
                {models.length}{" "}
                {models.length === 1
                  ? "model"
                  : "models"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Last Updated
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div
              className="
                flex
                flex-row
                items-center
                gap-2
              "
            >
              <Calendar className="size-4 shrink-0 text-mm-charge" />

              <span className="text-sm">
                {formatDate(
                  configuration.updatedAt,
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Workflow
          </CardTitle>
        </CardHeader>

        <CardContent>
          <div
            className="
              flex
              items-stretch
              gap-3
              overflow-x-auto
              pb-2
            "
          >
            {orderedLayers.map(
              (
                layer,
                index,
              ) => {
                const layerNodes =
                  configuration.nodes
                    .filter(
                      (node) =>
                        node.layerId ===
                        layer.id,
                    )
                    .sort(
                      (a, b) =>
                        a.order -
                        b.order,
                    )

                return (
                  <div
                    key={
                      layer.id
                    }
                    className="
                      flex
                      flex-row
                      items-center
                      gap-3
                    "
                  >
                    <div
                      className="
                        min-w-[220px]
                        rounded-xl
                        border
                        bg-muted
                        p-4
                      "
                    >
                      <p
                        className="
                          text-[11px]
                          font-semibold
                          uppercase
                          tracking-[0.12em]
                          text-mm-blue
                        "
                      >
                        {layer.name}
                      </p>

                      <div className="mt-4 space-y-2">
                        {layerNodes.length >
                        0 ? (
                          layerNodes.map(
                            (node) => (
                              <div
                                key={
                                  node.id
                                }
                                className="
                                  rounded-md
                                  border
                                  bg-card
                                  px-3
                                  py-2
                                "
                              >
                                <p className="text-xs font-medium">
                                  {
                                    node.name
                                  }
                                </p>

                                {node.modelSettings && (
                                  <p
                                    className="
                                      mt-1
                                      text-[10px]
                                      text-muted-foreground
                                    "
                                  >
                                    {
                                      node
                                        .modelSettings
                                        .provider
                                    }{" "}
                                    ·{" "}
                                    {
                                      node
                                        .modelSettings
                                        .model
                                    }
                                  </p>
                                )}
                              </div>
                            ),
                          )
                        ) : (
                          <p
                            className="
                              text-xs
                              text-muted-foreground
                            "
                          >
                            No components
                          </p>
                        )}
                      </div>
                    </div>

                    {index <
                      orderedLayers.length -
                        1 && (
                      <span
                        className="
                          shrink-0
                          text-lg
                          text-mm-blue/40
                        "
                      >
                        →
                      </span>
                    )}
                  </div>
                )
              },
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-4">
          <h3 className="text-base font-semibold">
            Components
          </h3>

          <p
            className="
              mt-1
              text-sm
              text-muted-foreground
            "
          >
            Models and workflow components
            included in this configuration.
          </p>
        </div>

        <Separator className="mb-4" />

        <div
          className="
            grid
            gap-4
            md:grid-cols-2
            xl:grid-cols-3
          "
        >
          {configuration.nodes.map(
            (node) => (
              <ComponentCard
                key={
                  node.id
                }
                node={
                  node
                }
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}