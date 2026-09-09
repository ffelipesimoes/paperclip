import { useState, useMemo, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  GitFork,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Wrench,
  Zap,
} from "lucide-react";
import type { AgentTraceNode } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { formatCents, formatDurationMs, formatTokens } from "@/lib/utils";

interface AgentTraceViewerProps {
  runId: string | null;
  onClose: () => void;
}

type NodeKindConfig = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  badgeClass: string;
  iconClass: string;
};

const KIND_CONFIGS: Record<AgentTraceNode["kind"], NodeKindConfig> = {
  thought: {
    icon: Brain,
    label: "Raciocínio",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    iconClass: "text-amber-500",
  },
  tool_call: {
    icon: Wrench,
    label: "Ferramenta",
    badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    iconClass: "text-sky-500",
  },
  subagent: {
    icon: Bot,
    label: "Sub-agente",
    badgeClass: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    iconClass: "text-indigo-500",
  },
  message: {
    icon: CheckCircle2,
    label: "Resposta",
    badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    iconClass: "text-emerald-500",
  },
  lifecycle: {
    icon: Layers,
    label: "Ciclo de Vida",
    badgeClass: "bg-muted text-muted-foreground border-border",
    iconClass: "text-muted-foreground",
  },
  error: {
    icon: AlertCircle,
    label: "Erro",
    badgeClass: "bg-destructive/10 text-destructive border-destructive/20",
    iconClass: "text-destructive",
  },
};

