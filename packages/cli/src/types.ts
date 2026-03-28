export interface GeneratePass {
  name: string;
  input: string;
  include?: string[];
  output: string;
  format?: "printed" | "json";
  noValidate?: boolean;
  dependsOn?: string[];
}

export interface TisynConfig {
  generates: GeneratePass[];
}

export interface GenerateCommandOptions {
  input: string;
  include: string[];
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

export interface ResolvedPass extends Required<Pick<GeneratePass, "name" | "input" | "output">> {
  include: string[];
  format: "printed" | "json";
  noValidate: boolean;
  dependsOn: string[];
}
