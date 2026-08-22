import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { BashTool } from "@/components/ui/bash-tool";
import { ClaudeIcon, OpenAIIcon, CursorIcon, VSCodeIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/section-label";

const SERVER = "./src/server.js";
const ABS = "/absolute/path/to/apic/src/server.js";

interface Client {
  id: string;
  name: string;
  /** Brand mark, so the list is scannable by logo rather than by reading. */
  Icon: (props: { className?: string }) => React.ReactElement;
  /** The client's own install route: a command it ships, or the file it reads. */
  where: string;
  language: string;
  code: string;
  /** Paste into that client and let its agent do the wiring. */
  prompt: string;
  /** What the prompt route needs before it can work, when it needs anything. */
  promptNeeds?: string;
  /** How the config format was established, so nobody trusts a guess. */
  verified: boolean;
}

const CLIENTS: Client[] = [
  {
    id: "claude-code",
    Icon: ClaudeIcon,
    name: "Claude Code",
    where: "run in your terminal",
    language: "bash",
    verified: true,
    code: `claude mcp add apic -- node ${SERVER}`,
    prompt: `Register the MCP server at ${SERVER} under the name apic, then list
its tools and call createTask with title "hello from apic" so I can see it hit
the real board.`,
  },
  {
    id: "claude-desktop",
    Icon: ClaudeIcon,
    name: "Claude Desktop",
    where: "Settings \u2192 Developer \u2192 Edit Config",
    language: "json",
    verified: true,
    code: `{
  "mcpServers": {
    "apic": {
      "command": "node",
      "args": ["${ABS}"]
    }
  }
}`,
    prompt: `Add an MCP server to my Claude Desktop config at
~/Library/Application Support/Claude/claude_desktop_config.json.

Name it apic. It runs: node ${ABS}
Use an absolute path \u2014 Desktop does not start in the repo. Keep every server
already in the file, and tell me to restart Claude Desktop when it is written.`,
    promptNeeds:
      "Desktop needs file access for this \u2014 the Filesystem connector, or Claude Code inside Desktop. Without it, use the config route.",
  },
  {
    id: "codex",
    Icon: OpenAIIcon,
    name: "Codex CLI",
    where: "~/.codex/config.toml",
    language: "toml",
    verified: false,
    code: `[mcp_servers.apic]
command = "node"
args = ["${ABS}"]`,
    prompt: `Add an MCP server named apic to ~/.codex/config.toml as an
[mcp_servers.apic] table \u2014 command "node", args the absolute path to
src/server.js in this repo. Leave the other mcp_servers tables alone,
then show me the tools apic exposes.`,
  },
  {
    id: "cursor",
    Icon: CursorIcon,
    name: "Cursor",
    where: "~/.cursor/mcp.json",
    language: "json",
    verified: false,
    code: `{
  "mcpServers": {
    "apic": {
      "command": "node",
      "args": ["${ABS}"]
    }
  }
}`,
    prompt: `Add an MCP server named apic to ~/.cursor/mcp.json \u2014 command "node",
args the absolute path to
src/server.js in this repo. Merge it into the
existing mcpServers object rather than replacing the file, then tell me to
enable it under Settings \u2192 MCP.`,
  },
  {
    id: "vscode",
    Icon: VSCodeIcon,
    name: "VS Code",
    where: ".vscode/mcp.json",
    language: "json",
    verified: false,
    code: `{
  "servers": {
    "apic": {
      "type": "stdio",
      "command": "node",
      "args": ["${SERVER}"]
    }
  }
}`,
    prompt: `Add a stdio MCP server named apic to .vscode/mcp.json in this
workspace \u2014 command "node", args ["${SERVER}"]. Create the file if it
is missing, then start the server and list the tools it registers.`,
  },
];

type Mode = "config" | "prompt";

export function Integrations() {
  const [active, setActive] = useState(CLIENTS[0].id);
  const [mode, setMode] = useState<Mode>("config");
  const [copied, setCopied] = useState(false);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];

  const isPrompt = mode === "prompt";
  const body = isPrompt ? client.prompt : client.code;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked - the snippet is selectable anyway */ }
  };

  return (
    <section id="install" className="border-t border-white/10 bg-[#120a10] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Install</SectionLabel>
        <h2 className="mt-5 max-w-2xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          Install the compiler, not the tools.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          apic is an ordinary stdio MCP server — no runtime, no daemon, no account. It starts with one
          tool, <span className="font-mono text-white/80">compile_app</span>; the rest arrive at runtime,
          in the session you are already in. If a client speaks MCP, it speaks to apic.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
          {CLIENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActive(c.id); setCopied(false); }}
              aria-pressed={c.id === active}
              className={cn(
                "flex items-center gap-2 border-b-2 pb-2 text-[15px] font-medium transition-colors",
                c.id === active
                  ? "border-primary text-white"
                  : "border-transparent text-white/45 hover:text-white/75",
              )}
            >
              <c.Icon className="h-3.5 w-3.5 shrink-0" />
              {c.name}
            </button>
          ))}
        </div>

        {/* Two routes per client, because the fastest one differs by client:
            wire it yourself, or hand the client's own agent the job. */}
        <div className="mt-6 inline-flex rounded-lg border border-white/12 p-0.5">
          {([
            ["config", "Wire it up"],
            ["prompt", `Ask ${client.name}`],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => { setMode(id); setCopied(false); }}
              aria-pressed={mode === id}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                mode === id ? "bg-white/10 text-white" : "text-white/45 hover:text-white/75",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate font-mono text-[11px] text-white/40">
              {isPrompt ? `paste into ${client.name}` : client.where}
            </p>
            <button
              onClick={copy}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/12 px-2.5 py-1.5 font-mono text-[12px] text-white/55 transition-colors hover:border-white/25 hover:text-white"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {isPrompt ? (
            <div className="rounded-xl border border-white/12 bg-black/60 px-4 py-4">
              <p className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-white/75">
                {client.prompt}
              </p>
            </div>
          ) : (
            <CodeBlock className="border-white/12 bg-black/60">
              <CodeBlockCode code={client.code} language={client.language} theme="github-dark-default" />
            </CodeBlock>
          )}

          {isPrompt && client.promptNeeds && (
            <p className="mt-3 text-[12px] leading-relaxed text-amber-300/70">{client.promptNeeds}</p>
          )}

          {!isPrompt && !client.verified && (
            <p className="mt-3 text-[12px] leading-relaxed text-amber-300/70">
              Format taken from {client.name}&rsquo;s documentation but not verified on this machine —
              confirm before demoing it.
            </p>
          )}
        </div>

        {/* What the agent actually does with it, as the agent would show it. */}
        <div className="mt-12 grid gap-3 sm:grid-cols-2">
          <BashTool
            label="apic compile"
            command="TARGET_URL=http://localhost:3456 npm run compile"
            output={"9 tools synthesised -> generated/vikunja/\nRECALL    8/18\nPRECISION 9/9"}
          />
          <BashTool
            state="running"
            label="apic watch"
            command="npm run watch"
          />
        </div>

        <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-white/40">
          Clients that start from the repo take the relative path. The ones showing{" "}
          <code className="font-mono text-white/55">/absolute/path/to/apic</code> do not start there
          &mdash; substitute your real checkout, or they will launch nothing.
        </p>

        {/* The in-process compile the server runs is not the CLI one, and the
            numbers on this page come from the CLI. Say so where the commands are. */}
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-white/40">
          apic also runs as an MCP server itself, compiling on demand and registering the new tools
          on the same connection. That in-process compile is a reduced pipeline &mdash; no grounding,
          no vision tier, no board drag &mdash; so it emits fewer tools than{" "}
          <code className="font-mono text-white/55">npm run compile</code>, which is the path every
          number on this page was measured on.
        </p>
      </div>
    </section>
  );
}

export default Integrations;
