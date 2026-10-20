# Compact File Tree Design

## Goal

Replace the flat changed-file list in the review sidebar with the approved compact directory tree, while preserving all existing filtering, read-state, selection, and summary behavior.

## User experience

- Render changed files under their real directory hierarchy.
- Directory rows are compact and can be expanded or collapsed.
- Collapse directory-only chains into one readable label, for example `database / repositories` and `services / member`.
- Show each directory's visible descendant file count at the right edge.
- Keep file rows compact and retain the file type, filename, additions, deletions, selected state, and read checkmark.
- Reveal the complete path on hover for truncated file and directory labels.
- Use subtle indentation guides to make nesting readable without adding heavy cards or borders.
- Default the filtered tree to expanded so matching files are never hidden after path, search, or mode changes.

## Behavior boundaries

- The tree is derived from `visibleFiles`, so path filtering, filename search, `仅新增`, and `未读` continue to control the left list exactly as today.
- `未读` remains a list-only filter. The right summary continues to use `summaryFiles` and is unaffected by read state.
- Clicking a file keeps the current diff-loading and selected-file behavior.
- Clicking a directory only toggles that directory. It never changes the path filter or selected file.
- Empty filtered results keep the existing `没有符合条件的文件` state.
- No Git API, comparison payload, persisted settings, or repository mutation behavior changes.

## Architecture

Add a React-independent tree derivation module that:

1. Splits each visible file path into directory segments and a filename.
2. Builds a deterministic directory/file hierarchy in the input file order.
3. Computes descendant file counts.
4. Compacts single-child directory chains that contain no direct files.

`DiffViewer` owns the expanded-directory set and renders recursive directory and file rows. The tree model uses stable full-path keys so expansion survives unrelated React renders. When the visible file set changes, newly present ancestor paths are expanded by default.

## Visual specification

- Keep the current sidebar width, paper palette, filters, and typography.
- Directory rows use a small chevron, folder mark, medium-weight label, and right-aligned count.
- File rows target roughly 40 px height instead of the current card-like 62 px height.
- Selected files use the existing white surface, border, and restrained shadow.
- File statistics remain right-aligned with green additions and red deletions.
- Indentation is capped visually so deep paths remain usable in the current sidebar width; labels truncate rather than forcing horizontal scrolling.
- Mobile keeps the existing slide-in sidebar behavior.

## Accessibility

- Directory toggles are native buttons with `aria-expanded` and an associated child group.
- File rows remain native buttons.
- Full paths remain available through accessible labels and hover text.
- Color is not the only state signal: additions/deletions retain `+`/`−`, and read state retains the checkmark.

## Verification

- Unit-test hierarchy construction, descendant counts, and directory-chain compaction.
- Add a rendered-source contract test for recursive tree rendering and directory expansion controls.
- Run lint, production build, and the full existing test suite.
- Browser-check a real comparison with nested directories, filters, read state, selection, expand/collapse, and a narrow viewport.
