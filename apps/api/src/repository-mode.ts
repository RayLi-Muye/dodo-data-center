export type RepositoryMode = "memory" | "postgres";

export const parseRepositoryMode = (value: string | undefined): RepositoryMode => {
  if (value === undefined || value === "" || value === "memory") return "memory";
  if (value === "postgres") return "postgres";
  throw new Error("DODO_REPOSITORY must be either memory or postgres");
};
