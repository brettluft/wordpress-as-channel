# WordPress as an OpenClaw Channel

AI agent collaboration inside the WordPress block editor. This project makes WordPress a first-class [OpenClaw](https://openclaw.ai) channel so a Claw Agent can join a post as a collaborator, chat with the author, suggest edits, and insert internal links.

Built on WordPress 7.0's realtime collaboration (Yjs CRDTs) and OpenClaw's channel plugin architecture.

## Architecture

```
WordPress 7.0 Editor (Yjs CRDT sync)
  └── claw-agent-collab plugin
        ├── Chat sidebar (Gutenberg PluginSidebar)
        ├── Synced post meta (_claw_chat_messages, _claw_suggestions)
        └── Agent user account (claw-agent)
              │
              ▼
OpenClaw Channel Plugin (Node.js)
  ├── Headless Yjs client (joins editing sessions)
  ├── WordPress REST API client (polls for messages)
  └── Message bridge (WP ↔ OpenClaw Gateway)
              │
              ▼
OpenClaw Gateway → Claw Agent (LLM + Skills)
  ├── wp-read-content (read post blocks)
  ├── wp-suggest-edit (propose changes)
  ├── wp-search-posts (find related content)
  └── wp-insert-link (add internal links)
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/wordpress-plugin` | WordPress plugin that adds the chat sidebar, registers synced meta, and creates the agent user |
| `packages/openclaw-channel` | OpenClaw channel plugin that bridges WordPress ↔ Gateway via REST API + Yjs |
| `packages/agent-skills` | OpenClaw skills for reading content, suggesting edits, searching posts, and inserting links |

## Setup

### Prerequisites

- WordPress 7.0+ with realtime collaboration enabled (Settings > Writing)
- Node.js 22.16+ (Node 24 recommended)
- OpenClaw Gateway running (`npm i -g openclaw && openclaw`)

### 1. Install the WordPress Plugin

```bash
cd packages/wordpress-plugin
npm install
npm run build
```

Copy the `wordpress-plugin` directory to `wp-content/plugins/claw-agent-collab/` and activate it.

On activation the plugin:
- Creates a `claw-agent` WordPress user (Editor role)
- Generates an application password for API access
- Registers synced post meta fields for chat and suggestions

Retrieve the app password from WP options:
```bash
wp option get claw_agent_app_password
```

### 2. Configure the OpenClaw Channel

```bash
cd packages/openclaw-channel
npm install
npm run build
```

Add the channel to your OpenClaw Gateway configuration:

```yaml
# ~/.openclaw/config.yaml
channels:
  - id: wordpress
    module: /path/to/packages/openclaw-channel/dist/index.js
    config:
      siteUrl: https://your-wordpress-site.com
      username: claw-agent
      appPassword: "xxxx xxxx xxxx xxxx xxxx xxxx"
      pollInterval: 2000
```

### 3. Register the Agent Skills

```bash
cd packages/agent-skills
npm install
npm run build
```

The skills are available as importable functions for use in your OpenClaw agent configuration.

### 4. Bind the Agent

In your OpenClaw agent bindings, point to the WordPress channel:

```yaml
agents:
  - id: wordpress-editor
    channels:
      - wordpress
    skills:
      - wp-read-content
      - wp-suggest-edit
      - wp-search-posts
      - wp-insert-link
```

## Usage

1. Open any post in the WordPress block editor
2. Open the **Claw Agent** sidebar (via the toolbar or Plugins > Claw Agent)
3. Type a message — it syncs to all collaborators via Yjs
4. The OpenClaw channel picks up the message and routes it to the agent
5. The agent responds in the chat, suggests edits, or inserts links

## How It Works

### Chat Messages

Messages are stored as a JSON array in the `_claw_chat_messages` post meta field. Because this meta has `show_in_rest: true`, WordPress 7.0's Yjs layer syncs it automatically between all editors in real time.

```json
[
  { "id": "abc123", "author": 42, "content": "Can you add links to related posts?", "timestamp": "2026-03-25T10:30:00Z", "type": "message" },
  { "id": "agent-xyz", "author": "claw-agent", "content": "Found 3 related posts. I'll suggest links now.", "timestamp": "2026-03-25T10:30:05Z", "type": "message" }
]
```

### Edit Suggestions

Suggestions are stored in `_claw_suggestions` post meta with accept/reject status. The sidebar renders them as cards with action buttons.

### Agent Presence

The agent joins collaborative sessions as a Yjs client with awareness state, so it appears as a named collaborator in the editor.

## Development

```bash
# Install all workspace dependencies
npm install

# Build all packages
npm run build

# Watch mode (WordPress plugin)
cd packages/wordpress-plugin && npm start
```

## Status

This is an MVP / proof of concept. Key areas for future work:

- **Yjs document schema**: The mapping between WordPress blocks and Yjs shared types needs validation against the actual Gutenberg implementation
- **WebSocket provider**: Replace HTTP polling with a WebSocket sync provider for lower latency
- **Suggestion UX**: Accept should apply the edit directly to the Yjs document
- **Security**: Custom WordPress role for the agent with scoped capabilities
- **Multi-post routing**: Agent should be able to track multiple active editing sessions
