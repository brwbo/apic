import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { CodeBlock, CodeBlockCode } from "@/components/ui/code-block";
import { ClaudeIcon, OpenAIIcon, CursorIcon, VSCodeIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

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
    <section id="install" className="border-t border-white/10 bg-[#0a0511] px-6 py-24 sm:px-10 sm:py-32">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-primary/80">Install</p>
        <h2 className="mt-4 max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl">
          Hand the compiled server to any agent.
        </h2>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
          What apic emits is an ordinary stdio MCP server — no runtime, no daemon, no account. If a
          client speaks MCP, it speaks to your app.
        </p>

        <div className="mt-10 flex flex-wrap gap-2">
          {CLIENTS.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActive(c.id); setCopied(false); }}
              aria-pressed={c.id === active}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                c.id === active
                  ? "border-primary/60 bg-primary/15 text-white"
                  : "border-white/12 text-white/55 hover:border-white/25 hover:text-white/80",
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
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/12 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55 transition-colors hover:border-white/25 hover:text-white"
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

        <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-white/40">
          Paths are relative to the apic repo. Use an absolute path if your client starts from a
          different working directory.
        </p>
      </div>
    </section>
  );
}

export default Integrations;
