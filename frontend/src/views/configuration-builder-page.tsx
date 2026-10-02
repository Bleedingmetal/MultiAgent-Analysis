"use client"

import {
  ArrowLeft,
} from "lucide-react"

import Link from "next/link"
import {
  useParams,
  useRouter,
} from "next/navigation"

import {
  useEffect,
  useState,
} from "react"

import ConfigurationBuilder from "@/components/builder/configuration-builder"

import {
  Button,
} from "@/components/ui/button"

import {
  createNewConfiguration,
  getConfiguration,
  saveConfiguration,
} from "@/lib/configuration-storage"

import type {
  AgentConfiguration,
} from "@/types/configuration"

export default function ConfigurationBuilderPage() {
  const params = useParams<{
    id?: string
  }>()

  const id = params?.id

  const router = useRouter()

  const [
    initialConfiguration,
    setInitialConfiguration,
  ] =
    useState<
      AgentConfiguration | null | undefined
    >(undefined)

  useEffect(() => {
    if (id) {
      setInitialConfiguration(
        getConfiguration(id) ?? null,
      )
      return
    }

    setInitialConfiguration(
      createNewConfiguration(),
    )
  }, [id])

  if (
    initialConfiguration === undefined
  ) {
    return null
  }

  if (
    id &&
    !initialConfiguration
  ) {
    return (
      <div
        className="
          flex min-h-[400px]
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
            This configuration may
            have been deleted.
          </p>
        </div>

        <Button render={<Link href="/configurations" />}>
            <ArrowLeft data-icon="inline-start" />

            Back to Configurations
        </Button>
      </div>
    )
  }

  function handleSave(
    configuration:
      AgentConfiguration,
  ) {
    saveConfiguration(
      configuration,
    )

    router.push(
      "/configurations",
    )
  }

  return (
    <ConfigurationBuilder
      initialConfiguration={
        initialConfiguration!
      }
      onSave={
        handleSave
      }
      onCancel={() =>
        router.push(
          "/configurations",
        )
      }
    />
  )
}
