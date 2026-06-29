#!/usr/bin/env bash
# shellcheck disable=SC2317  # Don't flag functions that are called indirectly
# ---------------------------------------------------------------------------
# worktree-manager.sh — Manage git worktrees for the develop-loop workflow.
#
# Usage:
#   scripts/worktree-manager.sh create <N> <slug>
#     Create worktree at .worktrees/issue-<N>-<slug> on branch
#     tmp/issue-<N>-<slug> branched from master.
#
#   scripts/worktree-manager.sh assign <N> <slug>
#     Print the worktree path .worktrees/issue-<N>-<slug> (idempotent).
#
#   scripts/worktree-manager.sh clean <N> <slug>
#     Remove the worktree and delete the tmp/ branch.
#
#   scripts/worktree-manager.sh preserve <N> <slug> "<reason>"
#     Rename the tmp/ branch to preserved/ so it won't be GC'd, and log the
#     preservation reason.
#
#   scripts/worktree-manager.sh list-preserved
#     List all currently preserved worktrees.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_BASE="$REPO_ROOT/.worktrees"
PRESERVED_LOG="$WORKTREE_BASE/.preserved.log"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
    echo "Error: $*" >&2
    exit 1
}

check_git_repo() {
    git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 \
        || die "Not inside a git repository (or .git is missing)."
}

branch_name() {
    local n="$1" slug="$2"
    echo "tmp/issue-${n}-${slug}"
}

preserved_branch_name() {
    local n="$1" slug="$2"
    echo "preserved/issue-${n}-${slug}"
}

worktree_path() {
    local n="$1" slug="$2"
    echo "${WORKTREE_BASE}/issue-${n}-${slug}"
}

