export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: "system" | "content" | "automation" | "publishing";
  examplePrompt: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string; properties?: Record<string, any>; required?: string[] };
    }>;
    required?: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "cadence_get_status",
    description: "Get full system health, connected LinkedIn accounts, destinations count, queue statistics, and next upcoming scheduled post.",
    category: "system",
    examplePrompt: "Check the status of Cadence LinkedIn Studio and tell me how many posts are in queue.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cadence_list_destinations",
    description: "List all LinkedIn destinations (personal profiles and company pages) with their IDs, names, types, author URNs, and ready status.",
    category: "system",
    examplePrompt: "List all my available LinkedIn destinations and their IDs.",
    inputSchema: {
      type: "object",
      properties: {
        enabled_only: {
          type: "boolean",
          description: "If true, only returns destinations that are enabled and ready to publish.",
        },
      },
    },
  },
  {
    name: "cadence_list_accounts",
    description: "List all connected LinkedIn personal accounts/profiles, their names, member URNs, and token validity status.",
    category: "system",
    examplePrompt: "Show all connected LinkedIn accounts and verify their tokens are valid.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "cadence_list_posts",
    description: "List posts in Cadence with filtering by status (draft, scheduled, publishing, published, failed, manual_required), pagination, and search.",
    category: "content",
    examplePrompt: "List the last 5 scheduled posts in my Cadence queue.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["all", "draft", "scheduled", "publishing", "published", "failed", "cancelled", "manual_required"],
          description: "Filter by status. Defaults to 'all'.",
        },
        search: {
          type: "string",
          description: "Search text within caption or hashtags.",
        },
        limit: {
          type: "number",
          description: "Maximum number of posts to return (default 50, max 500).",
        },
        offset: {
          type: "number",
          description: "Number of posts to skip for pagination (default 0).",
        },
      },
    },
  },
  {
    name: "cadence_get_post",
    description: "Get full details of a single post by ID, including its caption, hashtags, media paths, per-destination publishing jobs, and error logs.",
    category: "content",
    examplePrompt: "Get the details and publishing logs of post ID <uuid>.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: {
          type: "string",
          description: "The UUID of the post.",
        },
      },
      required: ["post_id"],
    },
  },
  {
    name: "cadence_create_draft",
    description: "Create a new post in 'draft' status (not scheduled).",
    category: "content",
    examplePrompt: "Create a draft LinkedIn post about our new AI features with #AI #Product.",
    inputSchema: {
      type: "object",
      properties: {
        caption: {
          type: "string",
          description: "The post text commentary.",
        },
        hashtags: {
          type: "string",
          description: "Optional hashtags string (e.g. '#AI #Tech #LinkedIn').",
        },
        media_paths: {
          type: "array",
          items: { type: "string" },
          description: "Storage paths of uploaded media files in Supabase storage.",
        },
        destination_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs of target destinations. Defaults to all active enabled destinations.",
        },
      },
      required: ["caption"],
    },
  },
  {
    name: "cadence_schedule_post",
    description: "Schedule a post for future publishing at an exact date/time. Supports ISO 8601 or IST date-time format.",
    category: "content",
    examplePrompt: "Schedule a post for tomorrow at 11:30 AM IST saying: 'Excited to announce our open source release!' with #OpenSource.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: {
          type: "string",
          description: "Optional: existing draft post UUID to schedule. If omitted, a new post is created.",
        },
        caption: {
          type: "string",
          description: "Post caption text (required if post_id is not provided).",
        },
        hashtags: {
          type: "string",
          description: "Optional hashtags.",
        },
        scheduled_at: {
          type: "string",
          description: "Date and time to publish. Supports ISO 8601 (e.g. '2026-11-05T10:00:00Z') or 'YYYY-MM-DD HH:MM' in IST (e.g. '2026-11-05 10:30').",
        },
        destination_ids: {
          type: "array",
          items: { type: "string" },
          description: "Target destination UUIDs. Defaults to all active enabled destinations.",
        },
        media_paths: {
          type: "array",
          items: { type: "string" },
          description: "Storage paths of uploaded media files.",
        },
      },
      required: ["scheduled_at"],
    },
  },
  {
    name: "cadence_bulk_schedule",
    description: "Schedule multiple posts at once in bulk (e.g. a 30-day content calendar).",
    category: "automation",
    examplePrompt: "Bulk schedule 5 weekly LinkedIn tips starting this Monday at 10:00 AM IST.",
    inputSchema: {
      type: "object",
      properties: {
        posts: {
          type: "array",
          description: "Array of post objects to schedule.",
          items: {
            type: "object",
            properties: {
              caption: { type: "string" },
              hashtags: { type: "string" },
              scheduled_at: { type: "string", description: "ISO or IST date-time" },
              destination_ids: { type: "array", items: { type: "string" } },
              media_paths: { type: "array", items: { type: "string" } },
            },
            required: ["caption", "scheduled_at"],
          },
        },
      },
      required: ["posts"],
    },
  },
  {
    name: "cadence_upload_media",
    description: "Upload a local image file from the disk directly into Cadence's Supabase storage media bucket and get a storage path to use in posts.",
    category: "automation",
    examplePrompt: "Upload the screenshot at 'C:/Users/me/Desktop/banner.png' so I can attach it to a LinkedIn post.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute or relative local file path on disk (e.g. 'C:/images/post1.png').",
        },
        file_base64: {
          type: "string",
          description: "Optional base64 encoded string of the file (if file_path is not used).",
        },
        filename: {
          type: "string",
          description: "Optional filename (e.g. 'banner.png'). Inferred from file_path if omitted.",
        },
      },
    },
  },
  {
    name: "cadence_bulk_schedule_from_folder",
    description: "Automate scheduling directly from a local folder! Scans folder for images (.png, .jpg, .webp), matches text files or captions.json, uploads images, and schedules posts sequentially at daily intervals.",
    category: "automation",
    examplePrompt: "Scan the folder 'C:/Content/November' and schedule all images as daily 10 AM IST LinkedIn posts.",
    inputSchema: {
      type: "object",
      properties: {
        folder_path: {
          type: "string",
          description: "Local folder path containing the image files and optional caption files.",
        },
        start_date: {
          type: "string",
          description: "Starting date in IST (YYYY-MM-DD or YYYY-MM-DD HH:MM). Defaults to tomorrow.",
        },
        interval_days: {
          type: "number",
          description: "Days between posts (default 1 = every day).",
        },
        post_time_ist: {
          type: "string",
          description: "Time of day in IST to schedule posts (e.g. '10:00' or '17:30'). Defaults to '10:00'.",
        },
        destination_ids: {
          type: "array",
          items: { type: "string" },
          description: "Target destination UUIDs (defaults to all enabled destinations).",
        },
        default_hashtags: {
          type: "string",
          description: "Default hashtags appended to every post.",
        },
      },
      required: ["folder_path"],
    },
  },
  {
    name: "cadence_update_post",
    description: "Update an existing draft or scheduled post (caption, hashtags, schedule time, destinations, media).",
    category: "content",
    examplePrompt: "Update post <uuid> with new caption '...' and reschedule to next Friday 5 PM.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: {
          type: "string",
          description: "The UUID of the post to update.",
        },
        caption: { type: "string" },
        hashtags: { type: "string" },
        scheduled_at: { type: "string" },
        destination_ids: { type: "array", items: { type: "string" } },
        media_paths: { type: "array", items: { type: "string" } },
      },
      required: ["post_id"],
    },
  },
  {
    name: "cadence_delete_post",
    description: "Delete a post and its associated publishing jobs.",
    category: "content",
    examplePrompt: "Delete post ID <uuid> from my queue.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: {
          type: "string",
          description: "The UUID of the post to delete.",
        },
      },
      required: ["post_id"],
    },
  },
  {
    name: "cadence_retry_job",
    description: "Retry a failed destination publishing job.",
    category: "publishing",
    examplePrompt: "Retry failed publishing job <job_id> immediately.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The UUID of the publishing job to retry.",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "cadence_trigger_publish",
    description: "Trigger immediate publishing of any due scheduled jobs (or a specific job/post) without waiting for the next cron cycle.",
    category: "publishing",
    examplePrompt: "Trigger immediate publishing for post <uuid> now.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: {
          type: "string",
          description: "Optional: specific post UUID to publish immediately.",
        },
        job_id: {
          type: "string",
          description: "Optional: specific job UUID to publish immediately.",
        },
      },
    },
  },
  {
    name: "cadence_get_logs",
    description: "Retrieve recent publishing and system audit logs.",
    category: "system",
    examplePrompt: "Show the latest 10 publishing audit logs from Cadence.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of logs to return (default 20).",
        },
        post_id: {
          type: "string",
          description: "Optional post UUID filter.",
        },
      },
    },
  },
];

