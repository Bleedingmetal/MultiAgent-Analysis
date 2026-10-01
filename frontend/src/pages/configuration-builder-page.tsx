import {
  ArrowLeft,
} from "lucide-react"

import {
  Link,
  useNavigate,
  useParams,
} from "react-router"

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
  const {
    id,
  } =
    useParams<{
      id: string
    }>()

  const navigate =
    useNavigate()

  const initialConfiguration =
    id
      ? getConfiguration(id)
      : createNewConfiguration()

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

        <Button asChild>
          <Link to="/configurations">
            <ArrowLeft data-icon="inline-start" />

            Back to Configurations
          </Link>
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

    navigate(
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
        navigate(
          "/configurations",
        )
      }
    />
  )
}