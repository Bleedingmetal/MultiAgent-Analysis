import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter } from "react-router"
import { RouterProvider } from "react-router/dom"

import "./index.css"

import App from "./App"
import Dashboard from "@/pages/dashboard"
import Runs from "@/pages/runs"
import Benchmarks from "@/pages/benchmarks"
import Compare from "@/pages/compare"
import Configurations from "@/pages/configurations"
import ConfigurationBuilderPage from "@/pages/configuration-builder-page"
import ConfigurationDetailPage from "@/pages/configuration-detail-page"

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
          element: <Configurations />,
        },
        {
          path: "configurations/new",
          element: <ConfigurationBuilderPage />,
        },
        {
          path: "configurations/:id",
          element: <ConfigurationDetailPage />,
        },
        {
          path: "configurations/:id/edit",
          element: <ConfigurationBuilderPage />,
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