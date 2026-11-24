import type { ComponentType, ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { CONTRACT_RENDERER_COPY } from "@/components/components-copy";
import type { ScreenContract } from "@/lib/contract-renderer";
import { GenericContractView, type GenericContractViewProps } from "./generic-views";

const renderers = new Map<string, ComponentType<GenericContractViewProps>>([
  ["generic", GenericContractView],
]);

export type ContractRendererProps = Omit<GenericContractViewProps, "screen"> & {
  screen: ScreenContract | null;
  fallback?: ReactNode;
};

export function ContractRenderer({ screen, fallback, ...props }: ContractRendererProps) {
  if (!screen) {
    return <>{fallback ?? <Alert variant="warn">{CONTRACT_RENDERER_COPY.SCREEN_FALLBACK}</Alert>}</>;
  }
  const Renderer = renderers.get(screen.renderer);
  if (!Renderer) {
    return <>{fallback ?? <Alert variant="warn">{`${CONTRACT_RENDERER_COPY.CUSTOM_RENDERER_UNBOUND}：${screen.renderer}；${CONTRACT_RENDERER_COPY.CUSTOM_RENDERER_NOT_MOUNTED}`}</Alert>}</>;
  }
  return <Renderer screen={screen} {...props} />;
}
