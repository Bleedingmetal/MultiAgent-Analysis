import type { ComponentType } from "react"

import {
  Activity,
  Clock3,
  DollarSign,
  Target,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type MetricCardProps = {
  title: string
  value: string
  description: string
  icon: ComponentType<{ className?: string }>
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>

        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>

      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">
          {value}
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  )
}

const benchmarks = [
  {
    name: "τ-bench Retail",
    structure: "Sequential · Shared-state",
    description:
      "Tool-calling customer service with a simulated user.",
  },
  {
    name: "FinQA / TAT-QA",
    structure: "Deterministic · Decomposable",
    description:
      "Numeric reasoning over financial tables and text.",
  },
  {
    name: "Finance Agent Benchmark",
    structure: "Breadth-first Research",
    description:
      "Research tasks over real SEC filings.",
  },
]

const recentRuns = [
  {
    id: "#024",
    benchmark: "Finance Agent Benchmark",
    architecture: "Parallelization",
    model: "GPT",
    success: "84.2%",
    latency: "8.4s",
    status: "Completed",
  },
  {
    id: "#023",
    benchmark: "FinQA",
    architecture: "Prompt Chaining",
    model: "Claude",
    success: "89.1%",
    latency: "2.2s",
    status: "Completed",
  },
  {
    id: "#022",
    benchmark: "τ-bench Retail",
    architecture: "Autonomous Agent",
    model: "GPT",
    success: "76.8%",
    latency: "11.6s",
    status: "Completed",
  },
]

export default function Dashboard() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Evaluation Overview
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Compare model and agent architectures across benchmark task structures.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Task Success"
          value="82.4%"
          description="Across completed evaluations"
          icon={Target}
        />

        <MetricCard
          title="Cost / Success"
          value="$0.041"
          description="Average successful task"
          icon={DollarSign}
        />

        <MetricCard
          title="Average Latency"
          value="4.8s"
          description="Per benchmark task"
          icon={Clock3}
        />

        <MetricCard
          title="Evaluation Runs"
          value="24"
          description="Across all configurations"
          icon={Activity}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Benchmark Coverage</CardTitle>
            <CardDescription>
              Task structures used to test architecture trade-offs.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            {benchmarks.map((benchmark) => (
              <div
                key={benchmark.name}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{benchmark.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {benchmark.description}
                  </p>
                </div>

                <Badge variant="secondary">
                  {benchmark.structure}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Framework Validation</CardTitle>
            <CardDescription>
              Criteria used to validate the evaluation framework.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Fidelity</p>
                <Badge variant="outline">Required</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Reproduce published benchmark results within noise.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Discrimination</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reveal different trade-offs across task structures.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Reliability</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Remain stable when evaluation samples are resampled.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Extensibility</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add new benchmarks through a single adapter.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>
            Latest architecture and model evaluations.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Benchmark</TableHead>
                <TableHead>Architecture</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Success</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead className="text-right">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {recentRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs">
                    {run.id}
                  </TableCell>

                  <TableCell className="font-medium">
                    {run.benchmark}
                  </TableCell>

                  <TableCell>{run.architecture}</TableCell>

                  <TableCell>{run.model}</TableCell>

                  <TableCell>{run.success}</TableCell>

                  <TableCell>{run.latency}</TableCell>

                  <TableCell className="text-right">
                    <Badge variant="outline">
                      {run.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}