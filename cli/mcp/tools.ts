import type { McpBackend } from "./backend.js";

export type Consent = "allowed" | "refused" | "unsupported";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

const MAX_TIMEOUT_SECONDS = 600;
const DEFAULT_TIMEOUT_SECONDS = 120;

export const TOOLS = [
  {
    name: "check_setup",
    title: "Check the 7key setup",
    description:
      "Show which 7key account, server, project and environment this session uses. Never returns secret values.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_secrets",
    title: "List secret names",
    description:
      "List the names of the project's secrets and variables, and for each secret the hosts it may be sent to. Never returns values. A secret without allowed hosts cannot be used; ask the user to set its AI agent hosts in the 7key console.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "run_with_secrets",
    title: "Run a command with secrets",
    description:
      "Run a command on the user's machine with the project's secrets as environment variables. Each secret holds a placeholder such as 7key-ph-…; a local proxy replaces it with the real value only in request headers sent to the hosts allowed for that secret, and removes the value from responses. Arguments are not passed through a shell, so to use a variable run sh -c, for example command sh with args [\"-c\", \"curl -H 'Authorization: Bearer $STRIPE_SECRET_KEY' https://api.stripe.com/v1/charges\"]. A placeholder in a URL or body is not replaced. Returns the exit code, standard output and standard error.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Program to run, such as curl, node or npm" },
        args: { type: "array", items: { type: "string" }, description: "Arguments, one per item" },
        cwd: { type: "string", description: "Working directory; defaults to the server's" },
        timeoutSeconds: {
          type: "number",
          description: `Stop the command after this many seconds (default ${DEFAULT_TIMEOUT_SECONDS}, at most ${MAX_TIMEOUT_SECONDS})`,
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
] as const;

export const INSTRUCTIONS =
  "7key keeps the user's API keys away from you. Call list_secrets to see which secrets exist and where they may be sent, then run_with_secrets to call those APIs. You only ever see placeholders; never ask the user to paste a secret.";

function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

function structured(value: unknown, summary: string): ToolResult {
  return { content: [{ type: "text", text: summary }], structuredContent: value };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createTools(options: {
  backend: McpBackend;
  allowWithoutAsking: boolean;
  askConsent: (secrets: string[]) => Promise<Consent>;
}) {
  const { backend } = options;
  let approved = options.allowWithoutAsking;

  const approve = async (): Promise<string | null> => {
    if (approved) {
      return null;
    }
    const consent = await options.askConsent(await backend.permission());
    if (consent === "allowed") {
      approved = true;
      return null;
    }
    return consent === "unsupported"
      ? "This MCP client cannot ask the user for permission. Add --yes to the 7key mcp command in the MCP configuration to allow commands with secrets."
      : "The user did not allow commands with secrets.";
  };

  const call = async (name: unknown, input: Record<string, unknown>): Promise<ToolResult> => {
    try {
      if (name === "check_setup") {
        const info = await backend.setup();
        return structured(
          info,
          `Signed in as ${info.account} on ${info.server}. Project ${info.project}, environment ${info.environment} (${info.scope}).`,
        );
      }
      if (name === "list_secrets") {
        const secrets = await backend.secrets();
        const lines = secrets.map((entry) =>
          entry.kind === "variable"
            ? `${entry.name} (variable)`
            : entry.usable
              ? `${entry.name} → ${entry.hosts.join(", ")}`
              : `${entry.name}: not usable, ${entry.reason ?? "no allowed hosts"}`,
        );
        return structured({ secrets }, lines.join("\n") || "This environment has no secrets.");
      }
      if (name === "run_with_secrets") {
        if (typeof input.command !== "string" || input.command.trim() === "") {
          return text("command must be a program name", true);
        }
        const args = Array.isArray(input.args) ? input.args : [];
        if (!args.every((arg): arg is string => typeof arg === "string")) {
          return text("args must be strings", true);
        }
        const refused = await approve();
        if (refused) {
          return text(refused, true);
        }
        const seconds =
          typeof input.timeoutSeconds === "number" && input.timeoutSeconds > 0
            ? Math.min(input.timeoutSeconds, MAX_TIMEOUT_SECONDS)
            : DEFAULT_TIMEOUT_SECONDS;
        const result = await backend.run({
          command: input.command,
          args,
          cwd: typeof input.cwd === "string" ? input.cwd : undefined,
          timeoutMs: seconds * 1000,
        });
        const summary = [
          result.timedOut ? `Stopped after ${seconds} seconds.` : `Exit code ${result.exitCode}.`,
          result.stdout && `stdout:\n${result.stdout}`,
          result.stderr && `stderr:\n${result.stderr}`,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          ...structured(result, summary),
          ...(result.exitCode !== 0 ? { isError: true } : {}),
        };
      }
      return text(`Unknown tool: ${String(name)}`, true);
    } catch (error) {
      return text(message(error), true);
    }
  };

  return { call };
}
