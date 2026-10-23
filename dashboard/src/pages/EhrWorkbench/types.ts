export type {
  EhrSkill,
  GraphEdge,
  GraphNode,
  QaSource,
  SearchResult,
} from "@/api/modules/ehr";

export type EhrViewKey = "search" | "graph" | "drug" | "skills";

export interface EhrNavItem {
  key: EhrViewKey;
  label: string;
  icon: string;
}

export const EHR_NAV: EhrNavItem[] = [
  { key: "search", label: "知识检索", icon: "search" },
  { key: "graph", label: "知识图谱", icon: "graph" },
  { key: "drug", label: "药品查询", icon: "drug" },
  { key: "skills", label: "技能", icon: "skill" },
];

export const TYPE_LABELS: Record<string, string> = {
  drug: "药品",
  clinic_item: "诊疗项目",
  diagnosis: "诊断",
  knowledge: "知识库",
  frequency: "频次",
  usage: "用法",
  doc: "文档",
  code: "代码",
  skill: "技能",
};

export const TYPE_COLORS: Record<string, string> = {
  drug: "magenta",
  clinic_item: "blue",
  diagnosis: "purple",
  knowledge: "gold",
  frequency: "cyan",
  usage: "cyan",
  doc: "default",
  code: "geekblue",
  skill: "green",
};

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: import("@/api/modules/ehr").QaSource[];
  degraded?: boolean;
  pending?: boolean;
}
