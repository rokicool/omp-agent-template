#!/usr/bin/env bash
#
# validate-plugins.sh — structural integrity check for BOTH oh-my-pi plugins
# shipped from this repo:
#
#   Plugin A  elon-ko-gate          extension-package (package.json#omp.extensions)
#   Plugin B  elon-ko-agents     marketplace (.omp-plugin/marketplace.json)
#
# Run anywhere; needs only bash + jq. The TypeScript typecheck (Plugin A) is a
# separate step (`npm run typecheck`), not part of this script — it needs the
# toolchain. This script checks file presence, manifest shape, and agent/skill
# coverage so a broken tree never reaches `omp plugin install`.
#
#   usage: bash scripts/validate-plugins.sh
#   exit:  0 = all checks passed, 1 = one or more checks failed
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v jq >/dev/null 2>&1 || { echo "✘ jq is required (not on PATH)" >&2; exit 1; }

ERRS="$(mktemp)"
trap 'rm -f "$ERRS"' EXIT

err()  { echo "✘ $*" >&2; printf '%s\n' "$*" >>"$ERRS"; }
ok()   { echo "✔ $*"; }
note() { echo "  $*"; }

have() { [ -e "$1" ]; }   # exists (file or dir)

# ──────────────────────────────────────────────────────────────────────────────
# Plugin A — elon-ko-gate (extension-package)
# ──────────────────────────────────────────────────────────────────────────────
echo "== Plugin A: elon-ko-gate (extension-package) =="

if have package.json && jq -e . package.json >/dev/null 2>&1; then
  ok "package.json is valid JSON"
else
  err "package.json missing or invalid JSON"
fi

# omp.extensions must be a non-empty array of existing files.
if jq -e '.omp.extensions | type == "array" and length > 0' package.json >/dev/null 2>&1; then
  ok "package.json#omp.extensions is a non-empty array"
  while IFS= read -r ext; do
    [ -n "$ext" ] || continue
    if have "$ext"; then ok "extension entry exists: $ext"; else err "extension entry missing: $ext"; fi
  done < <(jq -r '.omp.extensions[]' package.json)
else
  err "package.json#omp.extensions must be a non-empty array of paths"
fi

# Sibling asset the extension reads at load (src/enforce-orchestrator.ts:89).
if have src/append-system.default.md; then ok "bundled asset present: src/append-system.default.md"
else err "missing src/append-system.default.md (loaded by the extension at runtime)"; fi

# Shipped rule (alwaysApply).
if have rules/ro-definition-of-done.md; then
  ok "rule present: rules/ro-definition-of-done.md"
  if head -n1 rules/ro-definition-of-done.md | grep -q '^---'; then
    ok "rule has YAML frontmatter"
  else
    err "rules/ro-definition-of-done.md missing '---' frontmatter opener"
  fi
else
  err "missing rules/ro-definition-of-done.md"
fi

# ──────────────────────────────────────────────────────────────────────────────
# Plugin B — elon-ko-agents (marketplace)
# ──────────────────────────────────────────────────────────────────────────────
echo
echo "== Plugin B: elon-ko-agents (marketplace) =="

MP=".omp-plugin/marketplace.json"
if have "$MP" && jq -e . "$MP" >/dev/null 2>&1; then
  ok "$MP is valid JSON"
else
  err "$MP missing or invalid JSON"
fi

PROOT="$(jq -r '.metadata.pluginRoot // "."' "$MP" 2>/dev/null)"
if have "$PROOT"; then ok "metadata.pluginRoot resolves: $PROOT"
else err "metadata.pluginRoot directory missing: $PROOT"; fi

NPLUG="$(jq -r '.plugins | length' "$MP" 2>/dev/null)"
if [ "${NPLUG:-0}" -gt 0 ] 2>/dev/null; then ok "plugins listed: $NPLUG"
else err "no plugins listed in $MP (.plugins[] is empty)"; fi

# Per-plugin checks: source dir resolves, every named agent file exists and has
# required frontmatter, every skill dir carries a SKILL.md.
while IFS=$'\t' read -r pname psource; do
  [ -n "$pname" ] || { err "found a plugin entry with no name"; continue; }

  # Resolve the plugin source against metadata.pluginRoot.
  rel="${psource#./}"
  pdir="$PROOT/$rel"
  if have "$pdir"; then ok "plugin '$pname' source resolves: $pdir"
  else err "plugin '$pname' source dir missing: $pdir (source=$psource, pluginRoot=$PROOT)"; continue; fi

  # Agents declared in the marketplace entry must each have a definition file.
  declared="$(jq -r --arg p "$pname" '.plugins[]|select(.name==$p)|(.agents//[])[]' "$MP" 2>/dev/null)"
  for a in $declared; do
    af="$pdir/agents/$a.md"
    if have "$af"; then ok "agent '$a' -> $af"
    else err "plugin '$pname' declares agent '$a' but $af is missing"; fi
  done

  # Every shipped agent .md must carry name + description frontmatter.
  shopt -s nullglob
  for af in "$pdir"/agents/*.md; do
    fm="$(awk 'NR==1&&/^---/{f=1;next} /^---/{exit} f' "$af")"
    base="$(basename "$af")"
    if printf '%s\n' "$fm" | grep -q '^name:'; then :; else err "$base: frontmatter missing 'name'"; fi
    if printf '%s\n' "$fm" | grep -q '^description:'; then :; else err "$base: frontmatter missing 'description'"; fi
  done

  # Every skill dir must contain SKILL.md.
  found_skills=0
  for sd in "$pdir"/skills/*/; do
    [ -d "$sd" ] || continue
    found_skills=$((found_skills + 1))
    sn="$(basename "$sd")"
    if have "$sd/SKILL.md"; then ok "skill '$sn' -> ${sd}SKILL.md"
    else err "skill '$sn' missing SKILL.md in $sd"; fi
  done
  [ "$found_skills" -gt 0 ] && note "plugin '$pname': $found_skills skill(s)"
  shopt -u nullglob
done < <(jq -r '.plugins[] | "\(.name)\t\(.source)"' "$MP" 2>/dev/null)

# ──────────────────────────────────────────────────────────────────────────────
echo
nerr=0
[ -s "$ERRS" ] && nerr="$(grep -c . "$ERRS")"
if [ "$nerr" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
fi
echo "VALIDATION FAILED — $nerr error(s)"
exit 1