function formatPayload(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function CodeInspector({ title, data }: { title: string; data: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = formatPayload(data);

  if (!text) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="font-semibold uppercase text-xs">{title}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-foreground text-xs"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </button>
      </div>
      <pre className="p-2.5 rounded-md bg-muted/50 border border-border text-xs font-mono overflow-x-auto max-h-48 text-foreground whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

function TraceNodeItem({
  node,
  depth = 0,
  allExpanded,
}: {
  node: AgentTraceNode;
  depth?: number;
  allExpanded?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const hasPayload = Boolean(node.input || node.output);
  const config = KIND_CONFIGS[node.kind] ?? KIND_CONFIGS.lifecycle;
  const Icon = config.icon;

  const effectiveOpen = allExpanded !== undefined ? allExpanded : isOpen;

  return (
    <div className={`space-y-1 ${depth > 0 ? "pl-3 border-l border-border/70 ml-2.5" : ""}`}>
      <div
        className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${
          node.status === "error"
            ? "border-destructive/30 bg-destructive/5"
            : node.kind === "thought"
            ? "border-amber-500/20 bg-amber-500/5"
            : node.kind === "tool_call"
            ? "border-sky-500/20 bg-sky-500/5"
            : "border-border/60 bg-muted/20 hover:bg-muted/40"
        }`}
      >
        <div className="flex items-start gap-2 min-w-0">
          {(hasChildren || hasPayload) ? (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="mt-0.5 p-0.5 rounded hover:bg-muted text-muted-foreground shrink-0"
              aria-label={effectiveOpen ? "Recolher passo" : "Expandir passo"}
            >
              {effectiveOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <div className="mt-0.5 shrink-0">
            <Icon className={`h-4 w-4 ${config.iconClass}`} />
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className={`text-xs px-1.5 py-0 ${config.badgeClass}`}>
                {config.label}
              </Badge>
              {node.name && (
                <span className="font-mono text-xs font-semibold text-foreground">
                  {node.name}
                </span>
              )}
              <span className="text-xs font-medium text-foreground truncate max-w-sm sm:max-w-md">
                {node.title}
              </span>
            </div>
            {node.startedAt && (
              <div className="text-xs text-muted-foreground">
                {new Date(node.startedAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pl-6 sm:pl-0">
          {node.durationMs != null && (
            <Badge variant="secondary" className="font-mono text-xs gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span>{formatDurationMs(node.durationMs)}</span>
            </Badge>
          )}

          {node.tokens && (
            <Badge variant="outline" className="font-mono text-xs gap-1">
              <Zap className="h-3 w-3 text-amber-500" />
              <span>{formatTokens(node.tokens.input + node.tokens.cached + node.tokens.output)}</span>
            </Badge>
          )}

          <Badge
            variant={node.status === "error" ? "destructive" : "secondary"}
            className="text-xs capitalize"
          >
            {node.status}
          </Badge>
        </div>
      </div>

      {effectiveOpen && (
        <div className="space-y-2 pt-1 pb-1">
          {hasPayload && (
            <div className="pl-6 space-y-2">
              {node.input !== undefined && node.input !== null && (
                <CodeInspector title="Parâmetros de Entrada (Input)" data={node.input} />
              )}
              {node.output !== undefined && node.output !== null && (
                <CodeInspector title="Resultado / Saída (Output)" data={node.output} />
              )}
            </div>
          )}

          {hasChildren && (
            <div className="space-y-1.5 pt-1">
              {node.children!.map((child) => (
                <TraceNodeItem
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  allExpanded={allExpanded}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentTraceViewer({ runId, onClose }: AgentTraceViewerProps) {
  const [filterKind, setFilterKind] = useState<string>("all");
  const [allExpanded, setAllExpanded] = useState<boolean | undefined>(undefined);

  const { data: trace, isLoading, error } = useQuery({
    queryKey: ["agent-run-trace", runId],
    queryFn: () => instanceSettingsApi.getRunTrace(runId!),
    enabled: Boolean(runId),
  });

  const filteredNodes = useMemo(() => {
    if (!trace?.nodes) return [];
    if (filterKind === "all") return trace.nodes;
    return trace.nodes.filter((n) => {
      if (n.kind === filterKind) return true;
      if (n.children && n.children.some((c) => c.kind === filterKind)) return true;
      return false;
    });
  }, [trace, filterKind]);

  const stepStats = useMemo(() => {
    if (!trace?.nodes) return { thoughts: 0, tools: 0, subagents: 0, errors: 0 };
    let thoughts = 0;
    let tools = 0;
    let subagents = 0;
    let errors = 0;

    const countNode = (node: AgentTraceNode) => {
      if (node.kind === "thought") thoughts++;
      if (node.kind === "tool_call") tools++;
      if (node.kind === "subagent") subagents++;
      if (node.status === "error" || node.kind === "error") errors++;
      if (node.children) {
        for (const c of node.children) countNode(c);
      }
    };

    for (const n of trace.nodes) countNode(n);
    return { thoughts, tools, subagents, errors };
  }, [trace]);

  return (
    <Dialog open={Boolean(runId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-(--sz-85vh) overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pr-6">
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <GitFork className="h-4 w-4 text-sky-500" />
                <DialogTitle className="text-base font-semibold truncate">
                  {trace?.issueTitle ?? "Rastreio de Execução do Agente (Trace)"}
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                {trace ? (
                  <>
                    {trace.companyPrefix ? `${trace.companyPrefix} · ` : ""}
                    Agente: <strong className="text-foreground">{trace.agentName}</strong> · Run ID:{" "}
                    <span className="font-mono">{trace.runId.slice(0, 8)}</span>
                    {trace.issueId && trace.companyPrefix && (
                      <>
                        {" "}·{" "}
                        <Link
                          to={`/${trace.companyPrefix}/issues/${trace.issueId}`}
                          className="hover:underline text-foreground inline-flex items-center gap-0.5"
                        >
                          <span>Ver Tarefa</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      </>
                    )}
                  </>
                ) : (
                  "Carregando rastreio detalhado..."
                )}
              </DialogDescription>
            </div>

            {trace && (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <Badge variant="outline" className="font-mono text-xs gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span>{formatDurationMs(trace.durationMs)}</span>
                </Badge>
                <Badge variant="outline" className="font-mono text-xs gap-1">
                  <Zap className="h-3 w-3 text-amber-500" />
                  <span>{formatTokens(trace.totalTokens)}</span>
                </Badge>
                <Badge variant="outline" className="font-mono text-xs gap-1 text-amber-500 font-semibold">
                  <Coins className="h-3 w-3" />
                  <span>{formatCents(trace.simulatedCostCents)}</span>
                </Badge>
                <Badge
                  variant={trace.status === "failed" ? "destructive" : "secondary"}
                  className="capitalize font-semibold text-xs"
                >
                  {trace.status}
                </Badge>
              </div>
            )}
          </div>

          {trace && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs border-t border-border/50">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant={filterKind === "all" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilterKind("all")}
                  className="h-6 text-xs px-2"
                >
                  Todos ({trace.nodes.length})
                </Button>
                <Button
                  variant={filterKind === "thought" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilterKind("thought")}
                  className="h-6 text-xs px-2 gap-1"
                >
                  <Brain className="h-3 w-3 text-amber-500" />
                  <span>Raciocínio ({stepStats.thoughts})</span>
                </Button>
                <Button
                  variant={filterKind === "tool_call" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilterKind("tool_call")}
                  className="h-6 text-xs px-2 gap-1"
                >
                  <Wrench className="h-3 w-3 text-sky-500" />
                  <span>Ferramentas ({stepStats.tools})</span>
                </Button>
                <Button
                  variant={filterKind === "subagent" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setFilterKind("subagent")}
                  className="h-6 text-xs px-2 gap-1"
                >
                  <Bot className="h-3 w-3 text-indigo-500" />
                  <span>Sub-agentes ({stepStats.subagents})</span>
                </Button>
                {stepStats.errors > 0 && (
                  <Button
                    variant={filterKind === "error" ? "destructive" : "ghost"}
                    size="sm"
                    onClick={() => setFilterKind("error")}
                    className="h-6 text-xs px-2 gap-1 text-destructive"
                  >
                    <AlertCircle className="h-3 w-3" />
                    <span>Erros ({stepStats.errors})</span>
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAllExpanded(true)}
                  className="h-6 text-xs px-2 gap-1 text-muted-foreground"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>Expandir Todos</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAllExpanded(false)}
                  className="h-6 text-xs px-2 gap-1 text-muted-foreground"
                >
                  <Minimize2 className="h-3 w-3" />
                  <span>Recolher Todos</span>
                </Button>
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading && (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span>Carregando árvore de execução...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Não foi possível carregar os detalhes do rastreio: {(error as Error).message}</span>
            </div>
          )}

          {!isLoading && !error && filteredNodes.length === 0 && (
            <div className="py-16 text-center text-xs text-muted-foreground space-y-1">
              <Activity className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
              <p className="font-medium text-foreground">Nenhum passo de execução encontrado.</p>
              <p>Esta execução não registrou passos individuais ou o filtro selecionado está vazio.</p>
            </div>
          )}

          {!isLoading && !error && filteredNodes.length > 0 && (
            <div className="space-y-2">
              {filteredNodes.map((node) => (
                <TraceNodeItem
                  key={node.id}
                  node={node}
                  allExpanded={allExpanded}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
