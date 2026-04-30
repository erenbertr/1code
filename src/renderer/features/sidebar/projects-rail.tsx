"use client"

import { useCallback, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { IconFolder, IconPlus, IconLayoutGrid, IconSettings } from "@tabler/icons-react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { selectedProjectAtom, desktopViewAtom } from "../agents/atoms"
import {
  agentsSidebarOpenAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../lib/atoms"

const RAIL_WIDTH = 56
// Reserve space at the top of the rail so the first button clears the
// macOS traffic-light buttons (only when running on desktop, non-fullscreen).
const TRAFFIC_LIGHTS_RESERVED_PX = 36

type ProjectRow = {
  id: string
  name: string
  path: string
  iconPath: string | null
  accentColor: string | null
  gitOwner: string | null
  gitRepo: string | null
  gitRemoteUrl: string | null
  gitProvider: string | null
}

function projectInitial(project: Pick<ProjectRow, "name" | "gitRepo">) {
  const source = project.gitRepo || project.name || "?"
  const trimmed = source.trim()
  if (!trimmed) return "?"
  return trimmed.charAt(0).toUpperCase()
}

function projectLabel(project: Pick<ProjectRow, "name" | "gitOwner" | "gitRepo">) {
  if (project.gitOwner && project.gitRepo) {
    return `${project.gitOwner}/${project.gitRepo}`
  }
  return project.name
}

interface RailButtonProps {
  active?: boolean
  onClick: () => void
  tooltip: string
  children: React.ReactNode
  ariaLabel: string
  disabled?: boolean
}

function RailButton({
  active = false,
  onClick,
  tooltip,
  children,
  ariaLabel,
  disabled,
}: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-pressed={active}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
            "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
            active
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground"
            />
          )}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function ProjectsRail() {
  const utils = trpc.useUtils()
  const { data: projects } = trpc.projects.list.useQuery()
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSidebarOpen = useSetAtom(agentsSidebarOpenAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const needsTrafficLightSpacer = isDesktop && isFullscreen !== true

  const sortedProjects = useMemo<ProjectRow[]>(() => {
    if (!projects) return []
    return [...projects] as ProjectRow[]
  }, [projects])

  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (!project) return
      utils.projects.list.setData(undefined, (oldData) => {
        if (!oldData) return [project]
        const exists = oldData.some((p) => p.id === project.id)
        if (exists) {
          return oldData.map((p) =>
            p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
          )
        }
        return [project, ...oldData]
      })
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl ?? null,
        gitProvider: (project.gitProvider as
          | "github"
          | "gitlab"
          | "bitbucket"
          | null) ?? null,
        gitOwner: project.gitOwner ?? null,
        gitRepo: project.gitRepo ?? null,
      })
      setSidebarOpen(true)
    },
  })

  const handleSelectProject = useCallback(
    (project: ProjectRow) => {
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: (project.gitProvider as
          | "github"
          | "gitlab"
          | "bitbucket"
          | null) ?? null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setSidebarOpen(true)
    },
    [setSelectedProject, setSidebarOpen],
  )

  const handleSelectAll = useCallback(() => {
    setSelectedProject(null)
    setSidebarOpen(true)
  }, [setSelectedProject, setSidebarOpen])

  const handleAddProject = useCallback(() => {
    if (openFolder.isPending) return
    openFolder.mutate()
  }, [openFolder])

  const handleOpenSettings = useCallback(() => {
    setDesktopView("settings")
    setSidebarOpen(true)
  }, [setDesktopView, setSidebarOpen])

  const isAllActive = selectedProject == null

  return (
    <div
      className="flex flex-col items-center justify-between border-r bg-background/60 pb-3"
      style={{
        width: RAIL_WIDTH,
        borderRightWidth: "0.5px",
        paddingTop: needsTrafficLightSpacer ? TRAFFIC_LIGHTS_RESERVED_PX : 12,
      }}
    >
      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          active={isAllActive}
          onClick={handleSelectAll}
          tooltip="All projects"
          ariaLabel="Show all projects"
        >
          <IconLayoutGrid className="h-[18px] w-[18px]" stroke={1.75} />
        </RailButton>

        <div className="my-1 h-px w-6 bg-foreground/[0.08]" aria-hidden />

        {sortedProjects.map((project) => {
          const isActive = selectedProject?.id === project.id
          const label = projectLabel(project)
          const initial = projectInitial(project)
          const accent = project.accentColor ?? undefined
          return (
            <RailButton
              key={project.id}
              active={isActive}
              onClick={() => handleSelectProject(project)}
              tooltip={label}
              ariaLabel={`Open project ${label}`}
            >
              {project.iconPath ? (
                <span
                  className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md"
                  style={{ backgroundColor: accent }}
                >
                  <img
                    src={`file://${project.iconPath}`}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </span>
              ) : (
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold uppercase tracking-wide",
                    "border border-foreground/10",
                  )}
                  style={{
                    backgroundColor: accent ?? "var(--color-muted, rgba(255,255,255,0.04))",
                    color: accent ? "#fff" : undefined,
                  }}
                >
                  {initial || <IconFolder className="h-4 w-4" stroke={1.75} />}
                </span>
              )}
            </RailButton>
          )
        })}

        <RailButton
          onClick={handleAddProject}
          tooltip={openFolder.isPending ? "Opening..." : "Add project"}
          ariaLabel="Add project"
          disabled={openFolder.isPending}
        >
          <IconPlus className="h-[18px] w-[18px]" stroke={1.75} />
        </RailButton>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          onClick={handleOpenSettings}
          tooltip="Settings"
          ariaLabel="Open settings"
        >
          <IconSettings className="h-[18px] w-[18px]" stroke={1.75} />
        </RailButton>
      </div>
    </div>
  )
}
