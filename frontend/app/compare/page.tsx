import { Suspense } from "react"

import Compare from "@/views/compare"

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="surface p-6 text-sm text-muted-foreground">
          Loading compare...
        </div>
      }
    >
      <Compare />
    </Suspense>
  )
}
