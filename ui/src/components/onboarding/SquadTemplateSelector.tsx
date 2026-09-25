import type { CSSProperties, ReactNode } from "react";
import {
  Bot,
  Code2,
  TrendingUp,
  Sparkles,
  ShieldCheck,
  Terminal,
  UserCheck,
  Check,
  Layers,
  ArrowRight,
} from "lucide-react";
import { cn } from "../../lib/utils";

export interface SquadAgentPreview {
  slug: string;
  name: string;
  title: string;
  roleLabel: string;
  description: string;
  icon: typeof Bot;
}

export interface SquadTemplateOption {
  id: string;
  name: string;
  tagline: string;
  description: string;
  Icon: typeof Code2;
  agentCount: number;
  catalogSlug: string | null;
  badge?: string;
  starterProjectName: string;
  agents: SquadAgentPreview[];
}

export const SQUAD_TEMPLATES: SquadTemplateOption[] = [
  {
    id: "product-engineering",
    name: "Squad de TI / Engenharia",
    tagline: "Desenvolvimento, testes e entrega contínua",
    description: "Um time técnico completo com liderança técnica, implementação de código e controle de qualidade.",
    Icon: Code2,
    agentCount: 3,
    catalogSlug: "product-engineering",
    badge: "Recomendado",
    starterProjectName: "Product Engineering Backlog",
    agents: [
      {
        slug: "cto",
        name: "Alex",
        title: "Chief Technology Officer",
        roleLabel: "Liderança Técnica",
        description: "Arquiteta soluções, desmembra requisitos em tarefas técnicas e revisa PRs.",
        icon: Terminal,
      },
      {
        slug: "senior-coder",
        name: "Leo",
        title: "Senior Software Engineer",
        roleLabel: "Implementador",
        description: "Implementa features, resolve bugs, escreve testes e submete alterações.",
        icon: Code2,
      },
      {
        slug: "qa",
        name: "Maya",
        title: "Quality Assurance Engineer",
        roleLabel: "Validação & Testes",
        description: "Executa testes de aceitação, valida critérios e garante zero regressões.",
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: "b2b-sales",
    name: "Time de Vendas & SDR",
    tagline: "Prospecção ativa e qualificação B2B",
    description: "Geração autônoma de pipeline com pesquisa direcionada e abordagem consultiva.",
    Icon: TrendingUp,
    agentCount: 2,
    catalogSlug: "b2b-sales",
    starterProjectName: "Sales Pipeline & Outbound",
    agents: [
      {
        slug: "sales-lead",
        name: "Helena",
        title: "Head of Sales",
        roleLabel: "Estratégia & Fechamento",
        description: "Define o perfil de cliente ideal (ICP), estrutura propostas e prioriza contas.",
        icon: UserCheck,
      },
      {
        slug: "sdr",
        name: "Lucas",
        title: "Sales Development Rep",
        roleLabel: "Prospecção Outbound",
        description: "Mapeia empresas-alvo, cria cadências de e-mail e qualifica interesse.",
        icon: TrendingUp,
      },
    ],
  },
  {
    id: "content-machine",
    name: "Time de Marketing & Conteúdo",
    tagline: "Planejamento editorial e engajamento",
    description: "Produção contínua de conteúdo otimizado para blogs, redes sociais e autoridade de marca.",
    Icon: Sparkles,
    agentCount: 2,
    catalogSlug: "content-machine",
    starterProjectName: "Content Operations",
    agents: [
      {
        slug: "content-lead",
        name: "Sofia",
        title: "Content Marketing Lead",
        roleLabel: "Estratégia de Conteúdo",
        description: "Planeja o calendário editorial, define pautas e valida tom de voz.",
        icon: Sparkles,
      },
      {
        slug: "copywriter",
        name: "Bruno",
        title: "Growth Copywriter",
        roleLabel: "Redação & SEO",
        description: "Redige artigos aprofundados, posts de alta conversão e materiais ricos.",
        icon: Bot,
      },
    ],
  },
  {
    id: "solo",
    name: "Agente Solo",
    tagline: "1 Agente (CEO / Chief of Staff)",
    description: "Comece enxuto com um único agente coordenador e adicione mais agentes sob demanda.",
    Icon: Bot,
    agentCount: 1,
    catalogSlug: null,
    starterProjectName: "Primeira Missão",
    agents: [
      {
        slug: "ceo",
        name: "Chief of Staff",
        title: "Lead Agent",
        roleLabel: "Coordenação Geral",
        description: "Entende seus objetivos, planeja as primeiras iniciativas e contrata novos agentes.",
        icon: Bot,
      },
    ],
  },
];

interface SquadTemplateSelectorProps {
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
  className?: string;
}

export function SquadTemplateSelector({
  selectedTemplateId,
  onSelectTemplate,
  className,
}: SquadTemplateSelectorProps) {
  const selectedTemplate =
    SQUAD_TEMPLATES.find((tpl) => tpl.id === selectedTemplateId) ?? SQUAD_TEMPLATES[0];

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground block">
          Escolha o modelo de Squad inicial
        </label>
        <span className="text-(length:--text-micro) text-muted-foreground flex items-center gap-1">
          <Layers className="size-3" />
          Templates prontos com funções coordenadas
        </span>
      </div>

      {/* Grid de seleção dos Squads */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {SQUAD_TEMPLATES.filter((tpl) => tpl.id !== "solo").map((tpl) => {
          const isSelected = tpl.id === selectedTemplateId;
          const TemplateIcon = tpl.Icon;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelectTemplate(tpl.id)}
              className={cn(
                "relative text-left flex flex-col justify-between rounded-lg border p-3 transition-colors cursor-pointer",
                isSelected
                  ? "border-foreground bg-accent/60 shadow-xs"
                  : "border-border bg-card/50 hover:bg-accent/30 hover:border-foreground/30",
              )}
            >
              {tpl.badge && (
                <span className="absolute top-2.5 right-2.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-(length:--text-nano) font-medium text-primary">
                  {tpl.badge}
                </span>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "size-7 rounded-md flex items-center justify-center border",
                      isSelected
                        ? "border-foreground/20 bg-background text-foreground"
                        : "border-border/60 bg-muted text-muted-foreground",
                    )}
                  >
                    <TemplateIcon className="size-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-foreground leading-tight">
                      {tpl.name}
                    </h4>
                    <span className="text-(length:--text-micro) text-muted-foreground">
                      {tpl.agentCount} agentes
                    </span>
                  </div>
                </div>
                <p className="text-(length:--text-micro) text-muted-foreground line-clamp-2 leading-relaxed">
                  {tpl.tagline}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-between text-(length:--text-nano)">
                <span className="text-muted-foreground">
                  {isSelected ? "Selecionado" : "Clique para selecionar"}
                </span>
                {isSelected ? (
                  <span className="size-4 rounded-full bg-foreground text-background flex items-center justify-center">
                    <Check className="size-2.5" />
                  </span>
                ) : (
                  <ArrowRight className="size-3 text-muted-foreground/60" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Opção para começar enxuto / solo */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={() => onSelectTemplate("solo")}
          className={cn(
            "text-(length:--text-micro) flex items-center gap-1.5 transition-colors cursor-pointer",
            selectedTemplateId === "solo"
              ? "font-medium text-foreground underline underline-offset-4"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bot className="size-3" />
          <span>Prefere começar do zero? Criar apenas 1 agente solo (Chief of Staff).</span>
          {selectedTemplateId === "solo" && (
            <span className="size-3.5 rounded-full bg-foreground text-background inline-flex items-center justify-center text-(length:--text-nano)">
              ✓
            </span>
          )}
        </button>
      </div>

      {/* Preview detalhado dos agentes que serão criados */}
      {selectedTemplate && (
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3 space-y-2.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <div>
              <span className="text-xs font-medium text-foreground">
                Agentes sugeridos para o {selectedTemplate.name}
              </span>
              <p className="text-(length:--text-micro) text-muted-foreground">
                Estes agentes serão provisionados automaticamente e compartilharão sua credencial de modelo.
              </p>
            </div>
            <span className="text-(length:--text-micro) font-mono px-2 py-0.5 rounded-md border border-border bg-background text-muted-foreground">
              {selectedTemplate.agentCount} {selectedTemplate.agentCount === 1 ? "agente" : "agentes"}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {selectedTemplate.agents.map((agent) => {
              const AgentIcon = agent.icon;
              return (
                <div
                  key={agent.slug}
                  className="rounded-md border border-border/60 bg-card p-2.5 flex items-start gap-2.5"
                >
                  <div className="size-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 mt-0.5 text-foreground">
                    <AgentIcon className="size-3.5" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">
                        {agent.name}
                      </span>
                      <span className="text-(length:--text-nano) px-1.5 py-0.2 rounded-sm bg-accent text-accent-foreground border border-border/40 font-medium">
                        {agent.roleLabel}
                      </span>
                    </div>
                    <p className="text-(length:--text-micro) text-muted-foreground font-medium">
                      {agent.title}
                    </p>
                    <p className="text-(length:--text-micro) text-muted-foreground/90 leading-tight">
                      {agent.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-1 flex items-center justify-between text-(length:--text-nano) text-muted-foreground">
            <span>
              Projeto inicial: <strong className="text-foreground">{selectedTemplate.starterProjectName}</strong>
            </span>
            <span className="italic">
              Agentes secundários iniciarão em modo de espera (idle) até receberem demandas.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
