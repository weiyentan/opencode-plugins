<#
.SYNOPSIS
    Manage git worktrees for the develop-loop workflow.
.DESCRIPTION
    Mirrors the interface of scripts/worktree-manager.sh with identical
    subcommands and behavior, plus additional cleanup and prune-stale commands.

    scripts/worktree-manager.ps1 create <N> <slug>
      Create worktree at .worktrees/issue-<N>-<slug> on branch
      tmp/issue-<N>-<slug> branched from master.

    scripts/worktree-manager.ps1 assign <N> <slug>
      Print the worktree path .worktrees/issue-<N>-<slug> (idempotent lookup).

    scripts/worktree-manager.ps1 clean <N> <slug>
      Remove the worktree and delete the tmp/ branch plus any preserved/ branch.

    scripts/worktree-manager.ps1 preserve <N> <slug> "<reason>"
      Rename the tmp/ branch to preserved/ so it won't be GC'd, and log the
      preservation reason.

    scripts/worktree-manager.ps1 list-preserved
      List all currently preserved worktrees from .worktrees/.preserved.log

    scripts/worktree-manager.ps1 cleanup [--force]
      Remove ALL preserved worktrees with confirmation (--force to skip prompt).

    scripts/worktree-manager.ps1 prune-stale [<days>]
      Remove preserved worktrees older than N days (default 7).

    scripts/worktree-manager.ps1 help
      Show usage information.
#>

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Paths -- resolved from script location
# ---------------------------------------------------------------------------
$SCRIPT_DIR = $PSScriptRoot
if (-not $SCRIPT_DIR) {
    $SCRIPT_DIR = Split-Path -Path $MyInvocation.MyCommand.Path -Parent
}
$REPO_ROOT   = Split-Path -Path $SCRIPT_DIR -Parent
$WORKTREE_BASE = Join-Path -Path $REPO_ROOT -ChildPath ".worktrees"
$PRESERVED_LOG = Join-Path -Path $WORKTREE_BASE -ChildPath ".preserved.log"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Die {
    param([string]$Message)
    Write-Error $Message
    exit 1
}

function CheckGitRepo {
    $null = git -C $REPO_ROOT rev-parse --git-dir 2>&1
    if ($LASTEXITCODE -ne 0) {
        Die "Not inside a git repository (or .git is missing)."
    }
}

function BranchName {
    param([string]$N, [string]$Slug)
    return "tmp/issue-${N}-${Slug}"
}

function PreservedBranchName {
    param([string]$N, [string]$Slug)
    return "preserved/issue-${N}-${Slug}"
}

function WorktreePath {
    param([string]$N, [string]$Slug)
    return Join-Path -Path $WORKTREE_BASE -ChildPath "issue-${N}-${Slug}"
}

function RequireTwoArgs {
    param([string]$Command, [System.Collections.ArrayList]$SubArgs)
    if ($SubArgs.Count -lt 2) {
        Die "Usage: scripts/worktree-manager.ps1 $Command <N> <slug>"
    }
}

function ReadPreservedLog {
    $entries = @()

    if (-not (Test-Path -LiteralPath $PRESERVED_LOG -PathType Leaf)) {
        return ,$entries
    }

    try {
        $lines = Get-Content -LiteralPath $PRESERVED_LOG -ErrorAction Stop
    } catch {
        return ,$entries
    }

    foreach ($line in $lines) {
        $line = $line.Trim()
        if ([string]::IsNullOrEmpty($line)) { continue }

        $parts = $line -split ' \| '
        if ($parts.Count -ge 3) {
            $entries += [PSCustomObject]@{
                Entry     = $parts[0].Trim()
                Timestamp = $parts[1].Trim()
                Reason    = ($parts[2..($parts.Count - 1)] -join ' | ').Trim()
            }
        }
    }

    return ,$entries
}