require_two_args() {
    if [[ $# -lt 2 ]]; then
        die "Usage: $0 ${1:-COMMAND} <N> <slug>"
    fi
}

check_not_in_worktree() {
    local current
    current="$(git -C "$REPO_ROOT" rev-parse --is-inside-work-tree 2>/dev/null || true)"
    if [[ "$current" != "true" ]]; then
        die "This command must be run from the main working tree, not a bare repository."
    fi
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_create() {
    require_two_args create "$@"
    local n="$1" slug="$2"
    shift 2

    check_git_repo

    local branch
    branch="$(branch_name "$n" "$slug")"
    local path
    path="$(worktree_path "$n" "$slug")"

    if [[ -d "$path" ]]; then
        echo "Worktree already exists at $path — skipping creation."
        return 0
    fi

    # Verify the branch doesn't already exist elsewhere
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
        die "Branch '$branch' already exists. Use 'clean' first or pick a different slug."
    fi

    echo "Creating worktree at $path on branch $branch (from master)..."

    # The --guess-remote flag is intentionally omitted; we want a local-only branch.
    git -C "$REPO_ROOT" worktree add -b "$branch" "$path" master

    echo "Worktree created successfully."
    echo "  Path:   $path"
    echo "  Branch: $branch"
}

cmd_assign() {
    require_two_args assign "$@"
    local n="$1" slug="$2"

    check_git_repo

    local path
    path="$(worktree_path "$n" "$slug")"

    if [[ ! -d "$path" ]]; then
        die "Worktree not found at $path. Create it first with '$0 create $n $slug'."
    fi

    echo "$path"
}

cmd_clean() {
    require_two_args clean "$@"
    local n="$1" slug="$2"
    shift 2

    check_git_repo

    local branch
    branch="$(branch_name "$n" "$slug")"
    local preserved_branch
    preserved_branch="$(preserved_branch_name "$n" "$slug")"
    local path
    path="$(worktree_path "$n" "$slug")"

    # If the worktree directory exists, remove it
    if [[ -d "$path" ]]; then
        echo "Removing worktree at $path..."
        # Try a safe remove first; force if that fails (e.g. dirty worktree)
        git -C "$REPO_ROOT" worktree remove "$path" 2>/dev/null \
            || git -C "$REPO_ROOT" worktree remove --force "$path" \
            || die "Failed to remove worktree at $path. You may need to delete it manually."
    else
        echo "Worktree path $path does not exist — skipping worktree removal."
    fi

    # Prune stale worktree metadata
    git -C "$REPO_ROOT" worktree prune

    # Delete the tmp/ branch if it exists
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
        # Check for commits relative to master -- push recovery branch if work exists
        local commit_count
        commit_count=$(git -C "$REPO_ROOT" rev-list --count master.."$branch" 2>/dev/null || echo "0")
        if [[ "$commit_count" -gt 0 ]]; then
            echo "Branch '$branch' has $commit_count commit(s) relative to master. Pushing recovery branch..."
            if git -C "$REPO_ROOT" push origin "$branch:refs/heads/review-blocked/issue-${n}-${slug}" 2>/dev/null; then
                local remote_url
                remote_url=$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || echo "origin")
                # Convert SCP-style git URLs to HTTPS for display
                local display_url
                display_url=$(echo "$remote_url" | sed 's|^git@\(.*\):|https://\1/|; s|\.git$||')
                echo "Recovery branch pushed: ${display_url}/-/tree/review-blocked/issue-${n}-${slug}"
            else
                echo "Warning: Failed to push recovery branch for issue #${n} -- continuing with local cleanup."
            fi
        fi
        echo "Deleting branch '$branch'..."
        git -C "$REPO_ROOT" branch -D "$branch"
    fi

    # Also clean up any preserved branch with the same N-slug
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$preserved_branch"; then
        echo "Deleting preserved branch '$preserved_branch'..."
        git -C "$REPO_ROOT" branch -D "$preserved_branch"
        # Remove from log if present
        if [[ -f "$PRESERVED_LOG" ]]; then
            local tmp_log
            tmp_log="$(mktemp)"
            grep -v "issue-${n}-${slug} " "$PRESERVED_LOG" > "$tmp_log" 2>/dev/null || true
            mv "$tmp_log" "$PRESERVED_LOG"
            # Remove log if now empty
            [[ ! -s "$PRESERVED_LOG" ]] && rm -f "$PRESERVED_LOG"
        fi
    fi

    echo "Clean complete for issue #${n} (${slug})."
}

cmd_preserve() {
    require_two_args preserve "$@"
    local n="$1" slug="$2"
    shift 2
    local reason="${*:-}"
    [[ -z "$reason" ]] && die "Usage: $0 preserve <N> <slug> \"<reason>\""

    check_git_repo

    local old_branch
    old_branch="$(branch_name "$n" "$slug")"
    local new_branch
    new_branch="$(preserved_branch_name "$n" "$slug")"
    local path
    path="$(worktree_path "$n" "$slug")"

    # Verify the tmp branch exists
    if ! git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$old_branch"; then
        if ! git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$new_branch"; then
            die "Neither branch '$old_branch' nor '$new_branch' found. Cannot preserve."
        fi
        echo "Branch '$new_branch' already exists — nothing to do."
        return 0
    fi

    # Ensure the preserved branch doesn't already exist
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$new_branch"; then
        die "Preserved branch '$new_branch' already exists. Use 'clean' first."
    fi

    echo "Preserving worktree for issue #${n}..."
    echo "  Renaming branch: $old_branch -> $new_branch"

    # Rename the branch
    git -C "$REPO_ROOT" branch -m "$old_branch" "$new_branch"

    # Log the preservation
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    local log_line="issue-${n}-${slug} | ${timestamp} | ${reason}"

    mkdir -p "$WORKTREE_BASE"
    echo "$log_line" >> "$PRESERVED_LOG"

    echo "  Reason: ${reason}"
    echo "Preservation logged to ${PRESERVED_LOG}"

    # Worktree stays in place — the branch rename means 'clean' won't touch it
    # unless explicitly called with the same N/slug, and then it will clean
    # the preserved branch too.
}

cmd_list_preserved() {
    check_git_repo

    if [[ ! -f "$PRESERVED_LOG" ]]; then
        echo "No preserved worktrees found."
        return 0
    fi

    if [[ ! -s "$PRESERVED_LOG" ]]; then
        echo "No preserved worktrees found."
        rm -f "$PRESERVED_LOG"
        return 0
    fi

    echo "Preserved worktrees:"
    echo "--------------------"
    while IFS=' | ' read -r entry timestamp reason; do
        local branch="preserved/${entry}"
        local path="${WORKTREE_BASE}/${entry}"
        local status=""
        if [[ -d "$path" ]]; then
            if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
                status="✓ worktree + branch exist"
            else
                status="⚠ worktree exists but branch missing"
            fi
        else
            status="✗ worktree directory missing"
        fi
        printf "  %-30s | %s | %s | %s\n" "$entry" "$timestamp" "$reason" "$status"
    done < "$PRESERVED_LOG"

    echo ""
    echo "Log file: $PRESERVED_LOG"
}

# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

main() {
    # Ensure we're in the repo root context
    check_git_repo

    local command="${1:-help}"
    shift 2>/dev/null || true

    case "$command" in
        create)
            cmd_create "$@"
            ;;
        assign)
            cmd_assign "$@"
            ;;
        clean)
            cmd_clean "$@"
            ;;
        preserve)
            cmd_preserve "$@"
            ;;
        list-preserved)
            cmd_list_preserved
            ;;
        help|--help|-h)
            echo "Usage: $0 <command> [args]"
            echo ""
            echo "Commands:"
            echo "  create <N> <slug>       Create a worktree and branch"
            echo "  assign <N> <slug>       Print the worktree path"
            echo "  clean <N> <slug>        Remove the worktree and branch"
            echo "  preserve <N> <slug> \"<reason>\"  Preserve worktree for inspection"
            echo "  list-preserved          List preserved worktrees"
            echo "  help                    Show this message"
            ;;
        *)
            die "Unknown command: $command. Use '$0 help' for usage."
            ;;
    esac
}

main "$@"
