import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { BashTool } from "@/components/ui/bash-tool";
import { ClaudeIcon, OpenAIIcon, CursorIcon, VSCodeIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { SectionLabel } from "@/components/section-label";

const SERVER = "./generated/vikunja/server.js";

interface Client {
  id: string;
  name: string;
  /** Brand mark, so the list is scannable by logo rather than by reading. */
  Icon: (props: { className?: string }) => React.ReactElement;
  /** Where the snippet goes. A command, or the file it belongs in. */
  where: string;
  language: string;
  code: string;
  /** How the format was established, so nobody trusts a guess. */
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
  },
  {
    id: "claude-desktop",
    Icon: ClaudeIcon,
    name: "Claude Desktop",
    where: "~/Library/Application Support/Claude/claude_desktop_config.json",
    language: "json",
    verified: true,
    code: `{
  "mcpServers": {
    "apic": {
      "command": "node",
      "args": ["${SERVER}"]
    }
  }
}`,
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
args = ["${SERVER}"]`,
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
      "args": ["${SERVER}"]
    }
  }
}`,
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
  },
];

export function Integrations() {
  const [active, setActive] = useState(CLIENTS[0].id);
  const [copied, setCopied] = useState(false);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(client.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked - the snippet is selectable anyway */ }
  };

  return (
    <section id="install" className="border-t border-white/10 bg-[#120a10] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <SectionLabel>Install</SectionLabel>
        <h2 className="mt-5 max-w-2xl font-[family-name:var(--font-display)] text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[0.98] tracking-[-0.045em] text-white">
          Hand the compiled server to any agent.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          What apic emits is an ordinary stdio MCP server — no runtime, no daemon, no account. If a
          client speaks MCP, it speaks to your app.
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

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="min-w-0 truncate font-mono text-[11px] text-white/40">{client.where}</p>
            <button
              onClick={copy}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/12 px-2.5 py-1.5 font-mono text-[12px] text-white/55 transition-colors hover:border-white/25 hover:text-white"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <CodeBlock className="border-white/12 bg-black/60">
            <CodeBlockCode code={client.code} language={client.language} theme="github-dark-default" />
          </CodeBlock>

          {!client.verified && (
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
            command="node src/compile.js --target http://localhost:3456"
            output={"explore   9 actions\nverify    9/9 kept\nemit      generated/vikunja/server.js"}
          />
          <BashTool
            state="running"
            label="apic watch"
            command="node src/watch.js"
          />
        </div>

        <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-white/40">
          Paths are relative to the apic repo. Use an absolute path if your client starts from a
          different working directory.
        </p>
      </div>
    </section>
  );
}

export default Integrations;
