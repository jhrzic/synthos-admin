# SynthOS skills — gap report and canonical manifest specification (2026-09-18)

## Gap report

**No SynthOS skill definitions exist.** Both Admins show 0 installed skills, and that is the truth, not a loading
fault.

The canonical skills authority is the `skills` table, via `lib/skills.ts` and `/api/skills*`. Its repository source
is `skills/*.md`, read by `discoverRepoSkillFiles`, and that directory does not exist in this repository.

Every other skill-like source that exists was examined. None is a SynthOS skill: none declares an execution target,
required tools or connectors, an input/output contract, permissions or validation evidence. Importing any of them
would fabricate inventory.

| Source | Count | What it is | Verdict |
|---|---|---|---|
| `~/synthos/skills-lock.json` → `~/synthos/.agents/skills/` | 227 | Third-party coding-assistant prompt skills (`coreyhaines31/marketingskills`, `kostja94/marketing-skills`, `browserbase/skills`, `nutlope/hallmark`) | Prompts for a different tool. Not imported |
| `~/.hermes/skills/**/SKILL.md` | 97 | Skills bundled with the Hermes agent framework (e.g. `yuanbao` group mentions) | Another runtime's own skills. Not imported |
| `~/synthos/mission-control/.agents/skills/` | 36 | Developer workflow prompts (`lean-build`, `migration`, …) | Developer tooling. Not imported |
| `~/projects/synthos-site/skills/*.md` | 10 | Prompt templates (`name`, `branch`, `cadence`, `input` plus a prompt body) | Prompts. Not imported |
| `lib/fabric/tool-pack.ts`, `lib/fabric/registry.ts` | 14 tools, ~35 capabilities | Tools and capabilities | Already shown under **Tools**; they are not skills |
| Agent configuration (`src/data/agentDefinitions.ts`) | — | Persona prose; `capabilities` are free-text labels | Not skills; no longer rendered |

**Installed: 0. Enabled: 0. Assigned to agents: 0.**

## Canonical manifest (what a SynthOS skill must declare)

A skill is one directory, `skills/<skill-id>/`, containing `skill.json` plus an optional `SKILL.md` with the human
explanation. Nothing else is read.

```json
{
  "schema": "synthos.skill/v1",
  "id": "research.competitor-teardown",
  "name": "Competitor teardown",
  "version": "1.0.0",
  "description": "What the skill produces, in one paragraph.",
  "owner": "operator | <team>",
  "source": { "type": "repository", "ref": "skills/research.competitor-teardown", "sha256": "<hash of skill.json + SKILL.md>" },
  "category": "tool | model | integration | mcp | system",
  "compatibleAgents": ["researcher"],
  "requiredTools": ["research.search"],
  "requiredConnectors": [],
  "executionTarget": { "type": "model | deterministic | mcp_tool | windmill", "ref": "<target>", "taskClass": "<registry task class>" },
  "inputContract": { "type": "object", "properties": { "input": { "type": "string" } }, "required": ["input"] },
  "outputContract": { "mode": "LITERAL | NARRATIVE | JSON", "schema": null },
  "permissions": { "effectClass": "READ | WRITE_INTERNAL | EXTERNAL_ACTION", "approvalPolicy": "NONE | OPERATOR_APPROVAL" },
  "validation": { "suite": "<registry eval suite id or null>", "evidence": [] }
}
```

**Rules:**
- **Every field is required.** Use `[]` or `null` only where the field allows it. A missing field rejects the whole
  manifest; it is never defaulted.
- **Tools must exist.** `requiredTools` must name capability keys in the capability registry.
- **Task class must exist.** `executionTarget.taskClass` must be a registry task class. A model-target skill runs only
  through the canonical router, on a route qualified for that class.
- **Content-addressed.** `source.sha256` covers the manifest and the `SKILL.md`. A changed file is a new version,
  never an edit in place.

**Installation:**
- **One explicit path:** the operator runs an audited, idempotent install, the same manifest hash twice being a
  no-op, through the existing skills authority (`createSkill`).
- **Nothing happens automatically:** nothing is installed at startup, and nothing is enabled or assigned to an agent.
- **Visibility:** an installed skill appears in the Admin Skills view, with no UI change.

Until the first real manifest is written, the Skills view shows "No skills are installed for this workspace."
