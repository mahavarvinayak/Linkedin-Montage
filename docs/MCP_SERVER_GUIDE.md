# Cadence LinkedIn Studio — MCP Server Guide

Cadence provides a native **Model Context Protocol (MCP)** server that exposes full administrative and scheduling control over your LinkedIn dashboard to AI models and coding agents (Claude Desktop, Cursor, Antigravity, or autonomous CLI agents).

---

## 1. Quick Setup & Configuration

### For Cursor (`.cursor/mcp.json`)
Add Cadence to your project's `.cursor/mcp.json` or global Cursor settings:

```json
{
  "mcpServers": {
    "cadence": {
      "command": "npx",
      "args": ["-y", "tsx", "src/mcp/index.ts"]
    }
  }
}
```

### For Claude Desktop (`claude_desktop_config.json`)
File location: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cadence": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "C:\\Users\\mahav\\OneDrive - Government Engineering College, Dahod\\Desktop\\Linkedin Montage\\src\\mcp\\index.ts"
      ],
      "cwd": "C:\\Users\\mahav\\OneDrive - Government Engineering College, Dahod\\Desktop\\Linkedin Montage"
    }
  }
}
```

### Direct Terminal / CLI Run
To run the server standalone on STDIO:
```bash
npm run mcp
```

### Remote HTTP Endpoint
For remote AI workflows or cloud tools, Cadence also provides a direct HTTP API endpoint:
- **URL:** `POST https://cadence-bice-two.vercel.app/api/mcp`
- **Method:** `POST` with JSON body:
```json
{
  "tool": "cadence_get_status",
  "arguments": {}
}
```

---

## 2. Available MCP Tools (Full App Control)

| Tool Name | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `cadence_get_status` | System health, queue counts, connected accounts & destinations | *None* |
| `cadence_list_destinations` | List all discovered personal profiles and company pages | `enabled_only` (bool) |
| `cadence_list_accounts` | List all connected LinkedIn accounts/profiles and token validity | *None* |
| `cadence_list_posts` | Filter & search queue posts (draft, scheduled, published, failed) | `status`, `search`, `limit`, `offset` |
| `cadence_get_post` | Full details of a post, including per-destination jobs and error history | `post_id` (UUID) |
| `cadence_create_draft` | Create a draft post without scheduling | `caption`, `hashtags`, `media_paths`, `destination_ids` |
| `cadence_schedule_post` | Schedule post for an exact IST date/time with destination jobs | `scheduled_at`, `caption`, `destination_ids`, `media_paths` |
| `cadence_bulk_schedule` | Schedule 10, 20, 30+ posts at once in bulk | `posts` (Array of post objects) |
| `cadence_bulk_schedule_from_folder` | Auto-scan local folder with images and schedule sequentially | `folder_path`, `start_date`, `interval_days`, `post_time_ist` |
| `cadence_upload_media` | Upload local image to Supabase Storage and get storage path | `file_path` or `file_base64`, `filename` |
| `cadence_update_post` | Update caption, schedule time, media or destinations of a post | `post_id`, `caption`, `scheduled_at`, etc. |
| `cadence_delete_post` | Delete post and cancel all associated publishing jobs | `post_id` (UUID) |
| `cadence_retry_job` | Reset a failed job back to scheduled for immediate retry | `job_id` (UUID) |
| `cadence_trigger_publish` | Manually trigger publisher for due posts without waiting for cron | `post_id`, `job_id` |
| `cadence_get_logs` | Retrieve recent audit and publishing logs | `limit`, `post_id` |

---

## 3. High-Value AI Agent Workflows

### Example 1: Bulk Schedule 30 Days of Content from a Folder
Ask your agent:
> *"I have a folder of 15 infographics in `C:/Users/mahav/Pictures/LinkedInPosts`. Scan the folder, write engaging captions for each, and schedule them 1 per day starting tomorrow at 10:00 AM IST on both my personal profile and founder profile."*

The AI model calls:
1. `cadence_list_destinations` (to grab target destination IDs).
2. `cadence_bulk_schedule_from_folder` (or `cadence_upload_media` + `cadence_bulk_schedule`).
3. Cadence uploads the assets to Supabase storage, sets up database records, and triggers the per-minute scheduler!

### Example 2: Multi-Profile Publishing
Ask your agent:
> *"Post this announcement to my Founder profile only, and schedule a casual summary on my Personal Creator account for 3 hours later."*

The model will specify the exact `destination_ids` for each post, and the scheduler will use the respective profile's OAuth token automatically.

