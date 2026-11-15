Strands harness returns a plain Strands `Agent`, so taking it to production is not a separate story: deploying, observing, and securing a Strands harness agent are exactly the Strands Harness SDK’s run guides, applied to the agent the factory hands you. This page points to those guides and calls out the few things specific to Strands harness’s defaults.

## The run guides

[Deploy to production](../../sdk/deploy/operating-agents-in-production/index.md)Ship to Lambda, Fargate, EKS, Amazon Bedrock AgentCore, and more.

[Observe your agent](../../sdk/observability-evaluation/observability/index.md)Trace runs, read metrics, and debug behavior.

[Secure for production](../../sdk/safety-security/guardrails/index.md)Add guardrails, redact PII, and keep message history trusted.

## Deploy

Because Strands harness returns an ordinary `Agent`, every deployment target in the [deploy guides](/docs/user-guide/sdk/deploy/index.md) works with it unchanged: build the agent with `create_harness()` where the guide builds one with `Agent()`.

Two of Strands harness’s defaults write to the local filesystem, which matters when the deployment target has ephemeral storage. [Sessions](/docs/user-guide/harness/configure/sessions/index.md) and [long-term memory](/docs/user-guide/harness/configure/memory/index.md) default to directories under `./.agent`. On a container or serverless target, point `session={"dir": ...}` and `memory={"dir": ...}` at durable storage (a mounted volume, or a backend you supply through `memory={"stores": [...]}` or a session manager) so state survives past a single instance.

## Observe

Strands harness builds a standard `Agent`, so the Strands Harness SDK’s telemetry works unchanged: traces, metrics, and logs flow the same way they do for any Strands agent. Follow [observe your agent](/docs/user-guide/sdk/observability-evaluation/observability/index.md); there is nothing Strands harness-specific to wire up. To evaluate quality, the [Evals SDK](/docs/user-guide/evals-sdk/index.md) tests and scores Strands harness runs like any other agent.

## Secure

The Strands Harness SDK’s safety guides apply directly: [guardrails](/docs/user-guide/sdk/safety-security/guardrails/index.md), [PII redaction](/docs/user-guide/sdk/safety-security/pii-redaction/index.md), and [trusted message history](/docs/user-guide/sdk/safety-security/trusted-message-history/index.md) all work on a Strands harness agent.

Two Strands harness defaults deserve a security decision before you ship. First, the `programmatic_tool_caller` runs model-authored code in Monty, which isolates the code but not the tools it calls; if the agent handles untrusted input, run it inside an SDK [sandbox](/docs/user-guide/sdk/sandbox/index.md), or drop the tool. Second, the default agent can run shell commands and edit files; gate what it does with [interventions](/docs/user-guide/harness/configure/interventions/index.md) and confine what it can reach with a sandbox.

## Next steps

-   [Compose with the Strands Harness SDK](/docs/user-guide/harness/composing-with-sdk/index.md): how Strands harness sits on the Strands Harness SDK, and how to reach past its defaults.
-   [Deploy to production](/docs/user-guide/sdk/deploy/operating-agents-in-production/index.md): the full deployment guide.

## Implementation

### Python

- [harness-sdk/harness-py/src/strands_harness/agent.py](https://github.com/strands-agents/harness-sdk/blob/main/harness-py/src/strands_harness/agent.py)

### TypeScript

- [harness-sdk/harness-ts/src/agent.ts](https://github.com/strands-agents/harness-sdk/blob/main/harness-ts/src/agent.ts)
