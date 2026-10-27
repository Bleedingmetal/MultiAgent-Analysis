"use client"

import { ArrowLeft, Save } from "lucide-react"
import { useState } from "react"

import BuilderCanvas from "@/components/builder/builder-canvas"
import TemplateToolbar from "@/components/builder/template-toolbar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useConfigurationBuilder } from "@/hooks/use-configuration-builder"
import type { AgentConfiguration } from "@/types/configuration"

interface Props {
  initialConfiguration: AgentConfiguration
  onSave: (configuration: AgentConfiguration) => void
  onCancel: () => void
}

export default function ConfigurationBuilder({
  initialConfiguration,
  onSave,
  onCancel,
}: Props) {
  const builder = useConfigurationBuilder(initialConfiguration)

  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState(
    initialConfiguration.name === "Untitled Configuration"
      ? ""
      : initialConfiguration.name,
  )
  const [description, setDescription] = useState(
    initialConfiguration.description ?? "",
  )

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) return

    let payload: AgentConfiguration
    try {
      const exported = builder.exportConfiguration()
      payload = {
        ...exported,
        name: trimmedName,
        description: description.trim() || undefined,
        updatedAt: new Date().toISOString(),
      }
    } catch (err) {
      console.error("Failed to export configuration", err)
      window.alert(
        err instanceof Error
          ? `Save failed: ${err.message}`
          : "Save failed. Check the browser console.",
      )
      return
    }

    setSaveOpen(false)
    window.setTimeout(() => {
      onSave(payload)
    }, 0)
  }

  return (
    <>
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-2"
              onClick={onCancel}
            >
              <ArrowLeft data-icon="inline-start" />
              Configurations
            </Button>

            <h2 className="text-2xl font-semibold tracking-tight text-mm-dark">
              Configuration Builder
            </h2>
          </div>

          <Button className="shrink-0" onClick={() => setSaveOpen(true)}>
            <Save data-icon="inline-start" />
            Save
          </Button>
        </div>

        <TemplateToolbar
          value={builder.configuration.architecture}
          onChange={builder.loadTemplate}
        />

        <BuilderCanvas builder={builder} />
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Configuration</DialogTitle>
            <DialogDescription className="sr-only">
              Name and save this configuration.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="configuration-name">Name</Label>
              <Input
                id="configuration-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. GPT Single Agent"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="configuration-description">Description</Label>
              <Textarea
                id="configuration-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional notes about this configuration..."
                className="min-h-24"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!name.trim()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                handleSave()
              }}
            >
              <Save data-icon="inline-start" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
