"use client"

import { memo, useCallback, useMemo } from "react"
import { useAtomValue } from "jotai"
import { IconSpinner } from "../../../components/ui/icons"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { getDisplayPath, getToolStatus } from "./agent-tool-registry"
import { AgentToolInterrupted } from "./agent-tool-interrupted"
import { areToolPropsEqual } from "./agent-tool-utils"
import { getFileIconByExtension } from "../mentions/agents-file-mention"
import { useFileOpen } from "../mentions"
import { selectedProjectAtom } from "../atoms"
import { cn } from "../../../lib/utils"

interface AgentEditToolProps {
  part: any
  messageId?: string
  partIndex?: number
  chatStatus?: string
}

// Calculate diff stats from structuredPatch
function calculateDiffStatsFromPatch(
  patches: Array<{ lines?: string[] }>,
): { addedLines: number; removedLines: number } | null {
  if (!patches || patches.length === 0) return null

  let addedLines = 0
  let removedLines = 0

  for (const patch of patches) {
    if (!patch.lines) continue
    for (const line of patch.lines) {
      if (line.startsWith("+")) addedLines++
      else if (line.startsWith("-")) removedLines++
    }
  }

  return { addedLines, removedLines }
}

export const AgentEditTool = memo(function AgentEditTool({
  part,
  messageId,
  partIndex,
  chatStatus,
}: AgentEditToolProps) {
  const { isPending, isInterrupted, isInputStreaming } = getToolStatus(part, chatStatus)

  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectPath = selectedProject?.path
  const onOpenFile = useFileOpen()

  const isWriteMode = part.type === "tool-Write"
  const toolPrefix = isWriteMode ? "tool-Write" : "tool-Edit"

  const filePath = part.input?.file_path || ""
  const newString = part.input?.new_string || ""
  const writeContent = part.input?.content || ""

  const structuredPatch = part.output?.structuredPatch

  const filename = filePath ? filePath.split("/").pop() || "file" : ""

  const displayPath = useMemo(() => {
    return getDisplayPath(filePath, projectPath)
  }, [filePath, projectPath])

  const handleFilenameClick = useCallback((e: React.MouseEvent) => {
    if (filePath && onOpenFile) {
      e.stopPropagation()
      onOpenFile(filePath)
    }
  }, [filePath, onOpenFile])

  const FileIcon = filename ? getFileIconByExtension(filename, true) : null

  // Calculate diff stats - prefer from patch, fallback to simple count
  const diffStats = useMemo(() => {
    if (isWriteMode) {
      const content = writeContent || part.output?.content || ""
      const addedLines = content ? content.split("\n").length : 0
      return { addedLines, removedLines: 0 }
    }
    if (structuredPatch) {
      return calculateDiffStatsFromPatch(structuredPatch)
    }
    if (newString) {
      return { addedLines: newString.split("\n").length, removedLines: 0 }
    }
    return null
  }, [
    structuredPatch,
    isWriteMode,
    writeContent,
    part.output?.content,
    newString,
  ])

  const headerAction = useMemo(() => {
    if (isWriteMode) {
      return isInputStreaming ? "Creating" : "Created"
    }
    return isInputStreaming ? "Editing" : "Edited"
  }, [isWriteMode, isInputStreaming])

  // Show minimal view until we have the full file path
  if (!filePath) {
    if (isInterrupted) {
      return <AgentToolInterrupted toolName={isWriteMode ? "Write" : "Edit"} />
    }
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        <span className="text-xs text-muted-foreground">
          {isPending ? (
            <TextShimmer as="span" duration={1.2}>
              {headerAction}
            </TextShimmer>
          ) : (
            headerAction
          )}
        </span>
      </div>
    )
  }

  return (
    <div
      data-message-id={messageId}
      data-part-index={partIndex}
      data-part-type={toolPrefix}
      data-tool-file-path={displayPath}
      className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2"
    >
      <div className="flex items-center justify-between pl-2.5 pr-0.5 h-7">
        <div
          onClick={handleFilenameClick}
          className={cn(
            "flex items-center gap-1.5 text-xs truncate flex-1 min-w-0",
            displayPath && "cursor-pointer hover:text-foreground",
          )}
        >
          {FileIcon && (
            <FileIcon className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              {isPending || isInputStreaming ? (
                <TextShimmer
                  as="span"
                  duration={1.2}
                  className="truncate"
                >
                  {filename}
                </TextShimmer>
              ) : (
                <span className="truncate text-foreground">{filename}</span>
              )}
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="px-2 py-1.5 max-w-none flex items-center justify-center"
            >
              <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap leading-none">
                {displayPath}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 flex-shrink-0 ml-2",
            !(isPending || isInputStreaming) && "pr-2.5",
          )}
        >
          {diffStats && (diffStats.addedLines > 0 || diffStats.removedLines > 0) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-green-600 dark:text-green-400">
                +{diffStats.addedLines}
              </span>
              {diffStats.removedLines > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  -{diffStats.removedLines}
                </span>
              )}
            </div>
          )}

          {(isPending || isInputStreaming) && (
            <div className="w-6 h-6 flex items-center justify-center">
              <IconSpinner className="w-3 h-3" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}, areToolPropsEqual)
