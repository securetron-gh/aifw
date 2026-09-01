<div align="center">

# AI-FW
#### The AI Firewall & Governance Gateway

**Every AI agent: identified, authorized, inspected, governed.**

[Documentation](https://aifw.io/docs) · [Website](https://aifw.io) · [Get started](https://aifw.io/get-started)

[![Self-hosted](https://img.shields.io/badge/Self--hosted-Yes-8b5cf6)](https://aifw.io)
[![Enterprise](https://img.shields.io/badge/Enterprise-Ready-8b5cf6)](https://aifw.io)
[![ISO 27001](https://img.shields.io/badge/ISO_27001-Certified-8b5cf6)](https://aifw.io)
[![SOC2](https://img.shields.io/badge/SOC2-Compliant-8b5cf6)](https://aifw.io)

</div>

AI-FW is the **AI firewall and governance gateway** between your AI agents and the models they call. Every prompt and response is inspected, governed, and routed, with provable agent identity and regulator-ready audit, all in one process that runs in your own environment.

- [x] **Fail-closed by design**: offline guardrails never delegate to third parties, no traffic while scanning is unhealthy
- [x] **Agents are identities**: A2A protocol, agent registry, mTLS, Kerberos, OIDC SSO, SCIM provisioning
- [x] **Cost savings without safety holes**: semantic-gated prompt compression and inspection-gated caching
- [x] **Audit you can hand to a regulator**: metadata-only transaction log with encrypted export to your SIEM
- [x] **Surfaces others cannot reach**: Claude inference hooks, MCP tool governance, M365 Copilot admin with agent sync
- [x] **Opt-in endpoint gateway**: images, audio, files, fine-tuning, and batches under the same inspection pipeline

## Quick start

### 1. Run the gateway

```bash
docker run -d --name aifw-gateway -p 443:443 \
  -e ConnectionStrings__Default=Host=your-postgres;Database=aifw;Username=...;Password=... \
  aifw/gateway:latest
```

### 2. Make your first request

```bash
curl http://fqdn.aifw.io:443/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

Open the gateway at `http://fqdn.aifw.io:443` and watch the transaction appear in the dashboard.

## How it works

1. **Connect** - point any OpenAI-compatible or Anthropic client at the gateway (SDKs, Claude Code, Cursor, MCP tools, or plain HTTP)
2. **Inspect** - every prompt and response is scanned, PII-masked, and semantically scored
3. **Govern** - routing rules, risk profiles, and policy decide what flows and what is blocked
4. **Audit** - metadata-only logs and events record exactly what happened

## Documentation

This repository holds the AI-FW knowledge base. The rendered version lives at [aifw.io/docs](https://aifw.io/docs).

| Section | Topics | Files |
|---|---|---|
| Getting Started | What AI-FW is, quick start | `docs/getting-started/` |
| Guides | Guardrails, model routing, semantic analysis, identity, risk, reliability, prompt compression | `docs/guides/` |
| Tutorials | OpenAI SDK, Claude Code & MCP, M365 Copilot admin, agent self-enrollment | `docs/tutorials/` |
| How-To | Models & keys, AI-assisted rules, Azure deployment | `docs/how-to/` |
| API Reference | OpenAI-compatible, Anthropic Messages, A2A agent protocol | `docs/api-reference/` |

## Enterprise

- ✅ **ISO 27001 certified and SOC2 compliant**
- ✅ **Fail-closed by design** - no traffic while scanning is unhealthy
- ✅ **App-only Microsoft 365 Copilot integration** with agent sync
- ✅ **Role-based access control, OIDC SSO, and SCIM provisioning**
- ✅ **Encrypted audit export** to your SIEM (syslog over TLS)
- ✅ **Self-hosted** in your environment with no per-token fees

[Book a demo](https://aifw.io/contact) or [get started](https://aifw.io/get-started).

## Security

To report a security issue, contact us at [aifw.io/contact](https://aifw.io/contact).

## Contributing

PRs are welcome.
