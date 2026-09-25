import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "../../lib/utils";

export interface TourStep {
  targetSelector: string;
  title: string;
  description: string;
  placement?: "bottom" | "top" | "left" | "right";
}

const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    targetSelector: '[data-tour="agents"]',
    title: "Seu Squad de Agentes",
    description:
      "Aqui fica a equipe da sua empresa. Você pode inspecionar os agentes recém-criados, verificar seus papéis e gerenciar suas instruções.",
    placement: "right",
  },
  {
    targetSelector: '[data-tour="issues"]',
    title: "Quadro de Tarefas (Issues)",
    description:
      "O centro de comando das operações. É aqui que os agentes recebem demandas, colaboram entre si e atualizam o progresso até a conclusão.",
    placement: "right",
  },
  {
    targetSelector: '[data-tour="activity"]',
    title: "Linha do Tempo & Auditoria",
    description:
      "Acompanhe o raciocínio, ferramentas e execuções dos seus agentes em tempo real, com transparência total de histórico e custos.",
    placement: "right",
  },
  {
    targetSelector: '[data-tour="new-issue"]',
    title: "Delegue sua Primeira Demanda",
    description:
      "Pronto para ver seu time em ação? Use este atalho a qualquer momento para criar uma tarefa e delegar trabalho ao seu squad.",
    placement: "bottom",
  },
];

interface ProductTourProps {
  companyId: string;
  steps?: TourStep[];
  onComplete?: () => void;
  forceOpen?: boolean;
}

export function ProductTour({
  companyId,
  steps = DEFAULT_TOUR_STEPS,
  onComplete,
  forceOpen = false,
}: ProductTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const storageKey = `paperclip_tour_completed_${companyId}`;
  const triggerKey = `paperclip_start_tour_${companyId}`;

  // Verificar se o tour deve ser iniciado
  useEffect(() => {
    if (!companyId) return;

    if (forceOpen) {
      setIsActive(true);
      setCurrentStepIndex(0);
      return;
    }

    const completed = localStorage.getItem(storageKey);
    const shouldStart = localStorage.getItem(triggerKey);

    if (shouldStart === "true" && !completed) {
      setIsActive(true);
      setCurrentStepIndex(0);
      // Remove o gatilho inicial para evitar reaberturas acidentais
      localStorage.removeItem(triggerKey);
    }
  }, [companyId, forceOpen, storageKey, triggerKey]);

  const updateTargetRect = useCallback(() => {
    if (!isActive) return;
    const currentStep = steps[currentStepIndex];
    if (!currentStep) return;

    const el = document.querySelector(currentStep.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [isActive, steps, currentStepIndex]);

  // Atualizar bounding box no step change, scroll ou resize
  useEffect(() => {
    if (!isActive) return;

    updateTargetRect();
    const handleEvent = () => updateTargetRect();

    window.addEventListener("resize", handleEvent);
    window.addEventListener("scroll", handleEvent, true);

    return () => {
      window.removeEventListener("resize", handleEvent);
      window.removeEventListener("scroll", handleEvent, true);
    };
  }, [isActive, updateTargetRect]);

  const handleDismiss = useCallback(() => {
    setIsActive(false);
    if (companyId) {
      localStorage.setItem(storageKey, "true");
    }
    onComplete?.();
  }, [companyId, storageKey, onComplete]);

  // Fechar no Escape
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, handleDismiss]);

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  if (!isActive) return null;

  const currentStep = steps[currentStepIndex];
  if (!currentStep) return null;

  // Calcular posição do popover
  const padding = 8;
  const popoverWidth = 320;
  let popoverTop = 100;
  let popoverLeft = 100;

  if (targetRect) {
    const placement = currentStep.placement ?? "bottom";
    if (placement === "right") {
      popoverLeft = targetRect.right + padding * 2;
      popoverTop = Math.max(16, targetRect.top - 20);
    } else if (placement === "bottom") {
      popoverLeft = Math.max(16, targetRect.left);
      popoverTop = targetRect.bottom + padding * 2;
    } else if (placement === "top") {
      popoverLeft = Math.max(16, targetRect.left);
      popoverTop = targetRect.top - 180;
    } else {
      popoverLeft = Math.max(16, targetRect.left - popoverWidth - padding * 2);
      popoverTop = Math.max(16, targetRect.top);
    }

    // Limites de viewport
    if (popoverLeft + popoverWidth > window.innerWidth - 16) {
      popoverLeft = window.innerWidth - popoverWidth - 16;
    }
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Overlay escurecido */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-xs transition-opacity duration-300 pointer-events-auto" />

      {/* Recorte / Destaque do elemento alvo */}
      {targetRect && (
        <div
          className="absolute rounded-lg border-2 border-primary shadow-lg ring-4 ring-primary/25 pointer-events-none transition-all duration-300 ease-out"
          style={
            {
              top: targetRect.top - padding,
              left: targetRect.left - padding,
              width: targetRect.width + padding * 2,
              height: targetRect.height + padding * 2,
            } as CSSProperties
          }
        />
      )}

      {/* Card Popover explicativo */}
      <div
        className="absolute pointer-events-auto w-80 rounded-xl border border-border bg-card p-4 shadow-2xl transition-all duration-300 animate-in fade-in zoom-in-95 space-y-3"
        style={
          {
            top: popoverTop,
            left: popoverLeft,
          } as CSSProperties
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-primary text-xs font-semibold">
            <Sparkles className="size-3.5" />
            <span>Passeio pela Plataforma</span>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            aria-label="Pular tour"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            {currentStep.title}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {currentStep.description}
          </p>
        </div>

        {/* Rodapé com passos e navegação */}
        <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
          <span className="text-(length:--text-micro) text-muted-foreground font-mono">
            {currentStepIndex + 1} de {steps.length}
          </span>

          <div className="flex items-center gap-1.5">
            {currentStepIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={handlePrev}
              >
                <ArrowLeft className="size-3 mr-1" />
                Voltar
              </Button>
            )}

            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={handleNext}
            >
              {currentStepIndex < steps.length - 1 ? (
                <>
                  Próximo
                  <ArrowRight className="size-3 ml-1" />
                </>
              ) : (
                <>
                  <Check className="size-3 mr-1" />
                  Concluir
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