function WritePreservedLog {
    param([object[]]$Entries)

    if (-not $Entries -or $Entries.Count -eq 0) {
        if (Test-Path -LiteralPath $PRESERVED_LOG -PathType Leaf) {
            Remove-Item -LiteralPath $PRESERVED_LOG -Force
        }
        return
    }

    $dir = Split-Path -Path $PRESERVED_LOG -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -LiteralPath $dir -Force | Out-Null
    }

    $lines = $Entries | ForEach-Object {
        "$($_.Entry) | $($_.Timestamp) | $($_.Reason)"
    }
    [System.IO.File]::WriteAllLines($PRESERVED_LOG, $lines)
}

function RemovePreservedEntry {
    param([PSCustomObject]$EntryObj)

    $preservedBranch = "preserved/$($EntryObj.Entry)"
    $path = Join-Path -Path $WORKTREE_BASE -ChildPath $EntryObj.Entry

    if (Test-Path -LiteralPath $path -PathType Container) {
        Write-Host "  Removing worktree at $path..."
        $null = git -C $REPO_ROOT worktree remove $path 2>&1
        if ($LASTEXITCODE -ne 0) {
            $null = git -C $REPO_ROOT worktree remove --force $path 2>&1
        }
    }

    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$preservedBranch" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Deleting branch '$preservedBranch'..."
        $null = git -C $REPO_ROOT branch -D $preservedBranch 2>&1
    }

    $null = git -C $REPO_ROOT worktree prune 2>&1
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

function cmd_create {
    param([System.Collections.ArrayList]$SubArgs)
    RequireTwoArgs "create" $SubArgs
    $n = $SubArgs[0]
    $slug = $SubArgs[1]
    CheckGitRepo

    $branch = BranchName $n $slug
    $path   = WorktreePath $n $slug

    if (Test-Path -LiteralPath $path -PathType Container) {
        Write-Host "Worktree already exists at $path -- skipping creation."
        return
    }

    # Verify the branch doesn't already exist elsewhere
    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$branch" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Die "Branch '$branch' already exists. Use 'clean' first or pick a different slug."
    }

    Write-Host "Creating worktree at $path on branch $branch (from master)..."

    # The --guess-remote flag is intentionally omitted; we want a local-only branch.
    $null = git -C $REPO_ROOT worktree add -b $branch $path master 2>&1
    if ($LASTEXITCODE -ne 0) {
        Die "Failed to create worktree."
    }

    Write-Host "Worktree created successfully."
    Write-Host "  Path:   $path"
    Write-Host "  Branch: $branch"
}

function cmd_assign {
    param([System.Collections.ArrayList]$SubArgs)
    RequireTwoArgs "assign" $SubArgs
    $n = $SubArgs[0]
    $slug = $SubArgs[1]
    CheckGitRepo

    $path = WorktreePath $n $slug

    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        Die "Worktree not found at $path. Create it first with 'create $n $slug'."
    }

    Write-Output $path
}

function cmd_clean {
    param([System.Collections.ArrayList]$SubArgs)
    RequireTwoArgs "clean" $SubArgs
    $n = $SubArgs[0]
    $slug = $SubArgs[1]
    CheckGitRepo

    $branch          = BranchName $n $slug
    $preservedBranch = PreservedBranchName $n $slug
    $path            = WorktreePath $n $slug

    # If the worktree directory exists, remove it
    if (Test-Path -LiteralPath $path -PathType Container) {
        Write-Host "Removing worktree at $path..."
        # Try a safe remove first; force if that fails (e.g. dirty worktree)
        $null = git -C $REPO_ROOT worktree remove $path 2>&1
        if ($LASTEXITCODE -ne 0) {
            $null = git -C $REPO_ROOT worktree remove --force $path 2>&1
            if ($LASTEXITCODE -ne 0) {
                Die "Failed to remove worktree at $path. You may need to delete it manually."
            }
        }
    } else {
        Write-Host "Worktree path $path does not exist -- skipping worktree removal."
    }

    # Prune stale worktree metadata
    $null = git -C $REPO_ROOT worktree prune 2>&1

    # Delete the tmp/ branch if it exists
    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$branch" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Deleting branch '$branch'..."
        $null = git -C $REPO_ROOT branch -D $branch 2>&1
    }

    # Also clean up any preserved branch with the same N-slug
    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$preservedBranch" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Deleting preserved branch '$preservedBranch'..."
        $null = git -C $REPO_ROOT branch -D $preservedBranch 2>&1

        # Remove from log if present
        if (Test-Path -LiteralPath $PRESERVED_LOG -PathType Leaf) {
            $entries  = ReadPreservedLog
            $filtered = $entries | Where-Object { $_.Entry -ne "issue-${n}-${slug}" }
            WritePreservedLog $filtered
        }
    }

    Write-Host "Clean complete for issue #${n} (${slug})."
}

