<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" width="96" height="96" alt="AI-FW logo">
</picture>

# AI-FW
#### The AI Firewall & Governance Gateway

**Every AI agent: identified, authorized, inspected, governed.**

[Documentation](https://aifw.io/docs) · [Website](https://aifw.io) · [Get started](https://aifw.io/get-started) · [Enterprise](https://aifw.io/contact)

[![Self-hosted](https://img.shields.io/badge/Self--hosted-Yes-8b5cf6)](https://aifw.io)
[![Enterprise](https://img.shields.io/badge/Enterprise-Ready-8b5cf6)](https://aifw.io)
[![ISO 27001](https://img.shields.io/badge/ISO_27001-Certified-8b5cf6)](https://aifw.io)
[![SOC2](https://img.shields.io/badge/SOC2-Compliant-8b5cf6)](https://aifw.io)
[![Docs](https://img.shields.io/badge/Docs-aifw.io%2Fdocs-8b5cf6)](https://aifw.io/docs)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-8b5cf6)](https://github.com/securetron-gh/aifw)

</div>

AI-FW is the **AI firewall and governance gateway** between your AI agents and the models they call. Every prompt and response is inspected, governed, and routed, with provable agent identity and regulator-ready audit, all in one process that runs in your own environment.

- [x] **Fail-closed by design**: offline guardrails never delegate to third parties, no traffic while scanning is unhealthy
- [x] **Agents are identities**: A2A protocol, agent registry, mTLS, Kerberos, OIDC SSO, SCIM provisioning
- [x] **Cost savings without safety holes**: semantic-gated prompt compression and inspection-gated caching
- [x] **Audit you can hand to a regulator**: metadata-only transaction log with encrypted export to your SIEM
- [x] **Surfaces others cannot reach**: Claude inference hooks, MCP tool governance, M365 Copilot admin with agent sync
- [x] **Opt-in endpoint gateway**: images, audio, files, fine-tuning, and batches under the same inspection pipeline

## 🛡️ Features

Every feature is documented on [aifw.io/docs](https://aifw.io/docs) and in this repository's `docs/` folder.


Legend: ✅ native · 🧩 via partner or plugin · ❌ not supported

#### 🛡️ Security & guardrails

<table>
<tr><td width="50%"><b>🛡️ <a href="https://aifw.io/docs/guides/prompt-response-guardrails">Prompt &amp; response guardrails</a></b><br/><sub>offline, fail-closed scanning</sub></td><td width="50%"><b>🧠 <a href="https://aifw.io/docs/guides/semantic-intent-analysis">Semantic intent analysis</a></b><br/><sub>meaning-based policy scoring</sub></td></tr>
<tr><td width="50%"><b>⚠️ <a href="https://aifw.io/docs/guides/prompt-response-guardrails">Fail-open options (opt-in)</a></b><br/><sub>availability escape hatches</sub></td><td width="50%"><b>🪟 <a href="https://aifw.io/docs/guides/claude-inference-hooks">Claude inference hooks</a></b><br/><sub>verdicts before inference</sub></td></tr>
</table>

#### 🪪 Identity & agents

<table>
<tr><td width="50%"><b>🔑 <a href="https://aifw.io/docs/guides/identity-access">Identity &amp; access (IDAM)</a></b><br/><sub>SSO, SCIM, RBAC, mTLS</sub></td><td width="50%"><b>🔑 <a href="https://aifw.io/docs/guides/agent-api-keys">Admin-issued API keys</a></b><br/><sub>hashed, instantly revocable</sub></td></tr>
<tr><td width="50%"><b>🤝 <a href="https://aifw.io/docs/api-reference/a2a-agent-protocol">A2A agent protocol</a></b><br/><sub>agent-to-agent tasks</sub></td><td width="50%"><b>🎓 <a href="https://aifw.io/docs/tutorials/agent-self-enrollment">Agent self-enrollment</a></b><br/><sub>CSR + mTLS round trip</sub></td></tr>
</table>

#### 💸 Cost

<table>
<tr><td width="50%"><b>⚡ <a href="https://aifw.io/docs/guides/reliability-caching">Completion cache</a></b><br/><sub>exact + semantic hits</sub></td><td width="50%"><b>✂️ <a href="https://aifw.io/docs/guides/prompt-compression">Prompt compression</a></b><br/><sub>semantic-gated token savings</sub></td></tr>
</table>

#### 📊 Observability & audit

<table>
<tr><td width="50%"><b>📈 <a href="https://aifw.io/docs/guides/observability-dashboard">Observability &amp; dashboard</a></b><br/><sub>live activity view</sub></td><td width="50%"><b>🚨 <a href="https://aifw.io/docs/guides/risk-profiles">Risk profiles &amp; auto-block</a></b><br/><sub>block on violations</sub></td></tr>
<tr><td width="50%"><b>🧾 <a href="https://aifw.io/docs/guides/audit-logs-export">Audit logs &amp; export</a></b><br/><sub>metadata-only, SIEM export</sub></td><td width="50%"></td></tr>
</table>

#### 🔌 Integrations

<table>
<tr><td width="50%"><b>🧩 <a href="https://aifw.io/docs/tutorials/m365-copilot-bridge">M365 Copilot admin</a></b><br/><sub>catalog, registry, usage</sub></td><td width="50%"><b>🛠️ <a href="https://aifw.io/docs/tutorials/claude-code-cursor-mcp">Claude Code, Cursor &amp; MCP</a></b><br/><sub>facades and MCP tools</sub></td></tr>
<tr><td width="50%"><b>🎛️ <a href="https://aifw.io/docs/api-reference/openai-compatible-api">Endpoint gateway</a></b><br/><sub>images, audio, files, batches</sub></td><td width="50%"></td></tr>
</table>

#### ⚙️ Core & reference

<table>
<tr><td width="50%"><b>🧭 <a href="https://aifw.io/docs/guides/model-routing">Model routing &amp; registry</a></b><br/><sub>per-model keys, strict policy</sub></td><td width="50%"><b>🔁 <a href="https://aifw.io/docs/guides/reliability-caching">Reliability</a></b><br/><sub>retries, failover, distribute</sub></td></tr>
<tr><td width="50%"><b>⚙️ <a href="https://aifw.io/docs/how-to/configure-models-keys">Advanced parameters</a></b><br/><sub>inject or force params</sub></td><td width="50%"><b>🗂️ <a href="https://aifw.io/docs/admin/settings">Admin pages</a></b><br/><sub>settings, rules, audit</sub></td></tr>
<tr><td width="50%"><b>🌐 <a href="https://aifw.io/docs/api-reference/openai-compatible-endpoints">Supported models &amp; endpoints (200+)</a></b><br/><sub>OpenAI-compatible list</sub></td><td width="50%"></td></tr>
</table>



![OpenAI](https://img.shields.io/badge/OpenAI-111?style=flat&logo=openai&logoColor=white) ![Anthropic](https://img.shields.io/badge/Anthropic-111?style=flat&logo=anthropic&logoColor=white) ![Google](https://img.shields.io/badge/Google-111?style=flat&logo=google&logoColor=white) ![Meta](https://img.shields.io/badge/Meta-111?style=flat&logo=meta&logoColor=white) ![xAI](https://img.shields.io/badge/xAI-111?style=flat&logo=xai&logoColor=white) ![DeepSeek](https://img.shields.io/badge/DeepSeek-111?style=flat&logo=deepseek&logoColor=white) ![Mistral](https://img.shields.io/badge/Mistral-111?style=flat&logo=mistral&logoColor=white) ![Groq](https://img.shields.io/badge/Groq-111?style=flat&logo=groq&logoColor=white) ![Azure](https://img.shields.io/badge/Azure-111?style=flat&logo=microsoftazure&logoColor=white) ![AWS](https://img.shields.io/badge/AWS-111?style=flat&logo=amazonaws&logoColor=white) ![Alibaba](https://img.shields.io/badge/Alibaba-111?style=flat&logo=alibabacloud&logoColor=white) ![Ollama](https://img.shields.io/badge/Ollama-111?style=flat&logo=ollama&logoColor=white)

> [!WARNING]
> Model IDs change frequently. Always verify against each vendor's live model list before registering a model (see the [models reference](https://aifw.io/docs/api-reference/openai-compatible-endpoints)).

## ⚡ Quick start

### 1. Run the gateway

```bash
docker run -d --name aifw-gateway -p 443:443 \
  -e ConnectionStrings__Default=Host=your-postgres;Database=aifw;Username=...;Password=... \
  aifw/gateway:latest
```


> [!IMPORTANT]
> The gateway serves HTTPS on port 443 by default. If port 443 is already in use on the host, map a different host port instead, for example `-p 8443:443`.

### 2. Make your first request

```bash
curl https://fqdn.aifw.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

Open the gateway at `https://fqdn.aifw.io` and watch the transaction appear in the dashboard.

> [!TIP]
> To route traffic through the gateway, register these backend URLs and models in the AI-FW Model Inventory (see [Configure models and keys](https://aifw.io/docs/how-to/configure-models-keys)).

## 🔄 How it works

```mermaid
flowchart LR
  A["Client / Agent"] --> B["AI-FW Gateway"]
  B --> C["Inspect<br/>prompt scan, PII mask"]
  C --> D["Govern<br/>rules, semantic tier"]
  D --> E["Route<br/>registry, resilience"]
  E --> F["LLM Backend"]
  F --> G["Audit<br/>metadata-only log"]
  G --> A
```

1. **Connect** - point any OpenAI-compatible or Anthropic client at the gateway (SDKs, Claude Code, Cursor, MCP tools, or plain HTTP)
2. **Inspect** - every prompt and response is scanned, PII-masked, and semantically scored
3. **Govern** - routing rules, risk profiles, and policy decide what flows and what is blocked
4. **Audit** - metadata-only logs and events record exactly what happened

## 📚 Documentation

This repository holds the AI-FW knowledge base. The rendered version lives at [aifw.io/docs](https://aifw.io/docs).

```mermaid
flowchart TD
  A["docs/"] --> B["getting-started/"]
  A --> C["guides/"]
  A --> D["tutorials/"]
  A --> E["how-to/"]
  A --> F["api-reference/"]
  A --> G["admin/"]
  B --> B1["what is AI-FW, quick start"]
  C --> C1["guardrails, routing, semantic, identity, risk, reliability, compression, hooks, observability, audit, API keys"]
  D --> D1["OpenAI SDK, Claude Code & MCP, M365, agent enrollment"]
  E --> E1["models & keys, AI-assisted rules, Azure"]
  F --> F1["OpenAI-compatible, Anthropic Messages, A2A, endpoints"]
  G --> G1["settings, inventory, rules, risk, audit, dashboard, M365, users, keys, agents, CA, trust"]
```

| Section | Topics | Files |
|---|---|---|
| Getting Started | What AI-FW is, quick start | `docs/getting-started/` |
| Guides | Guardrails, routing, semantic analysis, identity, risk, reliability, compression, hooks, observability, audit, API keys | `docs/guides/` |
| Tutorials | OpenAI SDK, Claude Code & MCP, M365 Copilot admin, agent self-enrollment | `docs/tutorials/` |
| How-To | Models & keys, AI-assisted rules, Azure deployment | `docs/how-to/` |
| API Reference | OpenAI-compatible, Anthropic Messages, A2A agent protocol | `docs/api-reference/` |
| Admin Reference | Settings, Model Inventory, Rules Manager, Risk Profiles, Audit, M365, Users, Agents, CA, Agent Trust | `docs/admin/` |

## 🧩 Enterprise

- ✅ **ISO 27001 certified and SOC2 compliant**
- ✅ **Fail-closed by design** - no traffic while scanning is unhealthy
- ✅ **App-only Microsoft 365 Copilot integration** with agent sync
- ✅ **Role-based access control, OIDC SSO, and SCIM provisioning**
- ✅ **Encrypted audit export** to your SIEM (syslog over TLS)
- ✅ **Self-hosted** in your environment with no per-token fees

[Book a demo](https://aifw.io/contact) or [get started](https://aifw.io/get-started).

## 🔒 Security

To report a security issue, contact us at [aifw.io/contact](https://aifw.io/contact).

## 🤝 Contributing

PRs are welcome.

We would also like to thank the Securetron.net team for their continued support in helping the community.
