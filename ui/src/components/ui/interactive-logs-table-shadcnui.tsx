import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LogLevel = "info" | "warning" | "error";

export interface Log {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  duration: string;
  status: string;
  tags: string[];
}

type Filters = { level: string[]; service: string[]; status: string[] };

/** Default rows — an apic compile run, so the panel reads correctly before the SSE feed is wired. */
const SAMPLE_LOGS: Log[] = [
  { id: "1", timestamp: "2026-08-22T14:32:45Z", level: "info", service: "emit", message: "Wrote generated/server.ts — 5 tools", duration: "18ms", status: "ok", tags: ["mcp", "emit"] },
  { id: "2", timestamp: "2026-08-22T14:32:42Z", level: "info", service: "verify", message: "createIssue → predicted state change observed", duration: "2.1s", status: "pass", tags: ["openai", "verify"] },
  { id: "3", timestamp: "2026-08-22T14:32:40Z", level: "error", service: "verify", message: "deleteIssue → assertion failed, no state change", duration: "5.1s", status: "fail", tags: ["openai", "verify"] },
  { id: "4", timestamp: "2026-08-22T14:32:38Z", level: "info", service: "ground", message: "Docs vocabulary matched: btn_submit_2 → createIssue", duration: "890ms", status: "ok", tags: ["tavily", "ground"] },
  { id: "5", timestamp: "2026-08-22T14:32:35Z", level: "info", service: "synthesise", message: "Tool schema emitted: assignIssue(issueId, userId)", duration: "1.4s", status: "ok", tags: ["openai", "schema"] },
  { id: "6", timestamp: "2026-08-22T14:32:32Z", level: "warning", service: "perceive", message: "Low-confidence diff, escalating to fal VLM", duration: "212ms", status: "escalated", tags: ["pioneer", "fal"] },
  { id: "7", timestamp: "2026-08-22T14:32:30Z", level: "info", service: "perceive", message: "Step 4 before/after → changed", duration: "12ms", status: "ok", tags: ["fal", "diff"] },
  { id: "8", timestamp: "2026-08-22T14:32:28Z", level: "info", service: "explore", message: "Clicked 'New Issue', recorded trajectory", duration: "20.4s", status: "ok", tags: ["h", "explore"] },
];

const levelStyles: Record<LogLevel, string> = {
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  error: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const statusStyles: Record<string, string> = {
  ok: "text-green-600 dark:text-green-400",
  pass: "text-green-600 dark:text-green-400",
  escalated: "text-yellow-600 dark:text-yellow-400",
  fail: "text-red-600 dark:text-red-400",
  warning: "text-yellow-600 dark:text-yellow-400",
};

function LogRow({ log, expanded, onToggle }: { log: Log; expanded: boolean; onToggle: () => void }) {
  const formattedTime = new Date(log.timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <>
      <motion.button
        onClick={onToggle}
        className="w-full p-4 text-left transition-colors hover:bg-muted/50 active:bg-muted/70"
      >
        <div className="flex items-center gap-4">
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex-shrink-0">
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </motion.div>

          <Badge variant="secondary" className={`flex-shrink-0 capitalize ${levelStyles[log.level]}`}>
            {log.level}
          </Badge>

          <time className="w-20 flex-shrink-0 font-mono text-xs text-muted-foreground">{formattedTime}</time>

          <span className="flex-shrink-0 min-w-max text-sm font-medium text-foreground">{log.service}</span>

          <p className="flex-1 truncate text-sm text-muted-foreground">{log.message}</p>

          <span className={`flex-shrink-0 font-mono text-sm font-semibold ${statusStyles[log.status] ?? "text-muted-foreground"}`}>
            {log.status}
          </span>

          <span className="w-16 flex-shrink-0 text-right font-mono text-xs text-muted-foreground">{log.duration}</span>
        </div>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border bg-muted/50"
          >
            <div className="space-y-4 p-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</p>
                <p className="rounded bg-background p-3 font-mono text-sm text-foreground">{log.message}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration</p>
                  <p className="font-mono text-foreground">{log.duration}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timestamp</p>
                  <p className="font-mono text-xs text-foreground">{log.timestamp}</p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {log.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FilterPanel({ filters, onChange, logs }: { filters: Filters; onChange: (f: Filters) => void; logs: Log[] }) {
  const groups: [keyof Filters, string, string[]][] = [
    ["level", "Level", Array.from(new Set(logs.map((l) => l.level)))],
    ["service", "Stage", Array.from(new Set(logs.map((l) => l.service)))],
    ["status", "Status", Array.from(new Set(logs.map((l) => l.status)))],
  ];

  const toggleFilter = (category: keyof Filters, value: string) => {
    const current = filters[category];
    const updated = current.includes(value) ? current.filter((e) => e !== value) : [...current, value];
    onChange({ ...filters, [category]: updated });
  };

  const hasActiveFilters = Object.values(filters).some((g) => g.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.05 }}
      className="flex h-full flex-col space-y-6 overflow-y-auto bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ level: [], service: [], status: [] })} className="h-6 text-xs">
            Clear
          </Button>
        )}
      </div>

      {groups.map(([key, title, values]) => (
        <div key={key} className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
          <div className="space-y-2">
            {values.map((value) => {
              const selected = filters[key].includes(value);
              return (
                <motion.button
                  key={value}
                  type="button"
                  whileHover={{ x: 2 }}
                  onClick={() => toggleFilter(key, value)}
                  aria-pressed={selected}
                  className={`flex w-full items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <span className="capitalize">{value}</span>
                  {selected && <Check className="h-3.5 w-3.5" />}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

export function InteractiveLogsTable({ logs = SAMPLE_LOGS, className = "h-screen" }: { logs?: Log[]; className?: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>({ level: [], service: [], status: [] });

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const q = searchQuery.toLowerCase();
      const matchSearch = log.message.toLowerCase().includes(q) || log.service.toLowerCase().includes(q);
      const matchLevel = filters.level.length === 0 || filters.level.includes(log.level);
      const matchService = filters.service.length === 0 || filters.service.includes(log.service);
      const matchStatus = filters.status.length === 0 || filters.status.includes(log.status);
      return matchSearch && matchLevel && matchService && matchStatus;
    });
  }, [filters, searchQuery, logs]);

  const activeFilters = filters.level.length + filters.service.length + filters.status.length;

  return (
    <main className={`w-full bg-background ${className}`}>
      <div className="flex h-full flex-col">
        <div className="border-b border-border bg-card p-6">
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Build log</h1>
              <p className="text-sm text-muted-foreground">{filteredLogs.length} of {logs.length} events</p>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by message or stage..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-9 text-sm"
                />
              </div>
              <Button variant={showFilters ? "default" : "outline"} size="sm" onClick={() => setShowFilters((c) => !c)} className="relative">
                <Filter className="h-4 w-4" />
                {activeFilters > 0 && (
                  <Badge className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center p-0 text-xs bg-destructive">
                    {activeFilters}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.div
                key="filters"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-r border-border"
              >
                <FilterPanel filters={filters} onChange={setFilters} logs={logs} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-border">
              <AnimatePresence mode="popLayout">
                {filteredLogs.length > 0 ? (
                  filteredLogs.map((log, index) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2, delay: index * 0.02 }}
                    >
                      <LogRow log={log} expanded={expandedId === log.id} onToggle={() => setExpandedId((c) => (c === log.id ? null : log.id))} />
                    </motion.div>
                  ))
                ) : (
                  <motion.div key="empty-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-12 text-center">
                    <p className="text-muted-foreground">No events match your filters.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