function cmd_preserve {
    param([System.Collections.ArrayList]$SubArgs)
    if ($SubArgs.Count -lt 2) {
        Die "Usage: scripts/worktree-manager.ps1 preserve <N> <slug> `"<reason>`""
    }
    $n      = $SubArgs[0]
    $slug   = $SubArgs[1]
    $reason = if ($SubArgs.Count -gt 2) { $SubArgs[2..($SubArgs.Count - 1)] -join ' ' } else { '' }
    if ([string]::IsNullOrEmpty($reason)) {
        Die "Usage: scripts/worktree-manager.ps1 preserve <N> <slug> `"<reason>`""
    }

    CheckGitRepo

    $oldBranch = BranchName $n $slug
    $newBranch = PreservedBranchName $n $slug
    $path      = WorktreePath $n $slug

    # Verify the tmp branch exists
    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$oldBranch" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$newBranch" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Die "Neither branch '$oldBranch' nor '$newBranch' found. Cannot preserve."
        }
        Write-Host "Branch '$newBranch' already exists -- nothing to do."
        return
    }

    # Ensure the preserved branch doesn't already exist
    $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$newBranch" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Die "Preserved branch '$newBranch' already exists. Use 'clean' first."
    }

    Write-Host "Preserving worktree for issue #${n}..."
    Write-Host "  Renaming branch: $oldBranch -> $newBranch"

    # Rename the branch
    $null = git -C $REPO_ROOT branch -m $oldBranch $newBranch 2>&1
    if ($LASTEXITCODE -ne 0) {
        Die "Failed to rename branch '$oldBranch' to '$newBranch'."
    }

    # Log the preservation
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logLine   = "issue-${n}-${slug} | ${timestamp} | ${reason}"

    $dir = Split-Path -Path $PRESERVED_LOG -Parent
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -LiteralPath $dir -Force | Out-Null
    }
    Add-Content -LiteralPath $PRESERVED_LOG -Value $logLine

    Write-Host "  Reason: ${reason}"
    Write-Host "Preservation logged to ${PRESERVED_LOG}"

    # Worktree stays in place -- the branch rename means 'clean' won't touch it
    # unless explicitly called with the same N/slug, and then it will clean
    # the preserved branch too.
}

function cmd_list_preserved {
    CheckGitRepo

    $entries = ReadPreservedLog
    if (-not $entries -or $entries.Count -eq 0) {
        Write-Host "No preserved worktrees found."
        return
    }

    Write-Host "Preserved worktrees:"
    Write-Host "--------------------"

    foreach ($item in $entries) {
        $branch = "preserved/$($item.Entry)"
        $path   = Join-Path -Path $WORKTREE_BASE -ChildPath $item.Entry

        $null = git -C $REPO_ROOT show-ref --verify --quiet "refs/heads/$branch" 2>&1
        $branchExists = ($LASTEXITCODE -eq 0)
        $pathExists   = Test-Path -LiteralPath $path -PathType Container

        if ($pathExists -and $branchExists) {
            $status = "[v] worktree + branch exist"
        } elseif ($pathExists) {
            $status = "[!] worktree exists but branch missing"
        } else {
            $status = "[x] worktree directory missing"
        }

        Write-Host ("  {0,-30} | {1} | {2} | {3}" -f $item.Entry, $item.Timestamp, $item.Reason, $status)
    }

    Write-Host ""
    Write-Host "Log file: $PRESERVED_LOG"
}

