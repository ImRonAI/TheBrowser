import fetch from "node-fetch";

const HF_MODELS_API = "https://huggingface.co/api/models";

export type HfModel = {
  modelId: string;
  downloads?: number;
  likes?: number;
  pipeline_tag?: string;
  lastModified?: string;
};

export const listHfModels = async (options?: {
  search?: string;
  limit?: number;
}) => {
  const limit = options?.limit ? Math.max(1, options.limit) : 25;
  const params = new URLSearchParams({
    author: "unsloth",
    limit: String(limit),
    sort: "downloads",
    direction: "-1",
  });
  const response = await fetch(`${HF_MODELS_API}?${params.toString()}`, {
    headers: {
      "User-Agent": "unsloth-mcp-server",
    },
  });
  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`);
  }
  const data = (await response.json()) as HfModel[];
  if (!Array.isArray(data)) {
    throw new Error("Unexpected Hugging Face API response.");
  }
  const search = options?.search?.toLowerCase().trim();
  if (!search) {
    return data;
  }
  return data.filter((item) => item.modelId.toLowerCase().includes(search));
};
