export type DataMode = "seed" | "live";

export const parseDataMode = (value: string | undefined): DataMode => {
  const mode = value ?? "seed";
  if (mode === "seed" || mode === "live") return mode;
  throw new TypeError("DODO_DATA_MODE must be either seed or live");
};
