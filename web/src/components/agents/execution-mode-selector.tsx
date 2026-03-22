import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { GitFork, Zap } from "lucide-react";
import { api, cn } from "../../lib/utils";

interface ExecutionModeSelectorProps {
  onModeChange?: (mode: string) => void;
}

type ExecutionMode = "v1" | "v2";

export function ExecutionModeSelector({ onModeChange }: ExecutionModeSelectorProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ExecutionMode>("v1");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ mode: ExecutionMode }>("/execution-mode")
      .then((data) => {
        setMode(data.mode);
        onModeChange?.(data.mode);
      })
      .catch(() => {
        // Default to v1 on error
      })
      .finally(() => setLoading(false));
    // Only fetch on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelect = useCallback(
    async (selected: ExecutionMode) => {
      if (selected === mode) return;
      const previous = mode;
      setMode(selected);
      try {
        await api("/execution-mode", {
          method: "PUT",
          body: JSON.stringify({ mode: selected }),
        });
        onModeChange?.(selected);
      } catch {
        setMode(previous);
      }
    },
    [mode, onModeChange],
  );

  if (loading) {
    return (
      <div className="mb-6">
        <div className="h-4 w-40 animate-pulse rounded bg-neutral-bg2 mb-3" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 animate-pulse rounded-xl bg-neutral-bg2" />
          <div className="h-24 animate-pulse rounded-xl bg-neutral-bg2" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h3 className="text-[14px] font-semibold text-neutral-fg1 mb-3">
        {t("agents.executionMode", "Modo de Execução")}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {/* V1 Card */}
        <button
          onClick={() => handleSelect("v1")}
          className={cn(
            "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-200",
            mode === "v1"
              ? "border-brand bg-brand-light/30 ring-2 ring-brand/20"
              : "border-stroke bg-neutral-bg2 hover:bg-neutral-bg-hover",
          )}
        >
          <div className="flex items-center gap-2">
            <GitFork className="h-4 w-4 text-brand" />
            <span className="text-[13px] font-semibold text-neutral-fg1">Workflow v1</span>
            {mode === "v1" && (
              <span className="text-[10px] bg-brand text-white px-1.5 py-0.5 rounded-full font-medium">
                {t("common.active", "ativo")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-fg3">
            {t(
              "agents.executionModeV1Desc",
              "Pipeline sequencial configurável. Agentes seguem a cadeia definida no editor abaixo.",
            )}
          </p>
        </button>

        {/* V2 Card */}
        <button
          onClick={() => handleSelect("v2")}
          className={cn(
            "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-200",
            mode === "v2"
              ? "border-warning bg-warning/10 ring-2 ring-warning/20"
              : "border-stroke bg-neutral-bg2 hover:bg-neutral-bg-hover",
          )}
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            <span className="text-[13px] font-semibold text-neutral-fg1">Agent Teams v2</span>
            {mode === "v2" && (
              <span className="text-[10px] bg-warning text-white px-1.5 py-0.5 rounded-full font-medium">
                {t("common.active", "ativo")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-fg3">
            {t(
              "agents.executionModeV2Desc",
              "Orquestrador inteligente. O Tech Lead analisa cada task e decide quais agentes usar em paralelo.",
            )}
          </p>
        </button>
      </div>
    </div>
  );
}
