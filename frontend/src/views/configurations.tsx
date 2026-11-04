"use client"

import {
  Bot,
  Clock3,
  Plus,
  Trash2,
} from "lucide-react"

import Link from "next/link"

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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  deleteConfiguration,
  getConfigurations,
} from "@/lib/configuration-storage"

import type {
  AgentConfiguration,
  ArchitectureType,
} from "@/types/configuration"

function architectureLabel(
  architecture:
    ArchitectureType,
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

function formatUpdatedDate(
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

function ConfigurationCard({
  configuration,
  onDelete,
}: {
  configuration:
    AgentConfiguration

  onDelete: (
    id: string,
  ) => void
}) {
  const modelCount =
    configuration.nodes.filter(
      (node) =>
        node.type === "model",
    ).length

  return (
    <Card
      className="
        flex min-h-[220px]
        flex-col
        transition-colors
        hover:border-mm-charge/50
      "
    >
      <CardHeader>
        <div
          className="
            flex items-start
            justify-between
            gap-3
          "
        >
          <div className="min-w-0">
            <CardTitle
              className="
                truncate
                text-base
              "
            >
              {
                configuration.name
              }
            </CardTitle>

            <CardDescription
              className="
                mt-2
                line-clamp-2
                min-h-10
              "
            >
              {configuration.description ||
                "No description"}
            </CardDescription>
          </div>

          <Badge
            variant="secondary"
            className="shrink-0"
          >
            {architectureLabel(
              configuration.architecture,
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent
        className="
          flex flex-1
          flex-col
          justify-between
          gap-4
        "
      >
        <div
          className="
            flex flex-wrap
            gap-4
            text-xs
            text-muted-foreground
          "
        >
          <div className="flex items-center gap-1.5">
            <Bot className="size-3.5" />

            <span>
              {modelCount}{" "}
              {modelCount === 1
                ? "model"
                : "models"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock3 className="size-3.5" />

            <span>
              {formatUpdatedDate(
                configuration.updatedAt,
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            render={
              <Link
                href={`/configurations/${configuration.id}`}
              />
            }
            className="flex-1"
          >
            Open
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              onDelete(
                configuration.id,
              )
            }
            aria-label="Delete configuration"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Configurations() {
  const [
    configurations,
    setConfigurations,
  ] =
    useState<
      AgentConfiguration[]
    >([])

  useEffect(() => {
    setConfigurations(
      getConfigurations(),
    )
  }, [])

  function handleDelete(
    id: string,
  ) {
    const configuration =
      configurations.find(
        (item) =>
          item.id === id,
      )

    if (!configuration) {
      return
    }

    const confirmed =
      window.confirm(
        `Delete "${configuration.name}"?`,
      )

    if (!confirmed) {
      return
    }

    deleteConfiguration(
      id,
    )

    setConfigurations(
      getConfigurations(),
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="rise-in">
        <h2 className="text-[28px] font-semibold tracking-tight text-mm-dark">
          Configurations
        </h2>
      </div>

      <div
        className="
          grid gap-4
          md:grid-cols-2
          xl:grid-cols-3
        "
      >
        <Link
          href="/configurations/new"
          className="block"
        >
          <Card
            className="
              flex min-h-[220px]
              h-full
              cursor-pointer
              items-center
              justify-center
              border-dashed
              border-mm-charge/40
              transition-colors
              hover:border-mm-charge
              hover:bg-mm-charge/5
            "
          >
            <CardContent
              className="
                flex flex-col
                items-center
                justify-center
                gap-3
                py-8
                text-center
              "
            >
              <div
                className="
                  flex size-11
                  items-center
                  justify-center
                  rounded-lg
                  border
                  bg-muted
                "
              >
                <Plus className="size-5" />
              </div>

              <div>
                <p className="text-sm font-medium">
                  New Configuration
                </p>

                <p
                  className="
                    mt-1
                    text-xs
                    text-muted-foreground
                  "
                >
                  Create a new agent
                  architecture.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>

        {configurations.map(
          (configuration) => (
            <ConfigurationCard
              key={
                configuration.id
              }
              configuration={
                configuration
              }
              onDelete={
                handleDelete
              }
            />
          ),
        )}
      </div>

      {configurations.length ===
        0 && (
        <p
          className="
            text-center
            text-xs
            text-muted-foreground
          "
        >
          No saved configurations yet.
          Create one to get started.
        </p>
      )}
    </div>
  )
}