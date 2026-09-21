import fetch from "node-fetch";
import { GITHUB_TOKEN } from "./config.js";

const NOTEBOOKS_API =
  "https://api.github.com/repos/unslothai/notebooks/contents/nb";
const NOTEBOOKS_GITHUB_BASE =
  "https://github.com/unslothai/notebooks/blob/main/nb";
const NOTEBOOKS_RAW_BASE =
  "https://raw.githubusercontent.com/unslothai/notebooks/main/nb";
const NOTEBOOKS_COLAB_BASE =
  "https://colab.research.google.com/github/unslothai/notebooks/blob/main/nb";

export type NotebookItem = {
  name: string;
  path: string;
  size: number;
  downloadUrl: string;
  githubUrl: string;
  colabUrl: string;
};

const fetchNotebookIndex = async () => {
  const headers: Record<string, string> = {
    "User-Agent": "unsloth-mcp-server",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const response = await fetch(NOTEBOOKS_API, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
  const data = (await response.json()) as Array<{
    type: string;
    name: string;
    path: string;
    size: number;
    download_url: string;
  }>;
  if (!Array.isArray(data)) {
    throw new Error("Unexpected GitHub API response.");
  }
  return data
    .filter((item) => item.type === "file" && item.name.endsWith(".ipynb"))
    .map((item) => ({
      name: item.name,
      path: item.path,
      size: item.size,
      downloadUrl: item.download_url,
      githubUrl: `${NOTEBOOKS_GITHUB_BASE}/${item.name}`,
      colabUrl: `${NOTEBOOKS_COLAB_BASE}/${item.name}`,
    }));
};

export const listNotebooks = async (options?: {
  filter?: string;
  limit?: number;
}) => {
  const items = await fetchNotebookIndex();
  const filter = options?.filter?.toLowerCase().trim();
  const filtered = filter
    ? items.filter((item) => item.name.toLowerCase().includes(filter))
    : items;
  const limit = options?.limit ? Math.max(1, options.limit) : filtered.length;
  return filtered.slice(0, limit);
};

export const getNotebook = async (name: string) => {
  const items = await fetchNotebookIndex();
  const match = items.find(
    (item) => item.name.toLowerCase() === name.toLowerCase()
  );
  if (!match) {
    return null;
  }
  return {
    ...match,
    rawUrl: `${NOTEBOOKS_RAW_BASE}/${match.name}`,
  };
};
