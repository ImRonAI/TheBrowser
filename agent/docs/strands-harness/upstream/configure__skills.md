Agent Skills are reusable instruction packages the agent loads on demand. Each skill is a subdirectory holding a `SKILL.md` in the [agentskills.io](https://agentskills.io) format: the model sees the skill’s metadata up front and loads its full instructions only when a task calls for it. Strands harness wires skill loading in through the Strands Harness SDK’s skills plugin.

## Where Strands harness looks

By default Strands harness scans `./.agent/skills` for skills. If the directory exists, every skill inside it is registered; if it does not exist, skill loading is a no-op, so nothing happens until you add skills. Point it somewhere else, or at several directories, with `skills`:

(( tab "Strands harness" ))
(( tab "Python" ))
```python
from strands_harness import create_harness

agent = create_harness(skills=["./team-skills", "./project-skills"])
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({
  skills: ['./team-skills', './project-skills'],
})
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent, AgentSkills

plugin = AgentSkills(skills=["./team-skills", "./project-skills"])
agent = Agent(plugins=[plugin])
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'
import { AgentSkills } from '@strands-agents/sdk/vended-plugins/skills'

const plugin = new AgentSkills({ skills: ['./team-skills', './project-skills'] })
const agent = new Agent({ plugins: [plugin] })
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

A directory that does not exist is skipped rather than erroring, so a list can include optional locations safely.

## A skill on disk

A skills directory holds one subdirectory per skill, each with a `SKILL.md`:

```plaintext
.agent/skills/
  release-notes/
    SKILL.md
  incident-review/
    SKILL.md
```

The `SKILL.md` carries the skill’s name and description in front matter, followed by the full instructions the agent loads when it decides the skill applies.

## Turn skill loading off

Pass `None`/`null` (or `off` on the CLI) to disable skill loading entirely, even if a skills directory is present:

(( tab "Strands harness" ))
(( tab "Python" ))
```python
from strands_harness import create_harness

agent = create_harness(skills=None)
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
import { createHarness } from '@strands-agents/harness'

const agent = await createHarness({ skills: null })
```
(( /tab "TypeScript" ))
(( /tab "Strands harness" ))

(( tab "SDK" ))
(( tab "Python" ))
```python
# pip install strands-agents
from strands import Agent

# Raw Strands Harness SDK loads no skills unless you add AgentSkills; omit it.
agent = Agent()
```
(( /tab "Python" ))

(( tab "TypeScript" ))
```typescript
// npm install @strands-agents/sdk
import { Agent } from '@strands-agents/sdk'

// Raw Strands Harness SDK loads no skills unless you add AgentSkills; omit it.
const agent = new Agent()
```
(( /tab "TypeScript" ))
(( /tab "SDK" ))

For the underlying plugin, see the Strands Harness SDK’s [Agent Skills](/docs/user-guide/sdk/plugins/skills/index.md) documentation. For the full option list, see the [configuration reference](/docs/user-guide/harness/reference/configuration/index.md).

## Implementation

### Python

- [harness-sdk/harness-py/src/strands_harness/agent.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/agent.py)

### TypeScript

- [harness-sdk/harness-ts/src/agent.ts](https://github.com/strands-agents/harness-sdk/blob/main/harness-ts/src/agent.ts)
