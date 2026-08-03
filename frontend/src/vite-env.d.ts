/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, unknown>;
  export default component;
}

declare module "cytoscape" {
  const cytoscape: any;
  export type Core = any;
  export type ElementDefinition = any;
  export default cytoscape;
}
