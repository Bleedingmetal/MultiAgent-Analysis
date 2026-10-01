import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter } from "react-router"
import { RouterProvider } from "react-router/dom"

import "./index.css"

import App from "./App"
import Dashboard from "@/pages/dashboard"
import Configurations from "@/pages/configurations"
import Runs from "@/pages/runs"
import Benchmarks from "@/pages/benchmarks"
import Compare from "@/pages/compare"

const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    children: [
      {
        index: true,
        Component: Dashboard,
      },
      {
        path: "configurations",
        Component: Configurations,
      },
      {
        path: "runs",
        Component: Runs,
      },
      {
        path: "benchmarks",
        Component: Benchmarks,
      },
      {
        path: "compare",
        Component: Compare,
      },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)