function cmd_cleanup {
    param([System.Collections.ArrayList]$SubArgs)
    CheckGitRepo

    $entries = ReadPreservedLog
    if (-not $entries -or $entries.Count -eq 0) {
        Write-Host "No preserved worktrees found."
        return
    }

    Write-Host "The following preserved worktrees will be removed:"
    foreach ($item in $entries) {
        Write-Host "  - $($item.Entry) (preserved on $($item.Timestamp): $($item.Reason))"
    }
    Write-Host ""

    $force = $SubArgs -contains "--force"
    if (-not $force) {
        $confirm = Read-Host "Are you sure you want to remove all preserved worktrees? [y/N] "
        if ($confirm -notmatch '^[yY]') {
            Write-Host "Cleanup cancelled."
            return
        }
    }

    foreach ($item in $entries) {
        RemovePreservedEntry $item
    }

    # Clear the log
    WritePreservedLog @()

    $null = git -C $REPO_ROOT worktree prune 2>&1
    Write-Host ""
    Write-Host "Cleanup complete. Removed $($entries.Count) preserved worktree(s)."
}

function cmd_prune_stale {
    param([System.Collections.ArrayList]$SubArgs)
    CheckGitRepo

    $days = 7
    if ($SubArgs.Count -ge 1 -and ($SubArgs[0] -notlike "-*")) {
        $days = [int]::Parse($SubArgs[0])
    }

    $entries = ReadPreservedLog
    if (-not $entries -or $entries.Count -eq 0) {
        Write-Host "No preserved worktrees found."
        return
    }

    $cutoff = (Get-Date).AddDays(-$days)
    $stale  = @()
    $fresh  = @()

    foreach ($item in $entries) {
        try {
            $dt = [DateTime]::ParseExact($item.Timestamp, "yyyy-MM-dd HH:mm:ss", [System.Globalization.CultureInfo]::InvariantCulture)
            if ($dt -lt $cutoff) {
                $stale += $item
            } else {
                $fresh += $item
            }
        } catch {
            # If timestamp is unparseable, keep the entry
            $fresh += $item
        }
    }

    if ($stale.Count -eq 0) {
        Write-Host "No stale preserved worktrees older than $days days found."
        return
    }

    Write-Host "Removing $($stale.Count) preserved worktree(s) older than $days days..."
    foreach ($item in $stale) {
        RemovePreservedEntry $item
    }

    WritePreservedLog $fresh

    $null = git -C $REPO_ROOT worktree prune 2>&1
    Write-Host "Prune complete. Removed $($stale.Count) stale worktree(s), kept $($fresh.Count)."
}

function ShowHelp {
    Write-Host "Usage: scripts/worktree-manager.ps1 <command> [args]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  create <N> <slug>              Create a worktree and branch"
    Write-Host "  assign <N> <slug>              Print the worktree path"
    Write-Host "  clean <N> <slug>               Remove the worktree and branch"
    Write-Host '  preserve <N> <slug> "<reason>" Preserve worktree for inspection'
    Write-Host "  list-preserved                 List preserved worktrees"
    Write-Host "  cleanup [--force]              Remove ALL preserved worktrees (with confirmation)"
    Write-Host "  prune-stale [<days>]           Remove preserved worktrees older than N days (default 7)"
    Write-Host "  help                           Show this message"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

function Main {
    CheckGitRepo

    $command = $args[0]
    if (-not $command) { ShowHelp; return }

    $subArgs = [System.Collections.ArrayList]@()
    if ($args.Count -gt 1) {
        $subArgs = [System.Collections.ArrayList]@($args[1..($args.Count - 1)])
    }

    switch ($command) {
        "create"         { cmd_create $subArgs }
        "assign"         { cmd_assign $subArgs }
        "clean"          { cmd_clean $subArgs }
        "preserve"       { cmd_preserve $subArgs }
        "list-preserved" { cmd_list_preserved }
        "cleanup"        { cmd_cleanup $subArgs }
        "prune-stale"    { cmd_prune_stale $subArgs }
        "help"           { ShowHelp }
        "--help"         { ShowHelp }
        "-h"             { ShowHelp }
        default          { Die "Unknown command: $command. Use 'help' for usage." }
    }
}

Main @args