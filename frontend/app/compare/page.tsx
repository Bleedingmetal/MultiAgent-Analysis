import { Suspense } from "react"

import Lab from "@/views/lab"

export const metadata = { title: "Lab · MassMutual" }

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="surface p-6 text-sm text-muted-foreground">
          Loading the Lab…
        </div>
      }
    >
      <Lab />
    </Suspense>
  )
}
