export interface GeneratePass {
  name: string;
  roots: string[];
  output: string;
  format?: "printed" | "json";
  noValidate?: boolean;
  dependsOn?: string[];
}

export interface TisynConfig {
  generates: GeneratePass[];
}

export interface GenerateCommandOptions {
  roots: string[];
  output?: string;
  format: "printed" | "json";
  validate: boolean;
  verbose: boolean;
}

export interface BuildCommandOptions {
  config?: string;
  filter?: string;
  verbose: boolean;
}

export interface RunCommandOptions {
  module: string;
  entrypoint?: string;
  verbose: boolean;
}

export interface CheckCommandOptions {
  module: string;
  entrypoint?: string;
  envExample: boolean;
  verbose: boolean;
}

export interface ResolvedPass extends Required<Pick<GeneratePass, "name" | "output">> {
  roots: string[];
  format: "printed" | "json";
  noValidate: boolean;
  dependsOn: string[];
}
